import Foundation

/// The two tunnel URLs a started remote session exposes: the preview (auth-proxy port) and the
/// in-container MCP server. Both are `*.trycloudflare.com` quick-tunnel URLs.
public struct SandboxSession: Sendable, Equatable {
    /// URL of the auth-proxied dev-server preview the WKWebView loads.
    public let previewURL: URL
    /// URL of the in-container MCP server (HTTP/Streamable transport).
    public let mcpURL: URL
    /// Wraps the two tunnel URLs the Control Worker returned from `start`.
    public init(previewURL: URL, mcpURL: URL) {
        self.previewURL = previewURL
        self.mcpURL = mcpURL
    }
}

/// Reachability snapshot of a remote session's two endpoints. Tracked per-endpoint because the
/// preview proxy and the MCP server come up independently — the UI can show partial progress
/// instead of one opaque spinner.
public struct SandboxStatus: Sendable, Equatable {
    /// The site whose sandbox was probed.
    public let siteID: String
    /// Whether the in-guest preview proxy answered the probe.
    public let previewReady: Bool
    /// Whether the in-container MCP endpoint answered the probe.
    public let mcpReady: Bool

    /// Memberwise creation from the Control Worker's status response.
    public init(siteID: String, previewReady: Bool, mcpReady: Bool) {
        self.siteID = siteID
        self.previewReady = previewReady
        self.mcpReady = mcpReady
    }

    /// Fully usable: both endpoints are reachable.
    public var isReady: Bool { previewReady && mcpReady }
}

/// Failures from the Control Worker seam, categorized by what the caller should do next
/// (onboard, re-auth, retry, surface) rather than by transport detail.
public enum SandboxControlError: Error, Equatable {
    /// No Control Worker / token on file → route to onboarding.
    case notProvisioned
    /// Token rejected by the Worker.
    case unauthorized
    /// Network / DNS failure reaching the Worker.
    case unreachable(String)
    /// Worker reported a boot/clone/hydrate failure.
    case startFailed(String)
}

/// Typed wrapper over the user's Control Worker RPCs. The HTTPS impl (`HTTPSandboxControlClient`)
/// is one conformer; tests use `FakeSandboxControlClient`. No Cloudflare types leak across this seam.
public protocol SandboxControlClient: Sendable {
    /// Boot (or resume) the sandbox for `siteID`, clone `gitRemote` at `gitRef`, start the in-guest
    /// processes with `token` in their environment, and return the two tunnel URLs.
    func start(siteID: String, gitRemote: URL, gitRef: String, token: SessionToken) async throws -> SandboxSession
    /// Probe whether the in-guest preview proxy and MCP endpoint are reachable.
    func status(siteID: String) async throws -> SandboxStatus
    /// Stop the session (drop tunnels, let the sandbox sleep).
    func stop(siteID: String) async throws
}
