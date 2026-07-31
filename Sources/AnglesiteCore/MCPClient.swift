import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Minimal JSON value used at the MCP boundary so request/response shapes stay `Sendable` and
/// `Equatable` without forcing every caller to define a `Codable` model.
public indirect enum JSONValue: Sendable, Equatable {
    /// JSON `null`.
    case null
    /// A JSON boolean.
    case bool(Bool)
    /// A JSON number that arrived as an integer — see ``from(_:)`` for how the int/double
    /// split is decided.
    case int(Int)
    /// A JSON number that arrived with a floating-point representation.
    case double(Double)
    /// A JSON string.
    case string(String)
    /// A JSON array.
    case array([JSONValue])
    /// A JSON object.
    case object([String: JSONValue])

    /// Convert to a `JSONSerialization`-friendly value tree.
    public var rawValue: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .int(let i): return i
        case .double(let d): return d
        case .string(let s): return s
        case .array(let a): return a.map(\.rawValue)
        case .object(let o): return o.mapValues(\.rawValue)
        }
    }

    /// Convert a `JSONSerialization` result tree into a `JSONValue`. Returns `nil` for shapes
    /// containing unsupported types (e.g. dictionary keys that aren't strings).
    public static func from(_ value: Any) -> JSONValue? {
        if value is NSNull { return .null }
        if let s = value as? String { return .string(s) }
        // NSNumber must be checked BEFORE Bool/Int/Double casts — `NSNumber(1) as? Bool`
        // succeeds, which would silently turn integer 1 into .bool(true).
        if let n = value as? NSNumber {
            #if canImport(Darwin)
            let isBool = CFGetTypeID(n) == CFBooleanGetTypeID()
            #else
            // CFGetTypeID/CFBooleanGetTypeID (CoreFoundation) don't exist off Darwin. Empirically,
            // swift-corelibs-foundation's JSONSerialization boxes JSON booleans with objCType "c"
            // and every JSON number (int or double) with "i"/"q"/"d"/"f" — never "c" — so the
            // objCType check just below already distinguishes them; this only names that branch.
            let isBool = String(cString: n.objCType) == "c"
            #endif
            if isBool { return .bool(n.boolValue) }
            // JSONSerialization uses NSNumber for both ints and doubles; pick based on the
            // CFNumber type so 1.0 stays a double and 1 stays an int.
            let typeChar = String(cString: n.objCType)
            if typeChar == "d" || typeChar == "f" {
                return .double(n.doubleValue)
            }
            return .int(n.intValue)
        }
        if let a = value as? [Any] {
            var out: [JSONValue] = []
            for v in a { guard let jv = JSONValue.from(v) else { return nil }; out.append(jv) }
            return .array(out)
        }
        if let o = value as? [String: Any] {
            var out: [String: JSONValue] = [:]
            for (k, v) in o { guard let jv = JSONValue.from(v) else { return nil }; out[k] = jv }
            return .object(out)
        }
        return nil
    }
}

/// JSON-RPC 2.0 client speaking the Model Context Protocol over a pluggable `MCPTransport`.
///
/// The surface is intentionally narrow: `start(executable:…)` spawns a server over stdio (a
/// `StdioTransport`) or `connect(httpEndpoint:)` reaches one over Streamable HTTP (an
/// `HTTPTransport`), both running the `initialize` handshake; `listTools()` and
/// `callTool(name:arguments:)` cover what the app needs. Server notifications (no `id`) are
/// discarded — the client only correlates request/response by id.
///
/// The client owns the JSON-RPC id/pending bookkeeping and the handshake; the transport owns the
/// wire (process pipes vs HTTP). For the stdio transport, protocol traffic also flows through
/// `LogCenter`, so the Debug pane can see it.
public actor MCPClient {
    /// Failures the client layer itself produces (a server-reported JSON-RPC error surfaces as
    /// ``rpcError(code:message:)``, passed through rather than reinterpreted).
    public enum MCPError: Error, Sendable, Equatable {
        /// No transport is connected and handshaken — `start(...)`/`connect(...)` hasn't run,
        /// failed, or a post-crash re-handshake didn't succeed.
        case notInitialized
        /// `start(...)`/`connect(...)` was called while a transport is already up; call
        /// ``MCPClient/stop()`` first.
        case alreadyRunning
        /// The server replied with JSON the client can't interpret; carries a description of
        /// what was missing.
        case invalidResponse(String)
        /// The server answered with a JSON-RPC error object, forwarded verbatim.
        case rpcError(code: Int, message: String)
        /// The stdio server process exited before the client finished becoming ready.
        case exitedBeforeReady(ProcessSupervisor.ExitReason)
        /// No response arrived within the per-request deadline; the pending request is failed
        /// so a caller never hangs on a wedged server.
        case timeout
        /// In-flight request failed because the server process crashed and is being restarted;
        /// the client re-runs `initialize` against the fresh process. Retry the call.
        case reconnecting
    }

    /// One tool advertised by the server's `tools/list` response.
    public struct ToolDescriptor: Sendable, Equatable {
        /// The tool's wire name — the value passed to ``MCPClient/callTool(name:arguments:)``.
        public let name: String
        /// The server's human-readable description, when it provides one.
        public let description: String?
        /// The tool's declared JSON-Schema input, kept as raw ``JSONValue`` rather than a
        /// typed model — the app has no need to validate against it. `nil` when omitted.
        public let inputSchema: JSONValue?
    }

    /// The result of a `tools/call`. MCP separates transport success from tool-level failure:
    /// a failed tool still resolves normally here with ``isError`` true rather than throwing.
    public struct ToolCallResult: Sendable, Equatable {
        /// The content items, in server order. Non-text items keep their `type` with a nil
        /// `text` rather than being dropped.
        public let content: [Content]
        /// MCP's tool-level failure flag — the RPC itself succeeded even when this is true;
        /// consumers (e.g. `MCPApplyEditRouter`) branch on it to build a failure reply.
        public let isError: Bool

        /// Memberwise init — public so tests can fabricate results without a live server.
        public init(content: [Content], isError: Bool) {
            self.content = content
            self.isError = isError
        }

        /// One content item. Only `type` and `text` are decoded — the app consumes text
        /// content exclusively, so richer content kinds are preserved as type-only stubs.
        public struct Content: Sendable, Equatable {
            /// The MCP content type (e.g. `text`).
            public let type: String
            /// The text payload for `text` content; nil for other kinds.
            public let text: String?

            /// Memberwise init — public so tests can fabricate content items.
            public init(type: String, text: String?) {
                self.type = type
                self.text = text
            }
        }
    }

    private var transport: (any MCPTransport)?
    private var readerTask: Task<Void, Never>?

    // Stdio construction inputs retained so `start(...)` can build a StdioTransport.
    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter

    private var nextRequestID: Int = 1
    private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
    private var initialized: Bool = false

    private var clientName: String = "Anglesite"
    private var clientVersion: String = "0.1.0"
    private var initializeTimeout: TimeInterval = 10

    /// `supervisor`/`logCenter` are retained for the stdio path only — `start(...)` needs them
    /// to build a ``StdioTransport``. They're taken at construction even for an HTTP-only
    /// client because the transport choice isn't known until `start`/`connect` is called.
    public init(supervisor: ProcessSupervisor, logCenter: LogCenter = .shared) {
        self.supervisor = supervisor
        self.logCenter = logCenter
    }

    /// Whether a transport is currently held — set by a successful open, cleared by ``stop()``
    /// (a failed `start`/`connect` tears down before throwing, so this never reads true for a
    /// client whose startup failed).
    public var isRunning: Bool { transport != nil }

    /// Spawn the MCP server and run the `initialize` handshake. Returns once the server has
    /// responded with its capabilities. If the server later crashes, `ProcessSupervisor` restarts
    /// it per `restartPolicy` and the client re-runs `initialize` against the fresh process; calls
    /// that were in flight at the moment of the crash fail with `MCPError.reconnecting`.
    public func start(
        executable: URL,
        arguments: [String],
        environment: [String: String] = [:],
        source: String = "mcp",
        currentDirectoryURL: URL? = nil,
        restartPolicy: ProcessSupervisor.RestartPolicy = .onCrash(maxAttempts: 3, baseBackoff: 1.0),
        initializeTimeout: TimeInterval = 10,
        clientName: String = "Anglesite",
        clientVersion: String = "0.1.0"
    ) async throws {
        let t = StdioTransport(
            supervisor: supervisor,
            logCenter: logCenter,
            source: source,
            executable: executable,
            arguments: arguments,
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            restartPolicy: restartPolicy,
            onReconnect: { [weak self] in await self?.handleRespawn() }
        )
        try await startWithTransport(t, initializeTimeout: initializeTimeout, clientName: clientName, clientVersion: clientVersion)
    }

    /// Connect to an MCP server over Streamable HTTP at `httpEndpoint` (the full `…/mcp` URL) and run
    /// the initialize handshake. Mirrors `start(...)` but for the HTTP transport.
    public func connect(
        httpEndpoint: URL,
        bearerToken: SessionToken? = nil,
        urlSession: URLSession = .shared,
        initializeTimeout: TimeInterval = 10,
        clientName: String = "Anglesite",
        clientVersion: String = "0.1.0"
    ) async throws {
        let t = HTTPTransport(endpoint: httpEndpoint, bearerToken: bearerToken, urlSession: urlSession)
        try await startWithTransport(t, initializeTimeout: initializeTimeout, clientName: clientName, clientVersion: clientVersion)
    }

    /// Shared start path for any transport: open, start the reader, run the initialize handshake.
    func startWithTransport(
        _ t: any MCPTransport,
        initializeTimeout: TimeInterval,
        clientName: String,
        clientVersion: String
    ) async throws {
        if transport != nil { throw MCPError.alreadyRunning }
        self.transport = t
        self.clientName = clientName
        self.clientVersion = clientVersion
        self.initializeTimeout = initializeTimeout
        do {
            try await t.open()
        } catch {
            await teardown()
            throw error
        }
        readerTask = Task { [weak self] in
            guard let self else { return }
            await self.consumeResponses(t.inbound())
        }
        do {
            try await runInitializeHandshake()
            self.initialized = true
        } catch {
            await teardown()
            throw error
        }
    }

    /// Sends `initialize` (and the required `notifications/initialized` follow-up). Used both at
    /// `start(...)` and after a supervised respawn.
    private func runInitializeHandshake() async throws {
        let params: JSONValue = .object([
            "protocolVersion": .string("2024-11-05"),
            "capabilities": .object([:]),
            "clientInfo": .object([
                "name": .string(clientName),
                "version": .string(clientVersion),
            ]),
        ])
        _ = try await sendRequest(method: "initialize", params: params, timeout: initializeTimeout)
        // Notifications expect no response and the server may not care — ignore failure.
        try? await sendNotification(method: "notifications/initialized", params: nil)
    }

    /// Fired by `ProcessSupervisor` after it restarts the crashed server. The old stdin is gone
    /// (`send` writes by `Handle` through the supervisor, which targets the fresh pipe) and
    /// any in-flight requests can never be answered — fail them, drop `initialized`, then re-handshake.
    private func handleRespawn() async {
        let waiters = pending
        pending.removeAll()
        for cont in waiters.values { cont.resume(throwing: MCPError.reconnecting) }
        initialized = false
        do {
            try await runInitializeHandshake()
            initialized = true
        } catch {
            // Reconnect failed; stays un-initialized. The next call throws `.notInitialized`.
        }
    }

    /// Fetches the server's tool catalog. Entries missing a `name` are dropped rather than
    /// failing the whole list; a top-level shape without a `tools` array throws
    /// ``MCPError/invalidResponse(_:)``.
    public func listTools() async throws -> [ToolDescriptor] {
        guard initialized else { throw MCPError.notInitialized }
        let result = try await sendRequest(method: "tools/list", params: .object([:]), timeout: 5)
        guard case .object(let dict) = result, case .array(let tools)? = dict["tools"] else {
            throw MCPError.invalidResponse("tools/list missing 'tools' array")
        }
        return tools.compactMap { entry -> ToolDescriptor? in
            guard case .object(let obj) = entry, case .string(let name)? = obj["name"] else { return nil }
            let desc: String? = {
                if case .string(let s)? = obj["description"] { return s }
                return nil
            }()
            return ToolDescriptor(name: name, description: desc, inputSchema: obj["inputSchema"])
        }
    }

    /// Invokes a server tool and normalizes its result. Tool-level failure comes back as
    /// ``ToolCallResult/isError``, not a throw — only client/transport-layer problems throw,
    /// including ``MCPError/timeout`` after 30 seconds (deliberately longer than the other
    /// calls' deadlines; tool work is open-ended in a way `initialize`/`tools/list` are not).
    /// Cancellation is checked before sending so an already-cancelled task never reaches the
    /// wire; a cancel while awaiting surfaces as `CancellationError`.
    public func callTool(name: String, arguments: JSONValue = .object([:])) async throws -> ToolCallResult {
        guard initialized else { throw MCPError.notInitialized }
        try Task.checkCancellation()   // pre-call guard: never send for an already-cancelled task
        let params: JSONValue = .object([
            "name": .string(name),
            "arguments": arguments,
        ])
        let result = try await sendRequest(method: "tools/call", params: params, timeout: 30)
        guard case .object(let dict) = result else {
            throw MCPError.invalidResponse("tools/call result not an object")
        }
        let isError: Bool = {
            if case .bool(let b)? = dict["isError"] { return b }
            return false
        }()
        var contents: [ToolCallResult.Content] = []
        if case .array(let items)? = dict["content"] {
            for item in items {
                guard case .object(let obj) = item, case .string(let type)? = obj["type"] else { continue }
                let text: String? = {
                    if case .string(let s)? = obj["text"] { return s }
                    return nil
                }()
                contents.append(ToolCallResult.Content(type: type, text: text))
            }
        }
        return ToolCallResult(content: contents, isError: isError)
    }

    /// Closes the transport and fails every still-pending request with
    /// ``MCPError/notInitialized`` so no caller is left hanging. Safe to call when not running.
    public func stop() async {
        await teardown()
    }

    // MARK: Internals

    private func sendRequest(
        method: String,
        params: JSONValue?,
        timeout: TimeInterval
    ) async throws -> JSONValue {
        let id = nextRequestID
        nextRequestID += 1

        var obj: [String: JSONValue] = [
            "jsonrpc": .string("2.0"),
            "id": .int(id),
            "method": .string(method),
        ]
        if let params { obj["params"] = params }
        let message = JSONValue.object(obj)

        // Bound the wait: fail the pending request if no response arrives in time.
        let timeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(timeout, 0) * 1_000_000_000))
            if !Task.isCancelled { await self?.failPending(id: id, error: MCPError.timeout) }
        }
        defer { timeoutTask.cancel() }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<JSONValue, Error>) in
                // This closure runs synchronously on the actor, so the continuation is registered
                // *before* the send — a response (which the HTTP transport produces during `send`)
                // can never be missed, and there is no registration race.
                pending[id] = cont
                // Send on a detached task so a synchronous transport failure (e.g. connection refused)
                // resolves THIS continuation via `failPending` instead of leaking it. Every exit path —
                // response (`resolvePending` from the reader), timeout, cancellation, or send error —
                // resumes the continuation exactly once (`pending` removal guarantees single-resume).
                Task { [weak self] in
                    do {
                        try await self?.send(message)
                    } catch {
                        await self?.failPending(id: id, error: error)
                    }
                }
            }
        } onCancel: {
            // The awaiting task was cancelled. Resolve the pending continuation with Swift's
            // CancellationError (decision (b) — no MCPError.cancelled). If the response already
            // arrived, `failPending` finds no entry and no-ops, preserving single-resume.
            Task { [self] in await self.failPending(id: id, error: CancellationError()) }
        }
    }

    private func sendNotification(method: String, params: JSONValue?) async throws {
        var obj: [String: JSONValue] = [
            "jsonrpc": .string("2.0"),
            "method": .string(method),
        ]
        if let params { obj["params"] = params }
        try await send(.object(obj))
    }

    private func send(_ value: JSONValue) async throws {
        guard let transport else { throw MCPError.notInitialized }
        try await transport.send(value)
    }

    private func failPending(id: Int, error: Error) {
        if let cont = pending.removeValue(forKey: id) {
            cont.resume(throwing: error)
        }
    }

    private func resolvePending(id: Int, value: JSONValue) {
        if let cont = pending.removeValue(forKey: id) {
            cont.resume(returning: value)
        }
    }

    private func consumeResponses(_ stream: AsyncStream<JSONValue>) async {
        for await message in stream {
            guard case .object(let obj) = message else { continue }
            guard case .int(let id)? = obj["id"] else { continue }  // responses only

            if case .object(let errObj)? = obj["error"] {
                let code: Int = { if case .int(let c)? = errObj["code"] { return c }; return -1 }()
                let msg: String = { if case .string(let m)? = errObj["message"] { return m }; return "unknown rpc error" }()
                failPending(id: id, error: MCPError.rpcError(code: code, message: msg))
                continue
            }
            if let result = obj["result"] {
                resolvePending(id: id, value: result)
            } else {
                resolvePending(id: id, value: .null)
            }
        }
    }

    private func teardown() async {
        readerTask?.cancel()
        readerTask = nil
        if let transport { await transport.close() }
        transport = nil
        initialized = false
        for (_, cont) in pending { cont.resume(throwing: MCPError.notInitialized) }
        pending.removeAll()
    }
}
