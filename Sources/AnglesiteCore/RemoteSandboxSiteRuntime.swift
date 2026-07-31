import Foundation

/// `SiteRuntime` over a Cloudflare Sandbox (iOS-only; see design 2026-06-23). Drives a
/// `SandboxControlClient`: mint a token, start the session, connect the MCP client to the returned MCP tunnel,
/// settle to `.ready`/`.failed`. Spawns nothing locally.
public actor RemoteSandboxSiteRuntime: SiteRuntime {
    private let gitRemote: URL
    private let gitRef: String
    private let control: any SandboxControlClient
    /// The per-site MCP connection the edit pipeline routes through. `start` connects it to the
    /// session's MCP tunnel URL with the freshly-minted bearer token, so consumers always talk to
    /// the sandbox this runtime most recently booted.
    public let mcpClient: MCPClient
    private let mintToken: @Sendable () -> SessionToken
    private let connect: @Sendable (MCPClient, URL, SessionToken) async throws -> Void

    private let stateMachine = SiteRuntimeStateMachine()
    private var activeSiteID: String?

    /// Creates a runtime bound to one git remote+ref, with injectable token-minting and
    /// MCP-connect steps.
    ///
    /// - Parameters:
    ///   - gitRemote: The site's canonical `Source/` repository — the sandbox clones this, per
    ///     "git is the source of truth" (#72); there is no local working copy on iOS.
    ///   - gitRef: The ref the sandbox checks out from `gitRemote`.
    ///   - control: The Control Worker RPC seam that boots/stops the sandbox session.
    ///   - mcpClient: The client `connect` wires to the session's MCP tunnel; exposed as
    ///     ``mcpClient`` for the edit pipeline.
    ///   - mintToken: Test seam for the per-session bearer secret; defaults to
    ///     ``SessionToken/mint()``.
    ///   - connect: Test seam for the MCP-connect step, so tests can observe/fail the handshake
    ///     without a real HTTP transport; defaults to `MCPClient.connect(httpEndpoint:bearerToken:)`.
    public init(
        gitRemote: URL,
        gitRef: String,
        control: any SandboxControlClient,
        mcpClient: MCPClient,
        mintToken: @escaping @Sendable () -> SessionToken = { SessionToken.mint() },
        connect: @escaping @Sendable (MCPClient, URL, SessionToken) async throws -> Void = { c, u, token in
            try await c.connect(httpEndpoint: u, bearerToken: token)
        }
    ) {
        self.gitRemote = gitRemote
        self.gitRef = gitRef
        self.control = control
        self.mcpClient = mcpClient
        self.mintToken = mintToken
        self.connect = connect
    }

    /// The current lifecycle state, read from the shared `SiteRuntimeStateMachine` so it always
    /// reflects the most recent (non-superseded) start/stop attempt.
    public var state: SiteRuntimeState { stateMachine.state }

    /// Streams every ``SiteRuntimeState`` transition, starting with the current state — the UI's
    /// single source for spinner/ready/failure rendering.
    public func observe() -> AsyncStream<SiteRuntimeState> {
        stateMachine.observe()
    }

    /// `siteDirectory` is unused on the remote path (no local files on iOS); the git remote + ref
    /// come from `init`. Tears down any previous session, then settles to `.ready`/`.failed`.
    public func start(siteID: String, siteDirectory: URL) async {
        await teardown()
        let gen = stateMachine.beginStarting(siteID: siteID)
        do {
            let token = mintToken()
            let session = try await control.start(
                siteID: siteID, gitRemote: gitRemote, gitRef: gitRef, token: token)
            // A superseding start()/stop() may have run its teardown() while this attempt was
            // suspended above — before `activeSiteID` was assigned, so that teardown() had nothing
            // of ours to stop. If we've been superseded, this attempt alone knows about the session
            // it just created, so it alone is responsible for tearing it down.
            guard stateMachine.isCurrent(gen) else { try? await control.stop(siteID: siteID); return }
            try await connect(mcpClient, session.mcpURL, token)
            guard stateMachine.isCurrent(gen) else { try? await control.stop(siteID: siteID); return }
            activeSiteID = siteID
            stateMachine.settle(gen: gen, to: .ready(siteID: siteID, url: session.previewURL))
        } catch {
            stateMachine.settle(gen: gen, to: .failed(siteID: siteID, message: Self.friendlyMessage(for: error)))
        }
    }

    /// Tears down the session and settles to `.idle` — unless a start()/stop() issued while this
    /// one was suspended has superseded it, in which case the newer attempt owns the state.
    public func stop() async {
        let gen = stateMachine.beginAttempt()
        await teardown()
        // Actors are reentrant, so a start()/stop() issued while teardown() was suspended has
        // superseded this stop and owns the state now — emitting `.idle` here would clobber its
        // `.starting`/`.ready` (the rapid Stop → Restart race, PR #542 review): the UI would show
        // the boot spinner forever while the dev server is actually running.
        stateMachine.settle(gen: gen, to: .idle)
    }

    // MARK: Internals

    private func teardown() async {
        // Clear `activeSiteID` before the suspensions, not after: a superseding start() can
        // complete a new boot (and re-assign `activeSiteID`) while this teardown is suspended in
        // `control.stop`, and nilling on resume would clobber the newer boot's bookkeeping —
        // orphaning its session. Clearing first also means overlapping teardowns stop the
        // session exactly once (PR #542 review).
        let sessionSiteID = activeSiteID
        activeSiteID = nil
        await mcpClient.stop()
        if let id = sessionSiteID {
            try? await control.stop(siteID: id)
        }
    }

    static func friendlyMessage(for error: Error) -> String {
        switch error {
        case SandboxControlError.notProvisioned: return "Connect a Cloudflare account to preview this site."
        case SandboxControlError.unauthorized:   return "Cloudflare rejected the session. Reconnect your account."
        case SandboxControlError.unreachable(let m): return "Couldn't reach Cloudflare: \(m)"
        case SandboxControlError.startFailed(let m): return "Couldn't start the remote preview: \(m)"
        default: return "Couldn't start the remote preview: \(error)"
        }
    }
}
