import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// `ACPTransport` over plain HTTP: each `send` POSTs one JSON-RPC message to the configured
/// endpoint. A plain `application/json` response is read as a single bounded body and decoded
/// once. A `text/event-stream` response is read incrementally, and — unlike MCP's `HTTPTransport`,
/// where one POST always yields exactly one response message on its request-scoped stream — MAY
/// carry multiple JSON-RPC messages on that same stream: zero or more `session/update` push
/// notifications followed eventually by the final JSON-RPC response to the POSTed request. So the
/// SSE read loop below yields every complete event as it's parsed, and stops as soon as it sees
/// the response whose `id` matches the outgoing request — not by waiting for the underlying
/// stream/connection to end, which isn't a safe termination signal (see `send`'s `requestID`
/// doc comment for why).
/// `ACPClient.consumeInbound` already routes each yielded message correctly regardless of order —
/// a notification (no "id") to `routeSessionUpdate`, a response (has "id") to `resolvePending`.
public actor ACPHTTPTransport: ACPTransport {
    /// Transport-level failures for one POST exchange.
    public enum HTTPError: Error, Sendable, Equatable {
        /// The endpoint answered with a non-2xx status. Only the status is kept — an error body
        /// from a remote agent isn't protocol traffic, so it isn't retained or decoded.
        case http(status: Int)
        /// The response wasn't HTTP at all, or a bounded `application/json` body failed to
        /// decode as JSON.
        case badResponse
        /// A single SSE line (the accumulated `data:` payload since the last event boundary)
        /// exceeded `maxLineBytes` without a terminating blank line — guards against unbounded
        /// memory growth from a misbehaving or malicious remote agent that never sends one.
        case lineTooLong
    }

    /// Upper bound on one accumulated SSE line's byte size (see `HTTPError.lineTooLong`). Generous
    /// for a real `session/update`/response payload, but not unbounded.
    private static let maxLineBytes = 1 << 20  // 1 MiB

    private let endpoint: URL
    private let bearerToken: SessionToken?
    private let urlSession: URLSession
    private let stream: AsyncStream<JSONValue>
    private let continuation: AsyncStream<JSONValue>.Continuation

    /// Creates the transport. `bearerToken`, when present, is sent as an
    /// `Authorization: Bearer` header on **every** POST — there is no persistent connection to
    /// authenticate once, so each request must carry its own credentials.
    ///
    /// - Parameters:
    ///   - endpoint: the remote agent's HTTP endpoint; every request POSTs here.
    ///   - bearerToken: per-request credential (see above); `nil` sends unauthenticated requests.
    ///   - urlSession: injectable so tests can substitute a `URLProtocol`-backed
    ///     session; defaults to `.shared`.
    public init(endpoint: URL, bearerToken: SessionToken? = nil, urlSession: URLSession = .shared) {
        self.endpoint = endpoint
        self.bearerToken = bearerToken
        self.urlSession = urlSession
        (self.stream, self.continuation) = AsyncStream<JSONValue>.makeStream(bufferingPolicy: .unbounded)
    }

    /// No-op: no persistent connection; the first send does the work.
    public func open() async throws { /* no persistent connection; first send does the work */ }

    /// POSTs one JSON-RPC message and yields whatever comes back onto ``inbound()``.
    ///
    /// An SSE response is read incrementally and this call returns as soon as the response
    /// matching the outgoing request's id arrives (see the type doc for why "stream ended" is
    /// not a safe termination signal); a notification POST (no id) reads until the stream ends.
    /// The read loops cooperatively check `Task.isCancelled` so `ACPClient`'s timeout
    /// cancellation actually tears the connection down rather than abandoning it — see
    /// `ACPClient.sendRequest`'s doc comment.
    public func send(_ message: JSONValue) async throws {
        // The id of the outgoing request, if any (absent for notifications). Used below to stop
        // reading the SSE stream as soon as the matching response arrives, rather than waiting for
        // the connection itself to close — a real server/proxy isn't guaranteed to close it
        // promptly, so relying on that would risk hanging indefinitely.
        let requestID: JSONValue? = {
            if case .object(let obj) = message { return obj["id"] }
            return nil
        }()

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken.value)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: message.rawValue)

        // Must not fully buffer a `text/event-stream` response: URLSession treats it as an
        // indefinite stream on a keep-alive connection, so reading the whole body (`data(for:)`)
        // never completes (it waits for the socket to close, which doesn't happen) — it hangs.
        // Both platform paths below read incrementally.
        #if canImport(Darwin)
        // `bytes(for:)` gives an incremental AsyncSequence of the response body.
        let (asyncBytes, response) = try await urlSession.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw HTTPError.badResponse }
        #else
        // `FoundationNetworking` has no `bytes(for:)`/`AsyncBytes`; ``HTTPStreamingRunner``
        // gets the same incremental behavior via `URLSessionDataDelegate`.
        let runner = HTTPStreamingRunner()
        let response = try await runner.start(request, configuration: urlSession.configuration)
        guard let http = response as? HTTPURLResponse else { throw HTTPError.badResponse }
        #endif

        guard (200...299).contains(http.statusCode) else { throw HTTPError.http(status: http.statusCode) }

        let contentType = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        if contentType.contains("text/event-stream") {
            // A single POSTed request's SSE stream may carry MULTIPLE messages — zero or more
            // `session/update` notifications, then the final response to this request. Yield every
            // complete event as it's parsed, and stop as soon as we see the response matching
            // `requestID` (rather than waiting for the stream/connection to end — see the doc
            // comment on `requestID` above for why that isn't a safe termination condition).
            //
            // Deliberately reads raw bytes and splits lines manually rather than using
            // `asyncBytes.lines`/`AsyncLineSequence`: that wrapper was found, empirically, to not
            // reliably resume past the first complete line-group when the underlying response was
            // delivered as a single synchronous chunk (as this codebase's `URLProtocol` test double
            // does) — it hung indefinitely trying to pull a second event's lines even though all
            // bytes had already arrived. Raw byte iteration (`for try await byte in asyncBytes`) is
            // the same primitive the plain `application/json` branch below already uses
            // successfully, so this sidesteps the `AsyncLineSequence`-specific issue entirely.
            var dataLines: [String] = []
            var pendingLineBytes = Data()

            func processLine(_ line: String) -> Bool {
                guard case .complete(let value) = accumulateSSELine(line, into: &dataLines) else { return false }
                guard let value else { return false }
                continuation.yield(value)
                return isMatchingResponse(value, requestID: requestID)
            }

            #if canImport(Darwin)
            for try await byte in asyncBytes {
                try Task.checkCancellation()  // see sendRequest's doc comment: lets a timed-out
                                               // caller's cancellation actually stop this loop,
                                               // not just abandon it.
                pendingLineBytes.append(byte)
                guard byte == 0x0A else {
                    guard pendingLineBytes.count <= Self.maxLineBytes else { throw HTTPError.lineTooLong }
                    continue
                }
                var line = String(decoding: pendingLineBytes.dropLast(), as: UTF8.self)
                if line.hasSuffix("\r") { line.removeLast() }
                pendingLineBytes.removeAll(keepingCapacity: true)
                if processLine(line) { return }
            }
            #else
            for try await chunk in runner.bodyStream {
                try Task.checkCancellation()
                for byte in chunk {
                    pendingLineBytes.append(byte)
                    guard byte == 0x0A else {
                        guard pendingLineBytes.count <= Self.maxLineBytes else { throw HTTPError.lineTooLong }
                        continue
                    }
                    var line = String(decoding: pendingLineBytes.dropLast(), as: UTF8.self)
                    if line.hasSuffix("\r") { line.removeLast() }
                    pendingLineBytes.removeAll(keepingCapacity: true)
                    if processLine(line) { return }
                }
            }
            #endif
            // The stream ended (without ever seeing the matching response, if `requestID` was
            // set). Flush a final unterminated line, then whatever `data:` lines accumulated, so a
            // well-formed final event isn't lost just because the source didn't end on a newline.
            if !pendingLineBytes.isEmpty {
                _ = processLine(String(decoding: pendingLineBytes, as: UTF8.self))
            }
            if !dataLines.isEmpty, let value = decode(dataLines.joined(separator: "\n")) {
                continuation.yield(value)
            }
        } else {
            // application/json (or other): accumulate the bounded body and decode one message.
            var data = Data()
            #if canImport(Darwin)
            for try await byte in asyncBytes {
                try Task.checkCancellation()
                data.append(byte)
            }
            #else
            for try await chunk in runner.bodyStream {
                try Task.checkCancellation()
                data.append(chunk)
            }
            #endif
            // A notification (no "id") may legitimately get an empty body back — nothing to decode.
            guard !data.isEmpty else { return }
            guard let value = decodeData(data) else { throw HTTPError.badResponse }
            continuation.yield(value)
        }
    }

    /// One line of SSE parsing shared by both platform read loops: accumulates `data:` payload
    /// lines, and on a blank line (event terminator) reports the decoded event. `event:`/`id:`/
    /// `retry:`/comment lines are ignored.
    private enum SSELineResult {
        case continueReading
        case complete(JSONValue?)
    }

    private func accumulateSSELine(_ line: String, into dataLines: inout [String]) -> SSELineResult {
        if line.isEmpty {
            guard !dataLines.isEmpty else { return .continueReading }
            let joined = dataLines.joined(separator: "\n")
            dataLines = []
            return .complete(decode(joined))
        }
        if line.hasPrefix("data:") {
            let v = line.dropFirst("data:".count)
            dataLines.append(v.hasPrefix(" ") ? String(v.dropFirst()) : String(v))
        }
        return .continueReading
    }

    /// True when `value` is a JSON-RPC response (has `result` or `error`) whose `id` matches
    /// `requestID` — i.e. it's the reply to the request this `send` call POSTed, as opposed to a
    /// `session/update` notification (no `id`) or a response to some other in-flight request.
    /// `requestID` is `nil` for a notification POST, which never matches anything (notifications
    /// get no reply, so this always falls through to reading until the stream ends).
    private func isMatchingResponse(_ value: JSONValue, requestID: JSONValue?) -> Bool {
        guard let requestID, case .object(let obj) = value, let id = obj["id"], id == requestID else { return false }
        return obj["result"] != nil || obj["error"] != nil
    }

    /// Messages decoded from every ``send(_:)``'s response — final responses and any
    /// `session/update` notifications the server pushed on an SSE stream, in arrival order.
    /// One shared stream across sends; `ACPClient.consumeInbound` routes each message by the
    /// presence/value of its id. `nonisolated` (the stream is created at init and never
    /// reassigned) so the consumer can attach without an actor hop.
    public nonisolated func inbound() -> AsyncStream<JSONValue> { stream }

    /// Finishes the inbound stream so the consumer's loop ends. There is no connection to tear
    /// down — an in-flight ``send(_:)`` is bounded by its caller's timeout/cancellation, not by
    /// `close`.
    public func close() async { continuation.finish() }

    private func decode(_ payload: String) -> JSONValue? {
        guard let data = payload.data(using: .utf8) else { return nil }
        return decodeData(data)
    }

    private func decodeData(_ data: Data) -> JSONValue? {
        guard let raw = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return JSONValue.from(raw)
    }
}
