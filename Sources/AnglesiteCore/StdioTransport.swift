import Foundation

/// `MCPTransport` over a supervised subprocess's stdio (today's only transport). `send` writes a
/// newline-framed JSON object to the child's stdin via the supervisor; `inbound()` yields each
/// stdout line (filtered to this transport's `source`) parsed as a `JSONValue`. On a supervised
/// respawn the supervisor calls `onReconnect`, which `MCPClient` uses to re-run its handshake.
public actor StdioTransport: MCPTransport {
    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    private let source: String
    private let executable: URL
    private let arguments: [String]
    private let environment: [String: String]
    private let currentDirectoryURL: URL?
    private let restartPolicy: ProcessSupervisor.RestartPolicy
    private let onReconnect: @Sendable () async -> Void

    private var handle: ProcessSupervisor.Handle?
    private var subscription: LogCenter.Subscription?
    private var forwardTask: Task<Void, Never>?

    private let stream: AsyncStream<JSONValue>
    private let continuation: AsyncStream<JSONValue>.Continuation

    /// Creates a transport that will spawn `executable` under `supervisor` when opened. `source`
    /// is the ``LogCenter`` tag the child's output is filed under — it doubles as the filter key
    /// `inbound()` uses to pick this process's stdout lines out of the shared log stream, so it
    /// must be unique per transport. `onReconnect` fires after every supervised respawn (never for
    /// the initial launch), giving `MCPClient` its hook to re-run the MCP handshake against the
    /// fresh process.
    public init(
        supervisor: ProcessSupervisor,
        logCenter: LogCenter,
        source: String,
        executable: URL,
        arguments: [String],
        environment: [String: String],
        currentDirectoryURL: URL?,
        restartPolicy: ProcessSupervisor.RestartPolicy,
        onReconnect: @escaping @Sendable () async -> Void
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.source = source
        self.executable = executable
        self.arguments = arguments
        self.environment = environment
        self.currentDirectoryURL = currentDirectoryURL
        self.restartPolicy = restartPolicy
        self.onReconnect = onReconnect
        (self.stream, self.continuation) = AsyncStream<JSONValue>.makeStream(bufferingPolicy: .unbounded)
    }

    /// Launches the supervised child with a stdin pipe attached and starts forwarding its stdout
    /// into the inbound stream. The log subscription is opened *before* the launch so no early
    /// output can slip past the forwarder.
    public func open() async throws {
        let sub = await logCenter.subscribe()
        self.subscription = sub
        let h = try await supervisor.launch(
            source: source,
            executable: executable,
            arguments: arguments,
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            restartPolicy: restartPolicy,
            attachStdin: true,
            onRespawn: { [onReconnect] in await onReconnect() },
            logCenter: logCenter
        )
        self.handle = h
        // Forward parsed stdout frames into the inbound stream. Captures only value types + the
        // subscription stream — no `self` — so the task doesn't keep the transport alive.
        forwardTask = Task { [source, continuation] in
            for await line in sub.stream {
                guard line.source == source, line.stream == .stdout else { continue }
                guard let data = line.text.data(using: .utf8),
                      let raw = try? JSONSerialization.jsonObject(with: data),
                      let value = JSONValue.from(raw)
                else { continue }
                continuation.yield(value)
            }
        }
    }

    /// Writes `message` to the child's stdin as one newline-terminated JSON line. Both "not yet
    /// opened" and "the write itself failed" surface as `MCPClient.MCPError.notInitialized` — from
    /// the client's perspective either way means "no usable connection; re-handshake", and the
    /// respawn path's `onReconnect` is what restores it.
    public func send(_ message: JSONValue) async throws {
        guard let handle else { throw MCPClient.MCPError.notInitialized }
        var data = try JSONSerialization.data(withJSONObject: message.rawValue, options: [])
        data.append(0x0A)  // '\n' — one JSON object per line; framing must be byte-identical.
        do {
            try await supervisor.writeStdin(handle, data)
        } catch {
            throw MCPClient.MCPError.notInitialized
        }
    }

    /// The single backing stream of parsed stdout frames. Created in `init` (not `open()`), so a
    /// caller may start iterating before the process is even launched; `nonisolated` because it
    /// only hands out an immutable stored property.
    public nonisolated func inbound() -> AsyncStream<JSONValue> { stream }

    /// Stops forwarding, terminates the child (SIGTERM with a 2 s SIGKILL escalation), waits for
    /// its exit, and finishes the inbound stream — in that order, so no consumer sees the stream
    /// end while the process could still emit frames.
    public func close() async {
        forwardTask?.cancel()
        forwardTask = nil
        subscription?.cancel()
        subscription = nil
        if let h = handle {
            await supervisor.terminate(h, timeout: 2)
            _ = await supervisor.waitForExit(h)
        }
        handle = nil
        continuation.finish()
    }
}
