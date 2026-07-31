// Sources/AnglesiteCore/ACPClient.swift
import Foundation

/// JSON-RPC 2.0 client speaking the Agent Client Protocol (ACP) over a pluggable `ACPTransport`.
///
/// Differs from `MCPClient` in one important way: MCP discards every server notification, but ACP
/// notifications (`session/update`) and server-initiated requests (`session/request_permission`)
/// carry the actual conversation content and must be acted on. This client owns id-correlation for
/// request/response pairs (like `MCPClient`) plus routing `session/update` to the matching
/// in-flight `sendPrompt` call, and auto-declines any `session/request_permission` — this slice
/// has no tool-permission UI (see the ACP agent settings design spec §4.4/§5), so an agent that
/// attempts a tool call during the proof-of-concept turn is told "no" rather than left hanging.
public actor ACPClient {
    /// Protocol-level failures. These surface to `ACPAssistant` as thrown errors during setup
    /// calls, or in-band as `.failed(message:)` events mid-turn.
    public enum ACPError: Error, Sendable, Equatable {
        /// The server answered, but the payload was missing a required field (e.g. `session/new`
        /// without a `sessionId`). Carries a short description of what was expected.
        case invalidResponse(String)
        /// The server returned a JSON-RPC error object for a request; `code`/`message` come
        /// straight off the wire.
        case rpcError(code: Int, message: String)
        /// A call was made after `stop()` (or before the client has ever started). Mirrors
        /// `MCPClient.MCPError.notInitialized` — fail fast instead of registering a pending
        /// continuation against a closed transport that will never answer.
        case stopped
        /// No response arrived within the request's timeout. Mirrors `MCPClient.MCPError.timeout` —
        /// bounds a hang caused by e.g. the in-container agent process crashing mid-turn without
        /// anything finishing the transport's inbound stream (nothing here currently detects that
        /// crash directly; this is the general backstop for it, for both the stdio and HTTP
        /// transports).
        case timeout
    }

    private let transport: any ACPTransport
    private var readerTask: Task<Void, Never>?
    private var nextRequestID: Int = 1
    private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
    /// Set at the start of `stop()`; guards `sendRequest`/`sendNotification` against sending on an
    /// already-closed transport (see `MCPClient.transport == nil` for the equivalent guard).
    private var isStopped: Bool = false
    /// One live `session/update` listener per session — this slice only ever drives one turn at a
    /// time per `ACPAssistant`, so a single continuation per session id is sufficient.
    private var sessionUpdateContinuations: [String: AsyncStream<AssistantEvent>.Continuation] = [:]
    /// Test-only seam: overrides every `sendRequest` timeout (`initialize`/`session/new`/
    /// `session/prompt`) so tests proving the timeout mechanism aren't bound by the production
    /// defaults (10s / 10s / 120s). Not `public` — reachable only via `@testable import`.
    private var requestTimeoutOverrideForTesting: TimeInterval?

    /// Creates a client over `transport`. Nothing is opened or sent until ``initialize()`` —
    /// construction stays cheap and non-blocking, matching `ACPAssistant`'s lazy-connect design.
    public init(transport: any ACPTransport) {
        self.transport = transport
    }

    /// Test-only seam — see `requestTimeoutOverrideForTesting`.
    func setRequestTimeoutOverrideForTesting(_ timeout: TimeInterval?) {
        requestTimeoutOverrideForTesting = timeout
    }

    /// Opens the transport, starts the inbound reader task, and performs the ACP `initialize`
    /// handshake (10s timeout). Declares the `fs` read/write capabilities as unavailable —
    /// this slice implements no filesystem request handlers, so advertising them would leave a
    /// conformant agent's `fs/*` requests hanging.
    public func initialize() async throws {
        try await transport.open()
        readerTask = Task { [weak self] in
            guard let self else { return }
            await self.consumeInbound(transport.inbound())
        }
        let params: JSONValue = .object([
            "protocolVersion": .int(1),
            "clientCapabilities": .object(["fs": .object(["readTextFile": .bool(false), "writeTextFile": .bool(false)])]),
        ])
        _ = try await sendRequest(method: "initialize", params: params, timeout: requestTimeoutOverrideForTesting ?? 10)
    }

    /// Creates a new ACP session rooted at `cwd` and returns its server-assigned id. Passes an
    /// empty `mcpServers` list — wiring the site's MCP sidecar into agent sessions is out of
    /// this proof-of-concept's scope (see the type doc).
    public func newSession(cwd: String) async throws -> String {
        let result = try await sendRequest(
            method: "session/new",
            params: .object(["cwd": .string(cwd), "mcpServers": .array([])]),
            timeout: requestTimeoutOverrideForTesting ?? 10
        )
        guard case .object(let obj) = result, case .string(let sessionID)? = obj["sessionId"] else {
            throw ACPError.invalidResponse("session/new missing 'sessionId'")
        }
        return sessionID
    }

    /// Streams one turn as `AssistantEvent`s: `.started` immediately, `.textDelta`/`.toolUse`/
    /// `.toolResult` as `session/update` notifications arrive for `sessionID`, then `.turnComplete`
    /// (or `.failed`) once the `session/prompt` response itself resolves.
    ///
    /// The `session/prompt` request uses a 120s timeout — long enough for a real turn (thinking,
    /// tool use) to complete normally, but bounding the hang if the in-container agent process
    /// crashes mid-turn (nothing currently detects that crash directly; this is the general
    /// backstop, per `ACPError.timeout`). A timeout surfaces here as `.failed(message:)`, same as
    /// any other `sendRequest` failure.
    public func sendPrompt(sessionID: String, text: String) async throws -> AsyncStream<AssistantEvent> {
        let (stream, continuation) = AsyncStream<AssistantEvent>.makeStream(bufferingPolicy: .unbounded)
        sessionUpdateContinuations[sessionID] = continuation
        continuation.yield(.started(model: nil, toolNames: []))

        let params: JSONValue = .object([
            "sessionId": .string(sessionID),
            "prompt": .array([.object(["type": .string("text"), "text": .string(text)])]),
        ])
        let promptTimeout = requestTimeoutOverrideForTesting ?? 120
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await self.sendRequest(method: "session/prompt", params: params, timeout: promptTimeout)
                continuation.yield(.turnComplete(nil))
            } catch {
                continuation.yield(.failed(message: String(describing: error)))
            }
            await self.finishSessionUpdates(sessionID: sessionID)
            continuation.finish()
        }
        return stream
    }

    /// Sends the `session/cancel` notification for the in-flight turn. Best-effort by design
    /// (`try?`): cancellation carries no response to wait on, and the turn's own
    /// `session/prompt` request resolves its stream either way — a failed cancel just means the
    /// agent finishes the turn it was asked to abandon.
    public func cancelSession(sessionID: String) async {
        try? await sendNotification(
            method: "session/cancel",
            params: .object(["sessionId": .string(sessionID)]),
            timeout: requestTimeoutOverrideForTesting ?? 10
        )
    }

    /// Tears the client down: cancels the reader task, closes the transport (for a `.stdio`
    /// agent, terminating the in-container guest process — see `ACPAssistant`'s `deinit` note
    /// on the leak this prevents), and fails/finishes everything in flight so no caller is left
    /// awaiting a response that can never arrive. Terminal — later sends throw
    /// `ACPError.stopped`; there is no restart.
    public func stop() async {
        isStopped = true
        readerTask?.cancel()
        readerTask = nil
        await transport.close()
        for (_, cont) in pending { cont.resume(throwing: CancellationError()) }
        pending.removeAll()
        for cont in sessionUpdateContinuations.values { cont.finish() }
        sessionUpdateContinuations.removeAll()
    }

    // MARK: Internals

    private func finishSessionUpdates(sessionID: String) {
        sessionUpdateContinuations.removeValue(forKey: sessionID)
    }

    /// Sends a request and awaits its response, bounded by `timeout`. Mirrors
    /// `MCPClient.sendRequest`'s timeout mechanism: a detached `timeoutTask` fails the pending
    /// continuation with `.timeout` if no response arrives in time, and is cancelled via `defer`
    /// once the real response (or an earlier failure) resolves it first. This is what bounds a
    /// hang if the in-container agent process crashes mid-request without anything else noticing
    /// (see `ACPError.timeout`).
    ///
    /// Beyond `MCPClient`'s pattern, the `defer` also cancels `sendTask` — the child `Task` that
    /// performs the actual `transport.send(...)` — not just `timeoutTask`. For `ACPHTTPTransport`,
    /// `send(_:)` can block for a long time inside its SSE read loop (waiting for the matching
    /// response); without cancelling `sendTask` too, a timed-out request would abandon that call
    /// rather than actually tear it down, leaking the network task and its open connection
    /// indefinitely. `ACPHTTPTransport.send` cooperatively checks `Task.isCancelled` inside its
    /// read loops so this cancellation actually takes effect, not just marks the task cancelled.
    private func sendRequest(method: String, params: JSONValue?, timeout: TimeInterval) async throws -> JSONValue {
        guard !isStopped else { throw ACPError.stopped }
        let id = nextRequestID
        nextRequestID += 1
        var obj: [String: JSONValue] = ["jsonrpc": .string("2.0"), "id": .int(id), "method": .string(method)]
        if let params { obj["params"] = params }
        let message = JSONValue.object(obj)

        let timeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(timeout, 0) * 1_000_000_000))
            if !Task.isCancelled { await self?.failPending(id: id, error: ACPError.timeout) }
        }
        var sendTask: Task<Void, Never>?
        defer {
            timeoutTask.cancel()
            sendTask?.cancel()
        }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<JSONValue, Error>) in
                // Registers `pending[id]` synchronously on the actor before `send` is even
                // scheduled, so a response can never race ahead of registration.
                pending[id] = cont
                sendTask = Task { [weak self] in
                    do {
                        try await self?.transport.send(message)
                    } catch {
                        await self?.failPending(id: id, error: error)
                    }
                }
            }
        } onCancel: {
            Task { [self] in await self.failPending(id: id, error: CancellationError()) }
        }
    }

    /// Sends a notification (no response expected) — but the underlying `transport.send(...)` call
    /// itself can still hang: `ACPHTTPTransport` has no request `id` to match against a notification
    /// (see its own doc comment), so if the server answers with a `text/event-stream` response, that
    /// call reads until the stream ends, which isn't guaranteed to happen promptly. Bounded the same
    /// way as `sendRequest`, via a race between the actual send and a timeout — whichever finishes
    /// first wins, and the loser is cancelled (relying on the same `Task.isCancelled` cooperation
    /// `ACPHTTPTransport.send` implements for `sendRequest`'s benefit).
    private func sendNotification(method: String, params: JSONValue?, timeout: TimeInterval = 10) async throws {
        guard !isStopped else { throw ACPError.stopped }
        var obj: [String: JSONValue] = ["jsonrpc": .string("2.0"), "method": .string(method)]
        if let params { obj["params"] = params }
        let message = JSONValue.object(obj)
        let transport = transport

        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await transport.send(message) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(max(timeout, 0) * 1_000_000_000))
                throw ACPError.timeout
            }
            do {
                try await group.next()
                group.cancelAll()
            } catch {
                group.cancelAll()
                throw error
            }
        }
    }

    private func failPending(id: Int, error: Error) {
        if let cont = pending.removeValue(forKey: id) { cont.resume(throwing: error) }
    }

    private func resolvePending(id: Int, value: JSONValue) {
        if let cont = pending.removeValue(forKey: id) { cont.resume(returning: value) }
    }

    private func consumeInbound(_ stream: AsyncStream<JSONValue>) async {
        for await message in stream {
            guard case .object(let obj) = message else { continue }

            if case .string(let method)? = obj["method"] {
                // A server-initiated request has an "id" (any JSON-RPC id type — number or
                // string; a bare `.int` check here would silently drop a string-id request from a
                // conformant agent, undermining the auto-decline guarantee below). A notification
                // has no "id" at all.
                if let id = obj["id"] {
                    // Server-initiated request. Only `session/request_permission` is expected this
                    // slice; auto-decline since there is no tool-permission UI yet.
                    if method == "session/request_permission" {
                        try? await transport.send(.object([
                            "jsonrpc": .string("2.0"), "id": id,
                            "result": .object(["outcome": .object(["outcome": .string("cancelled")])]),
                        ]))
                    }
                    continue
                }
                if method == "session/update" { routeSessionUpdate(obj["params"]) }
                continue
            }

            guard case .int(let id)? = obj["id"] else { continue }  // response
            if case .object(let errObj)? = obj["error"] {
                let code: Int = { if case .int(let c)? = errObj["code"] { return c }; return -1 }()
                let msg: String = { if case .string(let m)? = errObj["message"] { return m }; return "unknown rpc error" }()
                failPending(id: id, error: ACPError.rpcError(code: code, message: msg))
            } else {
                resolvePending(id: id, value: obj["result"] ?? .null)
            }
        }
    }

    private func routeSessionUpdate(_ params: JSONValue?) {
        guard case .object(let params)? = params,
              case .string(let sessionID)? = params["sessionId"],
              case .object(let update)? = params["update"],
              case .string(let kind)? = update["sessionUpdate"],
              let continuation = sessionUpdateContinuations[sessionID]
        else { return }

        switch kind {
        case "agent_message_chunk":
            if case .object(let content)? = update["content"], case .string(let text)? = content["text"] {
                continuation.yield(.textDelta(text))
            }
        case "agent_thought_chunk":
            if case .object(let content)? = update["content"], case .string(let text)? = content["text"] {
                continuation.yield(.thinking(text))
            }
        case "tool_call":
            let id: String = { if case .string(let s)? = update["toolCallId"] { return s }; return UUID().uuidString }()
            let name: String = { if case .string(let s)? = update["title"] { return s }; return "tool" }()
            continuation.yield(.toolUse(id: id, name: name, input: .null))
        case "tool_call_update":
            guard case .string(let id)? = update["toolCallId"] else { return }
            let status: String = { if case .string(let s)? = update["status"] { return s }; return "" }()
            continuation.yield(.toolResult(id: id, content: status, isError: status == "failed"))
        default:
            break  // unrecognized update kind — safely ignored
        }
    }
}
