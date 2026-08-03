import Foundation
import OSLog

/// Maximum size of a single `responseBody` frame's payload (spec §Approaches B).
private let maxResponseBodyChunk = 64 * 1_024

/// Executes one HTTP exchange on the host side.
///
/// Production (P1): `URLSession` against the container dev server with redirects **not**
/// followed. P0/tests: ``DirectoryHTTPExecutor``.
public protocol HTTPExecutor: Sendable {
    /// Runs `request` (with an optional request body) and returns the response head plus a
    /// stream of body chunks. Throwing aborts the bridged transaction (see
    /// ``FetchBridgeServer``).
    func execute(_ request: BridgeRequestHead, body: Data?) async throws
        -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>)
}

/// Error surfaced by ``FetchBridgeClient`` when the host aborts an in-flight request, or when
/// the underlying connection closes before a response arrives.
public struct FetchBridgeError: Error, Equatable, Sendable {
    /// Human-readable reason for the abort/failure.
    public let reason: String

    /// Creates an error carrying `reason` (either the host's `abort` reason or a synthesized
    /// "connection closed" message).
    public init(reason: String) {
        self.reason = reason
    }
}

/// Client (phone/P4) side: turns a request into interleavable `http`-channel frames and
/// reassembles the reply.
///
/// One `FetchBridgeClient` can drive many concurrent `perform` calls; a single pump task (started
/// lazily on first use) demultiplexes inbound frames by request id.
public actor FetchBridgeClient {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "FetchBridgeClient")

    private let connection: any P2PConnection
    private var nextID: UInt32 = 0
    private var pending: [UInt32: PendingRequest] = [:]
    private var pumpTask: Task<Void, Never>?

    /// State for one in-flight request: the continuation that resolves `perform`'s head, and the
    /// continuation feeding its body stream (set once the head resolves).
    private final class PendingRequest {
        var headContinuation: CheckedContinuation<(head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>), Error>?
        var bodyContinuation: AsyncThrowingStream<Data, Error>.Continuation?

        /// Set by `handle(_:)` when a `.responseHead`/`.abort` frame arrives before `perform()`
        /// has installed `headContinuation` — the actor-release window between the awaited
        /// `connection.send` calls that frame the request and the `withCheckedThrowingContinuation`
        /// below. Without this stash the frame would be dropped (`headContinuation` is nil, so
        /// `.resume` is a no-op) or, for `.abort`, the entry would be removed from `pending`
        /// entirely — either way `perform()` then installs a continuation nothing will ever
        /// resume, hanging its caller forever. `perform()`'s continuation closure checks this
        /// first and resumes immediately if present.
        var stashedHeadResult: Result<(head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>), Error>?
    }

    /// Wraps an already-connected ``P2PConnection``. The pump task that demultiplexes inbound
    /// `http` frames is started on first use of ``perform(_:body:)``, not here — matching the
    /// convention that a connection is shared and each seam using it starts its own pump lazily.
    public init(connection: any P2PConnection) {
        self.connection = connection
    }

    /// Sends `request` (and `body`, if non-nil) as `requestHead`/`requestBody`/`requestEnd`
    /// frames, then awaits the response head. The returned stream yields `responseBody` payloads
    /// until the host sends `responseEnd` (stream finishes) or `abort` (stream finishes throwing
    /// ``FetchBridgeError``).
    public func perform(_ request: BridgeRequestHead, body: Data? = nil) async throws
        -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>) {
        startPumpIfNeeded()

        let id = nextID
        nextID += 1
        let pendingRequest = PendingRequest()
        pending[id] = pendingRequest

        do {
            try await connection.send(HTTPBridgeFrame.requestHead(id: id, request).encoded(), on: .http)
            if let body {
                try await connection.send(HTTPBridgeFrame.requestBody(id: id, body).encoded(), on: .http)
            }
            try await connection.send(HTTPBridgeFrame.requestEnd(id: id).encoded(), on: .http)
        } catch {
            pending.removeValue(forKey: id)
            throw error
        }

        // Wrapped in `withTaskCancellationHandler` so a cancelled caller doesn't hang past its own
        // cancellation — same shape as `WebRTCPeer.waitForChannelOpen`. Only one call ever awaits
        // a given `id` (ids aren't reused across calls), so — unlike `WebRTCPeer`, which fans out
        // to a dictionary of per-token waiters — a single `headContinuation` slot on
        // `PendingRequest` is enough; `cancelPerform(_:)` still follows the same
        // remove-before-resume discipline to guarantee exactly-once resume.
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<(head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>), Error>) in
                guard !Task.isCancelled else {
                    // Cancelled during the sends above, before this closure could even install a
                    // continuation. Discard any stash that raced in during that window too — a
                    // cancelled call shouldn't surface a response nobody asked for anymore.
                    pendingRequest.stashedHeadResult = nil
                    pending.removeValue(forKey: id)
                    continuation.resume(throwing: CancellationError())
                    return
                }
                if let stashed = pendingRequest.stashedHeadResult {
                    pendingRequest.stashedHeadResult = nil
                    continuation.resume(with: stashed)
                    return
                }
                pendingRequest.headContinuation = continuation
            }
        } onCancel: {
            Task { await self.cancelPerform(id) }
        }
    }

    /// Cancellation hop for ``perform(_:body:)``'s `withTaskCancellationHandler`. Only acts if
    /// `headContinuation` is still installed — i.e. `handle(_:)` hasn't already resolved (or
    /// stashed a resolution for) this request — so a cancellation that arrives after the response
    /// already landed never rips a live body stream out from under a caller that's still reading
    /// it. Removes the entry before resuming so a concurrent `handle(_:)` call for the same id
    /// (which would find it missing and log-and-skip) can never race a second resume.
    private func cancelPerform(_ id: UInt32) {
        guard let pendingRequest = pending[id], let headContinuation = pendingRequest.headContinuation else {
            return
        }
        pending.removeValue(forKey: id)
        pendingRequest.headContinuation = nil
        headContinuation.resume(throwing: CancellationError())
    }

    /// Starts the demux pump exactly once per client instance.
    private func startPumpIfNeeded() {
        guard pumpTask == nil else { return }
        let inboundFrames = connection.inbound(.http)
        pumpTask = Task { [weak self] in
            for await raw in inboundFrames {
                guard let self else { return }
                await self.handle(raw)
            }
            // Connection closed: fail every request still waiting on a head or body, so a caller
            // never hangs on a continuation that will never resolve.
            await self?.failAllPending(with: FetchBridgeError(reason: "connection closed"))
        }
    }

    /// Decodes one inbound `http` frame and routes it to the matching pending request. Undecodable
    /// frames and frames for unknown ids are logged and skipped, never silently dropped or fatal.
    ///
    /// `internal` rather than `private`: the pump task (`startPumpIfNeeded`) is this method's only
    /// production caller, but `FetchBridgeTests` (via `@testable import`) also drives it directly
    /// to deterministically reproduce the race where a response/abort frame is handled before
    /// `perform()` installs its `headContinuation` — see `PendingRequest.stashedHeadResult`.
    func handle(_ raw: Data) async {
        let frame: HTTPBridgeFrame
        do {
            frame = try HTTPBridgeFrame.decode(raw)
        } catch {
            Self.logger.error("dropping undecodable inbound http frame (\(raw.count, privacy: .public) bytes): \(String(describing: error), privacy: .public)")
            return
        }

        let id: UInt32
        switch frame {
        case .responseHead(let frameID, _), .responseBody(let frameID, _), .responseEnd(let frameID), .abort(let frameID, _):
            id = frameID
        case .requestHead(let frameID, _), .requestBody(let frameID, _), .requestEnd(let frameID):
            // The client only ever expects response-side frames; log and skip anything else
            // rather than silently ignoring it.
            Self.logger.error("client received unexpected request-side http frame kind for id \(frameID, privacy: .public)")
            return
        }

        guard let pendingRequest = pending[id] else {
            Self.logger.error("dropping http frame for unknown request id \(id, privacy: .public)")
            return
        }

        switch frame {
        case .responseHead(_, let head):
            let (stream, continuation) = AsyncThrowingStream<Data, Error>.makeStream(of: Data.self)
            pendingRequest.bodyContinuation = continuation
            if let headContinuation = pendingRequest.headContinuation {
                pendingRequest.headContinuation = nil
                headContinuation.resume(returning: (head, stream))
            } else {
                // `perform()` hasn't installed its continuation yet (still awaiting its outbound
                // `send`s) — stash instead of silently dropping the head. Left in `pending` so
                // subsequent `responseBody`/`responseEnd`/`abort` frames keep routing to
                // `bodyContinuation` regardless of when `perform()` picks up the stash.
                pendingRequest.stashedHeadResult = .success((head, stream))
            }

        case .responseBody(_, let chunk):
            pendingRequest.bodyContinuation?.yield(chunk)

        case .responseEnd:
            pendingRequest.bodyContinuation?.finish()
            pending.removeValue(forKey: id)

        case .abort(_, let reason):
            let error = FetchBridgeError(reason: reason)
            if let headContinuation = pendingRequest.headContinuation {
                pendingRequest.headContinuation = nil
                headContinuation.resume(throwing: error)
            } else if pendingRequest.bodyContinuation != nil {
                pendingRequest.bodyContinuation?.finish(throwing: error)
            } else {
                // Same race as the `.responseHead` case above, but terminal: nothing has resolved
                // yet, so stash the error for `perform()`'s continuation closure to pick up.
                pendingRequest.stashedHeadResult = .failure(error)
            }
            pending.removeValue(forKey: id)

        case .requestHead, .requestBody, .requestEnd:
            break // unreachable, handled above
        }
    }

    /// Fails every still-pending request with `error` — invoked once the inbound stream finishes
    /// (the connection closed) so no caller of ``perform(_:body:)`` hangs forever.
    private func failAllPending(with error: FetchBridgeError) {
        for (_, pendingRequest) in pending {
            if let headContinuation = pendingRequest.headContinuation {
                headContinuation.resume(throwing: error)
            } else {
                pendingRequest.bodyContinuation?.finish(throwing: error)
            }
        }
        pending.removeAll()
    }
}

/// Host side: consumes inbound `http` frames, runs each completed request through `executor`, and
/// streams the result back.
///
/// Concurrent requests genuinely run concurrently: `run()` demultiplexes frames into per-request
/// accumulators, and each completed request (`requestEnd`) is handled in its own child task so a
/// slow executor call for one request never blocks another's progress.
public actor FetchBridgeServer {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "FetchBridgeServer")

    /// Hop-by-hop headers stripped from every response before framing (spec §Approaches B),
    /// compared case-insensitively.
    private static let hopByHopHeaders: Set<String> = [
        "connection", "keep-alive", "transfer-encoding", "upgrade",
        "proxy-authenticate", "proxy-authorization", "te", "trailer",
    ]

    private let connection: any P2PConnection
    private let executor: any HTTPExecutor
    private var accumulators: [UInt32: RequestAccumulator] = [:]

    /// Accumulates a request's head and body chunks until `requestEnd` completes it.
    private struct RequestAccumulator {
        var head: BridgeRequestHead?
        var body = Data()
    }

    /// - Parameters:
    ///   - connection: The shared connection; ``run()`` consumes only its ``P2PChannelID/http``
    ///     channel, leaving the other three untouched.
    ///   - executor: Runs each completed request.
    public init(connection: any P2PConnection, executor: any HTTPExecutor) {
        self.connection = connection
        self.executor = executor
    }

    /// Consumes `connection.inbound(.http)` until it finishes (the connection closed). Each
    /// completed request is handled in its own child task so concurrent requests actually run
    /// concurrently. Undecodable frames are logged and skipped.
    public func run() async {
        await withTaskGroup(of: Void.self) { group in
            for await raw in connection.inbound(.http) {
                let frame: HTTPBridgeFrame
                do {
                    frame = try HTTPBridgeFrame.decode(raw)
                } catch {
                    Self.logger.error("dropping undecodable inbound http frame (\(raw.count, privacy: .public) bytes): \(String(describing: error), privacy: .public)")
                    continue
                }

                switch frame {
                case .requestHead(let id, let head):
                    var accumulator = accumulators[id] ?? RequestAccumulator()
                    accumulator.head = head
                    accumulators[id] = accumulator

                case .requestBody(let id, let chunk):
                    var accumulator = accumulators[id] ?? RequestAccumulator()
                    accumulator.body.append(chunk)
                    accumulators[id] = accumulator

                case .requestEnd(let id):
                    guard let accumulator = accumulators.removeValue(forKey: id), let head = accumulator.head else {
                        Self.logger.error("dropping requestEnd for id \(id, privacy: .public) with no requestHead")
                        continue
                    }
                    let body = accumulator.body.isEmpty ? nil : accumulator.body
                    let connection = connection
                    let executor = executor
                    group.addTask {
                        await Self.handleRequest(id: id, head: head, body: body, connection: connection, executor: executor)
                    }

                case .responseHead, .responseBody, .responseEnd, .abort:
                    Self.logger.error("server received unexpected response-side http frame")
                }
            }
            // Connection closed: let any in-flight child tasks finish naturally (their sends will
            // throw once the connection is torn down); nothing further to demux.
        }
    }

    /// Runs one completed request through `executor` and frames the result: `responseHead`, then
    /// `≤ 64 KiB` `responseBody` frames, then `responseEnd`. An executor throw becomes `abort`.
    private static func handleRequest(
        id: UInt32, head: BridgeRequestHead, body: Data?,
        connection: any P2PConnection, executor: any HTTPExecutor
    ) async {
        do {
            let (responseHead, responseBody) = try await executor.execute(head, body: body)
            let strippedHead = BridgeResponseHead(
                status: responseHead.status,
                headers: responseHead.headers.filter { !hopByHopHeaders.contains($0.key.lowercased()) }
            )
            try await connection.send(HTTPBridgeFrame.responseHead(id: id, strippedHead).encoded(), on: .http)

            for try await chunk in responseBody {
                var offset = chunk.startIndex
                while offset < chunk.endIndex {
                    let end = chunk.index(offset, offsetBy: maxResponseBodyChunk, limitedBy: chunk.endIndex) ?? chunk.endIndex
                    let piece = chunk.subdata(in: offset..<end)
                    try await connection.send(HTTPBridgeFrame.responseBody(id: id, piece).encoded(), on: .http)
                    offset = end
                }
            }

            try await connection.send(HTTPBridgeFrame.responseEnd(id: id).encoded(), on: .http)
        } catch {
            let reason = String(describing: error)
            do {
                try await connection.send(HTTPBridgeFrame.abort(id: id, reason: reason).encoded(), on: .http)
            } catch {
                logger.error("failed to send abort for request id \(id, privacy: .public): \(String(describing: error), privacy: .public)")
            }
        }
    }
}
