import Foundation

/// `ACPTransport` over a local ACP agent process running inside the site's own container —
/// launched via `LocalContainerControl.execInteractive`, alongside the dev server and MCP sidecar
/// (not a host `ProcessSupervisor` subprocess; see the ACP agent settings design spec §3 for why
/// neither existing `MCPTransport` conformer fits this). Each `send` writes one newline-framed
/// JSON-RPC message to the guest process's stdin; `inbound()` parses each stdout line as a
/// `JSONValue`. Every line on BOTH streams also flows to `LogCenter` ("logs are sacred" — every
/// spawned subprocess streams stdout+stderr into the debug pane, matching `StdioTransport`'s
/// existing MCP protocol-traffic-is-visible precedent), tagged `source: "acp:<siteID>"`.
public actor ACPContainerExecTransport: ACPTransport {
    private let control: any LocalContainerControl
    private let siteID: String
    private let command: String
    private let arguments: [String]
    private let workingDirectory: String
    private let logCenter: LogCenter

    private var handle: InteractiveExecHandle?
    private let stream: AsyncStream<JSONValue>
    private let continuation: AsyncStream<JSONValue>.Continuation

    /// Captures the launch parameters without spawning anything — the guest process starts in
    /// ``open()``.
    ///
    /// - Parameters:
    ///   - control: the container runtime whose `execInteractive` spawns the agent in the guest.
    ///   - siteID: selects which site's live container to exec into.
    ///   - command: the agent executable to run inside the guest.
    ///   - arguments: arguments passed to `command` verbatim.
    ///   - workingDirectory: defaults to `/workspace/site`, the fixed guest path every site repo
    ///     is cloned to inside its container (the same convention `ACPAssistant` and
    ///     `DeployExecutor` rely on).
    ///   - logCenter: injectable for tests; production uses the shared instance so the agent's
    ///     output lands in the debug pane alongside everything else.
    public init(
        control: any LocalContainerControl,
        siteID: String,
        command: String,
        arguments: [String],
        workingDirectory: String = "/workspace/site",
        logCenter: LogCenter = .shared
    ) {
        self.control = control
        self.siteID = siteID
        self.command = command
        self.arguments = arguments
        self.workingDirectory = workingDirectory
        self.logCenter = logCenter
        (self.stream, self.continuation) = AsyncStream<JSONValue>.makeStream(bufferingPolicy: .unbounded)
    }

    /// Spawns the agent process in the container via `execInteractive`. Stdout lines that parse
    /// as JSON become inbound messages; non-JSON stdout (a startup banner, say) is logged but
    /// deliberately skipped rather than failing the stream, and stderr is log-only — an agent
    /// that chats on stderr can't corrupt the protocol channel.
    public func open() async throws {
        let logSource = "acp:\(siteID)"
        handle = try await control.execInteractive(
            siteID: siteID,
            argv: [command] + arguments,
            environment: [:],
            workingDirectory: workingDirectory,
            onOutput: { [continuation, logCenter] line, stream in
                Task { await logCenter.append(source: logSource, stream: stream, text: line) }
                guard stream == .stdout else { return }
                guard let data = line.data(using: .utf8),
                      let raw = try? JSONSerialization.jsonObject(with: data),
                      let value = JSONValue.from(raw) else { return }
                continuation.yield(value)
            }
        )
    }

    /// Writes one newline-framed JSON-RPC message to the guest process's stdin. Throws
    /// `ACPTransportError.notOpen` if ``open()`` hasn't run (or failed) — fail fast rather than
    /// queue writes for a process that doesn't exist.
    public func send(_ message: JSONValue) async throws {
        guard let handle else { throw ACPTransportError.notOpen }
        let data = try JSONSerialization.data(withJSONObject: message.rawValue)
        try await handle.write(data + Data("\n".utf8))
    }

    /// The parsed-stdout message stream. `nonisolated` (the stream/continuation pair is created
    /// at init and never reassigned) so `ACPClient` can obtain it without an actor hop, even
    /// before ``open()``.
    public nonisolated func inbound() -> AsyncStream<JSONValue> { stream }

    /// Terminates the guest process and finishes the inbound stream, so the consumer's
    /// `for await` loop ends instead of hanging on a process that will never print again.
    public func close() async {
        await handle?.terminate()
        continuation.finish()
    }
}

/// Errors shared by `ACPTransport` conformers (only the stdio transport throws it today —
/// `ACPHTTPTransport` has no open/closed state to violate).
public enum ACPTransportError: Error, Sendable, Equatable {
    /// `send` was called before `open()` succeeded — there is no guest process to write to.
    case notOpen
}
