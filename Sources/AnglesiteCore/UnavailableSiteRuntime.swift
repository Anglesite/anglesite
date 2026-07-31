import Foundation

/// A validation-blocked `SiteRuntime` used after host Node retirement when no container runtime is
/// available. It makes accidental fallback obvious: opening a site produces a failed preview state
/// instead of silently spawning the old host subprocess runtime.
public actor UnavailableSiteRuntime: SiteRuntime {
    private let reason: String
    /// A never-started client, present only to satisfy ``SiteRuntime`` — nothing in this runtime
    /// ever connects it, since no site process exists to talk to.
    public let mcpClient: MCPClient
    private let stateMachine = SiteRuntimeStateMachine()

    /// Creates the placeholder runtime with the human-readable `reason` that will surface as the
    /// failed preview state's message when a site is opened.
    public init(reason: String, mcpClient: MCPClient = MCPClient(supervisor: .shared)) {
        self.reason = reason
        self.mcpClient = mcpClient
    }

    /// Immediately fails: transitions straight to `.failed` with the configured reason instead of
    /// starting anything, so the UI shows *why* no runtime is available.
    public func start(siteID: String, siteDirectory: URL) async {
        stateMachine.setState(.failed(siteID: siteID, message: reason))
    }

    /// Resets to `.idle`; stops the (never-started) client for symmetry with real runtimes.
    public func stop() async {
        await mcpClient.stop()
        stateMachine.setState(.idle)
    }

    /// Streams state changes exactly like a real runtime, so `PreviewModel` observes the failure
    /// through the same seam it uses everywhere else.
    public func observe() -> AsyncStream<SiteRuntimeState> {
        stateMachine.observe()
    }
}
