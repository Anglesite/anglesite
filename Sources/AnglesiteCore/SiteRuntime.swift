import Foundation

/// The lifecycle state of one site's live preview, independent of where it runs.
public enum SiteRuntimeState: Sendable, Equatable {
    /// No site is running — the initial state, and where `stop()` settles.
    case idle
    /// Boot in progress (container start, hydration, dev-server launch). Carries the site ID so
    /// observers can drop transitions belonging to a superseded site.
    case starting(siteID: String)
    /// `workersDevURL` is the local `wrangler dev --local` endpoint, present only when the site's
    /// effective active-worker set was non-empty at start time (#708) — `nil` for a static-only
    /// site, and always `nil` for `RemoteSandboxSiteRuntime`/`UnavailableSiteRuntime` (a
    /// local-container-only capability for v1). Defaulted so every existing `.ready(siteID:url:)`
    /// construction site keeps compiling unchanged.
    case ready(siteID: String, url: URL, workersDevURL: URL? = nil)
    /// Couldn't preview this site (deps not installed, dev server crashed, etc.). `message` is
    /// shown to the owner; the Debug pane has the full subprocess output.
    case failed(siteID: String, message: String)
}

/// Failures that prevent a runtime edit from becoming durable in the canonical `Source/` repo.
public enum SiteRuntimePersistenceError: LocalizedError, Sendable, Equatable {
    /// The edit server returned no (or a malformed) commit SHA, so there is nothing verifiable to
    /// sync back — better to fail than to guess at which guest state to persist.
    case missingOrInvalidCommit
    /// The runtime stopped (or was superseded) between the edit and the persistence hop.
    case runtimeNotRunning
    /// The guest-to-host sync itself failed; the message is the underlying tool's own output.
    case syncFailed(String)

    /// Owner-facing message per case; the Debug pane carries the full underlying output.
    public var errorDescription: String? {
        switch self {
        case .missingOrInvalidCommit:
            "the edit server did not return a valid git commit"
        case .runtimeNotRunning:
            "the site runtime is no longer running"
        case .syncFailed(let message):
            message
        }
    }
}

/// The local-Apple-Containerization-only capability surface reachable from a `SiteRuntime` via
/// `containerCapability` (#823): the container control snapshot the deploy/ACP path executes
/// commands through, the network-reset action the failure pane's "Restart Networking" button
/// drives, and the guest-to-host edit persistence hop. `AnyObject`-bound so callers (e.g.
/// `PreviewModel.editPersister(for:)`) can capture it `[weak]` the same way they used to capture
/// a weak `LocalContainerSiteRuntime`.
///
/// Only `LocalContainerSiteRuntime` conforms and returns itself from `containerCapability`; every
/// other `SiteRuntime` inherits the `nil` default below, so callers reach these members through
/// this accessor instead of `as? LocalContainerSiteRuntime`.
public protocol SiteRuntimeContainerCapability: AnyObject, Sendable {
    /// The control and the currently-started site ID, read in a single hop — `nil` before the
    /// container finishes booting and after it stops.
    func containerSnapshot() async -> (control: any LocalContainerControl, siteID: String)?
    /// Restarts the container's network path after a networking failure. Reaches the underlying
    /// control unconditionally (no live-container gate), mirroring
    /// `LocalContainerSiteRuntime.resetNetworking()`.
    func resetNetworking() async
    /// Hands a guest-side edit commit back to the canonical `Source/` repo.
    func persistEdit(commit: String?) async throws
    /// Recomputes the effective active-worker set from `settings` and restarts (or stops) the
    /// local wrangler-dev session to match — the Workers tab (#710) calls this on toggle. See
    /// `LocalContainerSiteRuntime.updateActiveWorkers`.
    func updateActiveWorkers(_ settings: SiteSettings) async
}

/// One runtime = one site's live preview. This is the seam for swapping execution substrates
/// (see #59 / design doc §4): a container exposes an HTTP/WS URL rather than a pid + pipes, so the
/// abstraction lives here — at `PreviewSession`'s old level — not at `SupervisorBackend`.
///
/// `start(siteID:siteDirectory:)` tears down any previous site first and settles to `.ready` /
/// `.failed`; `observe()` streams every `SiteRuntimeState` transition; `mcpClient` is the per-site
/// MCP connection the edit pipeline and annotation feed route through.
///
/// Refines `Actor`: every conformer owns mutable lifecycle state, so isolation is intrinsic — and a class-bound existential keeps the
/// `[weak]` capture `PreviewModel` uses for its edit router valid.
///
/// `mcpClient` is the substrate-agnostic MCP seam for the running container endpoint.
public protocol SiteRuntime: Actor {
    /// Boots `siteID`'s preview from `siteDirectory` (the package's `Source/`), tearing down any
    /// previously running site first — one runtime never hosts two sites. Never throws: it
    /// settles to `.ready` or `.failed`, observable via `observe()`, so every caller handles
    /// failure through the same state channel.
    func start(siteID: String, siteDirectory: URL) async
    /// Tears down the running site (if any) and settles to `.idle`. Safe to call redundantly.
    func stop() async

    /// Pauses this site's runtime instead of fully stopping it, when the substrate supports it —
    /// e.g. `LocalContainerSiteRuntime` pauses the VM in place so a later `start(siteID:
    /// siteDirectory:)` for the SAME siteID resumes in seconds instead of cold-booting. Defaults
    /// to a full `stop()` below for every conformer without a pause capability
    /// (`RemoteSandboxSiteRuntime`, `UnavailableSiteRuntime`) — closing a window against one of
    /// those behaves exactly as it does today.
    func suspend() async

    /// Streams every ``SiteRuntimeState`` transition, replaying the current state to each new
    /// subscriber first — an observer attached after `.ready` still learns the URL.
    /// Deliberately non-`async` so UI code can subscribe without hopping onto the runtime actor
    /// (see `SiteRuntimeStateMachine` for the implementation consequence).
    func observe() -> AsyncStream<SiteRuntimeState>
    /// The per-site MCP connection the edit pipeline and annotation feed route through —
    /// substrate-agnostic: the transport underneath differs per conformer, the client doesn't.
    var mcpClient: MCPClient { get }
    /// The container-only capability surface (deploy execution context, network reset, edit
    /// persistence) — `nil` unless this runtime is a local Apple-Containerization runtime. See
    /// `SiteRuntimeContainerCapability`.
    ///
    /// `nonisolated`, unlike `mcpClient` above: callers need to branch on nil-vs-non-nil
    /// synchronously (the same way the `as? LocalContainerSiteRuntime` downcast it replaces was
    /// synchronous) — e.g. `PreviewModel.editPersister(for:)` resolves it inside a non-`async`
    /// function. Every conformer's witness just returns `self` or `nil`, never touching isolated
    /// state, so `nonisolated` is safe to implement everywhere.
    nonisolated var containerCapability: (any SiteRuntimeContainerCapability)? { get }
}

public extension SiteRuntime {
    /// Default for every conformer that isn't `LocalContainerSiteRuntime`: no container-only
    /// capabilities to expose.
    nonisolated var containerCapability: (any SiteRuntimeContainerCapability)? { nil }

    func suspend() async { await stop() }
}
