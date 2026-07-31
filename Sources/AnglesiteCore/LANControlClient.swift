import Foundation

/// Where a LAN-hosted site runtime lives: a trusted machine on the local network (e.g. the
/// owner's Mac Studio) already running the site's dev server and MCP server, reachable over
/// plain TCP. Dev/test infrastructure for the UTM-VM rig (#589/#601) — not a production
/// runtime option. See `docs/specs/2026-07-09-lan-site-runtime-design.md`.
public struct LANRuntimeConfiguration: Sendable, Equatable {
    /// Default ports match the container guest convention (`ContainerizationControl`):
    /// `astro dev` on 4321, the Node MCP sidecar on 4399.
    public static let defaultPreviewPort = 4321
    /// The container-guest convention's MCP sidecar port (4399) — see `defaultPreviewPort`.
    public static let defaultMCPPort = 4399

    /// Hostname or IP of the LAN runtime host, e.g. `mac-studio.local` or `192.168.64.1`.
    public let host: String
    /// TCP port the host's `astro dev` preview listens on.
    public let previewPort: Int
    /// TCP port the host's MCP sidecar listens on.
    public let mcpPort: Int

    /// Creates a configuration for `host`, with both ports defaulting to the container-guest
    /// convention so a standard `anglesite-lan-host` invocation needs only the hostname.
    public init(
        host: String,
        previewPort: Int = Self.defaultPreviewPort,
        mcpPort: Int = Self.defaultMCPPort
    ) {
        self.host = host
        self.previewPort = previewPort
        self.mcpPort = mcpPort
    }

    /// `nil` when `host` can't form a valid URL (empty, embedded whitespace, …).
    public var previewURL: URL? { url(port: previewPort, path: "/") }
    /// The MCP Streamable-HTTP endpoint (`/mcp` path); `nil` under the same conditions as
    /// `previewURL`.
    public var mcpURL: URL? { url(port: mcpPort, path: "/mcp") }

    private func url(port: Int, path: String) -> URL? {
        guard !host.isEmpty, host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = port
        components.path = path
        return components.url
    }
}

/// `SandboxControlClient` over nothing: the host-side server process is assumed already running
/// and serving this site, so `start` performs no RPC — it just constructs the LAN URL pair
/// `RemoteSandboxSiteRuntime` expects. `gitRemote`/`gitRef`/`token` are accepted but unused: the
/// host serves its own working copy, and the trusted-LAN path skips bearer auth (the factory's
/// `connect` closure omits the token; see the design note's non-goals).
public struct LANControlClient: SandboxControlClient {
    /// `RemoteSandboxSiteRuntime.init` requires a `gitRemote`, but this control client never
    /// clones — the host process owns its working copy. Callers wiring a LAN runtime pass this
    /// explicit stand-in so no real-looking repo URL shows up in logs or state.
    public static let unusedGitRemote = URL(string: "lan-runtime://unused")!

    /// The host/port triple every session this client "starts" will point at.
    public let configuration: LANRuntimeConfiguration

    /// Creates a client for the given LAN runtime configuration.
    public init(configuration: LANRuntimeConfiguration) {
        self.configuration = configuration
    }

    /// Constructs the session's URL pair from the configuration — no RPC, no clone. The git
    /// and token parameters are ignored; see the type doc for why.
    ///
    /// - Throws: ``SandboxControlError/startFailed(_:)`` when the configured host can't form
    ///   valid URLs — the only way this client can fail.
    public func start(siteID: String, gitRemote: URL, gitRef: String, token: SessionToken) async throws -> SandboxSession {
        guard let previewURL = configuration.previewURL, let mcpURL = configuration.mcpURL else {
            throw SandboxControlError.startFailed("invalid LAN runtime host “\(configuration.host)”")
        }
        return SandboxSession(previewURL: previewURL, mcpURL: mcpURL)
    }

    /// The host process is a standing server with no status RPC; report ready and let the MCP
    /// connect or the preview load surface unreachability with a real error.
    public func status(siteID: String) async throws -> SandboxStatus {
        SandboxStatus(siteID: siteID, previewReady: true, mcpReady: true)
    }

    /// No-op: stopping the guest-side session must not stop the shared host process, which other
    /// guests (or the host's own Anglesite) may be using.
    public func stop(siteID: String) async throws {}
}
