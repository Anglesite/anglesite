import SwiftUI
import WebKit
import AnglesiteBridge
import AnglesiteCore

/// SwiftUI-facing wrapper over a `SiteRuntime` actor: mirrors the runtime's `SiteRuntimeState` into
/// an observable property and exposes `open(...)` / `close()` for the view layer.
///
/// Owns one `SiteRuntime`; opening a different site reuses it (the runtime tears down the previous
/// one first). For v1 multi-site each window will own its own `PreviewModel`.
@MainActor
@Observable
final class PreviewModel {
    private(set) var state: SiteRuntimeState = .idle
    /// The site this model was last asked to open, so the UI can show "preview of X" even while
    /// the runtime is still `.starting`.
    private(set) var openSiteID: String?

    /// The `Source/` directory of the last-opened site, kept so the Site ▸ Start/Restart Dev
    /// Server commands (#515) can re-launch the runtime without re-resolving the site. Cleared
    /// in `close()` alongside `openSiteID`.
    private(set) var openSiteDirectory: URL?

    /// True after Site ▸ Stop Dev Server: distinguishes an owner-stopped `.idle` (show the
    /// stopped pane with a Start button) from the transient pre-boot `.idle` (show the spinner).
    /// Cleared by every start path (`open`/`startDevServer`/`restartDevServer`).
    private(set) var devServerStoppedByUser = false

    /// Set by SiteWindowModel right before calling `open()` following an accepted
    /// dependency update (Task 9) — that boot will hit the slow `npm install` path
    /// instead of the instant hardlink path (the lockfile was just deleted), so the
    /// loading UI should say so rather than looking like the #502 stall. Cleared
    /// whenever `state` settles to `.ready` or `.failed`.
    var isUpdatingDependencies = false

    /// The page route the preview should show, set by `navigate(toRoute:)` (e.g. from
    /// `PreviewSiteIntent`). `nil` means the site root. Persisted, not consumed, so a dev-server
    /// restart that rebinds the port re-derives the target against the new base URL.
    private(set) var activeRoute: String?

    private let runtime: any SiteRuntime

    /// The live preview `WKWebView`, registered by `PreviewView` when it's created and detached
    /// via `detachWebView(_:)` when SwiftUI dismantles it. Weak: SwiftUI's `NSViewRepresentable`
    /// owns the web view's lifetime; the model only borrows it for the preview navigation commands
    /// (#514: reload, back/forward, zoom). Setting it (re)installs the KVO mirrors for `canGoBack`/`canGoForward`
    /// and re-applies the persisted `zoomLevel`, so a web view recreated across a dev-server
    /// restart keeps the user's zoom.
    ///
    /// The explicit detach path matters: ARC zeroing a weak var does NOT fire `didSet`, so
    /// relying on zeroing alone would leave the KVO mirrors frozen at their last values whenever
    /// the web view is torn down without a replacement (dev-server restart/failure switches
    /// `previewPane` off the `.ready` branch) — Back/Forward would stay enabled with no web view.
    weak var webView: WKWebView? {
        didSet {
            guard oldValue !== webView else { return }
            observeNavigationState()
            webView?.pageZoom = CGFloat(zoomLevel)
        }
    }

    /// Mirrors of `WKWebView.canGoBack`/`.canGoForward`, observable so the View-menu Back/Forward
    /// items enable/disable live. KVO-fed by `observeNavigationState()`; reset to false when the
    /// web view detaches (`detachWebView(_:)`) or is replaced.
    private(set) var canGoBack = false
    private(set) var canGoForward = false

    /// The preview's page-zoom level (View ▸ Zoom In/Out/Actual Size, #514). Owned by the model —
    /// not read back from the web view — so it survives web-view recreation. Always one of
    /// `PreviewZoom.levels`.
    private(set) var zoomLevel: Double = PreviewZoom.actualSize

    /// KVO tokens for the `canGoBack`/`canGoForward` mirrors; replaced whenever `webView` changes
    /// and cleared on `detachWebView(_:)`. Note the modern closure-based `observe(...)` token does
    /// NOT retain the observed object — it holds it weakly and auto-invalidates when the observed
    /// object deallocates (verified empirically on the Swift 6.4 toolchain), so a stale token here
    /// cannot keep a torn-down web view alive; clearing on detach is about resetting the mirrors,
    /// not about breaking a retain.
    private var webViewObservations: [NSKeyValueObservation] = []

    /// The `EditRouter` that the WKWebView's `AnglesiteScriptHandler` forwards overlay edits to.
    /// Wired to the runtime's `MCPClient` via a weak getter so the router doesn't outlive the
    /// model. If the MCP client isn't running (runtime not started yet, or graceful spawn
    /// failure), `MCPApplyEditRouter` returns `.failed("MCP not running")` per its existing shape.
    private(set) var editRouter: EditRouter

    /// `contentGraph` is the app-lifetime `SiteContentGraph` (held by `AppDelegate`); it's threaded
    /// into the live runtime factory so opening this site populates the shared graph (A.8,
    /// #142). Tests can inject an explicit `runtime` and leave the graph `nil`.
    convenience init(
        contentGraph: SiteContentGraph? = nil,
        knowledgeIndex: SiteKnowledgeIndex? = nil,
        semanticRanker: SemanticRanker? = nil,
        conventionsEngine: ProjectConventionsEngine? = nil,
        runtimeFactory: any SiteRuntimeFactory
    ) {
        self.init(runtime: runtimeFactory.makeRuntime(
            contentGraph: contentGraph,
            knowledgeIndex: knowledgeIndex,
            semanticRanker: semanticRanker,
            conventionsEngine: conventionsEngine
        ))
    }

    init(runtime: any SiteRuntime) {
        self.runtime = runtime
        self.editRouter = MCPApplyEditRouter(
            mcpClient: { [weak runtime] in
                // `runtime` is the actor instance; reading `mcpClient` hops onto the actor.
                await runtime?.mcpClient
            },
            persistEdit: Self.editPersister(for: runtime)
        )
        // Mirror runtime state into `state`. `[weak self]` so the model can still be freed; the
        // stream itself outlives a freed model (one PreviewModel per window today, so it's moot).
        Task { @MainActor [weak self] in
            for await newState in await runtime.observe() {
                self?.state = newState
                // Any transition acknowledges the last dispatched dev-server command — every
                // accepted start/stop produces at least one (see `devServerCommandInFlight`).
                self?.devServerCommandInFlight = false
                switch newState {
                case .ready, .failed:
                    self?.isUpdatingDependencies = false
                case .idle, .starting:
                    break
                }
            }
        }
    }

    /// Re-build the edit router with an observer attached. Called by `SiteWindow.loadAndStart`
    /// after `ChatModel` is constructed, so each successful `apply_edit` reply also fires
    /// `ChatModel.recordEdit(_:)` — surfacing the edit as an `.edit` row in the chat panel.
    ///
    /// Subsequent calls replace the prior observer (the router is fully reconstructed each time
    /// with the same `mcpClient` getter; `MCPApplyEditRouter` is a struct so this is cheap). The
    /// new router is re-registered in `EditRouterRegistry.shared` so `EditContentIntent`
    /// (B.5 / #149) routes through the same observer-equipped instance — otherwise the chat
    /// panel would miss Siri-driven edits.
    /// `postProcess` (optional) runs after each successful edit — wired by `SiteWindow` to
    /// `AltTextGenerator` so an image drop auto-generates and applies alt text (C.7 / #157).
    func setEditObserver(
        _ onEdit: @escaping MCPApplyEditRouter.EditObserver,
        postProcess: MCPApplyEditRouter.PostProcessor? = nil
    ) {
        self.editRouter = MCPApplyEditRouter(
            mcpClient: { [weak self] in
                guard let self else { return nil }
                return await self.runtime.mcpClient
            },
            onEdit: onEdit,
            persistEdit: Self.editPersister(for: runtime),
            postProcess: postProcess
        )
        if let siteID = openSiteID {
            let current = self.editRouter
            Task { await EditRouterRegistry.shared.register(current, for: siteID) }
        }
    }

    /// Local container edits happen in a hydrated clone. Their commit must be handed back to the
    /// host repo before the bridge acknowledges success. Other runtime types retain their own
    /// persistence semantics, so the hook is intentionally absent for them — reached via
    /// `containerCapability` (#823) rather than an `as? LocalContainerSiteRuntime` downcast.
    private static func editPersister(for runtime: any SiteRuntime) -> MCPApplyEditRouter.EditPersister? {
        guard let capability = runtime.containerCapability else { return nil }
        return { [weak capability] reply in
            guard let capability else { throw SiteRuntimePersistenceError.runtimeNotRunning }
            guard reply.commit != nil else { return }
            try await capability.persistEdit(commit: reply.commit)
        }
    }

    func open(site: CurrentSite) {
        let siteID = site.id
        let siteDirectory = site.sourceDirectory
        openSiteID = siteID
        openSiteDirectory = siteDirectory
        devServerStoppedByUser = false
        // `open` dispatches a boot just like the menu commands do, and `siteOpenForDevServer`
        // just became true while `state` may still read `.idle` — without this, Site ▸ Start
        // would be enabled during the dispatch gap and could race the opening boot.
        let token = markDevServerCommandInFlight()
        let router = self.editRouter
        Task {
            // Register before starting the runtime so a Siri edit fired during dev-server boot
            // hits the router (and gets an "MCP not running" failure reply) rather than
            // returning the bridge's no-router fallback message.
            await EditRouterRegistry.shared.register(router, for: siteID)
            await runtime.start(siteID: siteID, siteDirectory: siteDirectory)
            // #587: pull any visitor submissions staged since the site was last open and commit
            // them into the git working copy. No-ops for sites without inbox capture configured
            // (SiteSettings.inboxCapture{AccountID,KVNamespaceID} unset).
            let configDirectory = siteDirectory.deletingLastPathComponent()
                .appendingPathComponent("Config", isDirectory: true)
            _ = await InboxSubmissionSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            // #362: pull the webmention Worker's verified inbox from D1 and snapshot it into the
            // git working copy. No-ops for sites without a provisioned D1 database
            // (SiteSettings.provisionedWorkerResources.d1DatabaseID unset).
            _ = await ReceivedInteractionSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            // #912: pull Micropub-created posts from MICROPUB_DB and sync each into a typed
            // content file under src/content/. No-ops for sites without a provisioned D1
            // database (same gate as ReceivedInteractionSync — Micropub shares the database).
            _ = await MicropubContentSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            // #908: pull a hosted community's own announced-post outbox and snapshot it into the
            // git working copy. No-ops for sites that aren't a hosted community
            // (SiteSettings.communityOutboxURL unset — inert until #907 ships that site kind).
            _ = await AnnouncedPostSync.pullAndCommitIfConfigured(
                siteDirectory: siteDirectory, configDirectory: configDirectory)
            clearDevServerCommandInFlight(token: token)
        }
    }

    func close() {
        let previousSiteID = openSiteID
        openSiteID = nil
        openSiteDirectory = nil
        devServerStoppedByUser = false
        Task {
            if let previousSiteID {
                await EditRouterRegistry.shared.unregister(siteID: previousSiteID)
            }
            await runtime.suspend()
        }
    }

    // MARK: - Dev-server controls (Site menu, #515)

    /// True from dispatching a Start/Stop/Restart command (or `open`'s initial boot) until the
    /// runtime acknowledges it. `canStart…`/`canStop…`/`canRestart…` read `state`, which only
    /// updates asynchronously via the `observe()` stream — without this flag, a rapid
    /// double-click (or a second command fired before the first's transition lands) would pass
    /// the stale-state guard and dispatch two racing runtime calls (PR #542 review).
    ///
    /// Cleared by whichever acknowledgement arrives first:
    /// - any observed state transition (the wedged-boot case: `start` emits `.starting` long
    ///   before it returns, so Restart re-enables while the boot is still in flight), or
    /// - the dispatched runtime call returning (the no-transition case: e.g.
    ///   `UnavailableSiteRuntime` re-settling into an identical `.failed`, which `setState`
    ///   dedups — without this, the flag would stick and permanently disable Start/Retry).
    ///   Token-guarded so a superseded call's late return can't clear a newer command's flag.
    private(set) var devServerCommandInFlight = false

    /// Monotonic token identifying the latest dispatched dev-server command — see
    /// `devServerCommandInFlight`'s completion-clear path.
    @ObservationIgnored private var devServerCommandToken = 0

    private func markDevServerCommandInFlight() -> Int {
        devServerCommandToken += 1
        devServerCommandInFlight = true
        return devServerCommandToken
    }

    private func clearDevServerCommandInFlight(token: Int) {
        if token == devServerCommandToken { devServerCommandInFlight = false }
    }

    /// Whether a site is open enough to (re)start its dev server: both fields are captured by
    /// `open(site:)`, so this is true from first open until `close()`.
    private var siteOpenForDevServer: Bool {
        openSiteID != nil && openSiteDirectory != nil
    }

    /// Enablement mirrors `DevServerControls` (AnglesiteCore) — the CI-tested rules — so the
    /// menu, the stopped pane's Start button, and any future toolbar affordance stay consistent.
    var canStartDevServer: Bool {
        DevServerControls.canStart(state: state, siteOpen: siteOpenForDevServer, commandInFlight: devServerCommandInFlight)
    }
    var canStopDevServer: Bool {
        DevServerControls.canStop(state: state, siteOpen: siteOpenForDevServer, commandInFlight: devServerCommandInFlight)
    }
    var canRestartDevServer: Bool {
        DevServerControls.canRestart(state: state, siteOpen: siteOpenForDevServer, commandInFlight: devServerCommandInFlight)
    }

    /// Site ▸ Start Dev Server: relaunch the runtime for the already-open site (after an explicit
    /// Stop, or as a recovery from `.failed` — same effect as the preview pane's Retry button).
    func startDevServer() {
        guard canStartDevServer else { return }
        relaunchDevServer()
    }

    /// Site ▸ Restart Dev Server: for a wedged Astro process that hasn't died. Same body as
    /// Start — `SiteRuntime.start` tears down any previous run first (protocol contract), so a
    /// restart is a plain re-start on every runtime; only the enablement differs (see
    /// `DevServerControls`). Both funnel into `relaunchDevServer()` so the two can't drift.
    func restartDevServer() {
        guard canRestartDevServer else { return }
        relaunchDevServer()
    }

    /// Shared Start/Restart dispatch. The edit router stays registered across a stop, so no
    /// re-registration is needed here (unlike `open(site:)`).
    private func relaunchDevServer() {
        guard let siteID = openSiteID, let siteDirectory = openSiteDirectory else { return }
        devServerStoppedByUser = false
        let token = markDevServerCommandInFlight()
        Task {
            await runtime.start(siteID: siteID, siteDirectory: siteDirectory)
            clearDevServerCommandInFlight(token: token)
        }
    }

    /// Site ▸ Stop Dev Server: tear down the runtime but keep the site open in the window
    /// (unlike `close()`, which also unregisters the edit router and forgets the site). Frees
    /// the container/dev-server resources for a backgrounded site window; the runtime settles
    /// to `.idle` and the preview pane shows the stopped state with a Start button.
    func stopDevServer() {
        guard canStopDevServer else { return }
        devServerStoppedByUser = true
        // Clear here (not just on `.ready`/`.failed`): stopping mid-boot never reaches either of
        // those, so without this a Stop issued during a dependency-update boot would leave the
        // flag stuck true — the next Start/Restart would then show "Updating dependencies…" for
        // what's actually a plain restart.
        isUpdatingDependencies = false
        let token = markDevServerCommandInFlight()
        Task {
            await runtime.stop()
            clearDevServerCommandInFlight(token: token)
        }
    }

    /// The ready preview URL, if the session is currently `.ready`.
    var readyURL: URL? {
        if case .ready(_, let url, _) = state { return url }
        return nil
    }

    /// The local `wrangler dev --local` endpoint, if the session is `.ready` and the site has an
    /// active worker (#708). `nil` for a static-only site — no debug-panel consumer exists yet
    /// (no Workers tab, #700c), so this is currently unread outside tests, but the accessor
    /// mirrors `readyURL`'s exact pattern so a future consumer needs no runtime changes.
    var workersDevURL: URL? {
        if case .ready(_, _, let workersDevURL) = state { return workersDevURL }
        return nil
    }

    /// Show `route` in the preview. Safe to call before the runtime is `.ready` — `displayURL`
    /// derives the target lazily once a base URL exists (the cold-open Siri case).
    func navigate(toRoute route: String) { activeRoute = route }

    /// Reset the preview to the site root — a plain "preview my site" issued after a prior page
    /// navigation. Without this, `activeRoute` would persist and keep showing the old page.
    func clearRoute() { activeRoute = nil }

    /// The URL the preview WKWebView should load: the active page route against the ready base
    /// URL, or the base URL itself when no route is active. `nil` until the runtime is `.ready`.
    /// Also carries the Debug Pane's global ESI preview mode (spec §4a) as a query parameter, so
    /// `EsiInclude`'s dev shim can read it.
    var displayURL: URL? {
        guard let base = readyURL else { return nil }
        let target = activeRoute.map { PreviewNavigation.targetURL(base: base, route: $0) } ?? base
        return PreviewNavigation.applyingEsiPreviewMode(target, unprocessed: EsiPreviewMode.shared.unprocessed)
    }

    // MARK: Preview navigation (#514)

    /// True once the preview web view exists — the enablement gate for the View-menu preview
    /// navigation commands. The web view is created when the dev server first becomes ready.
    var hasWebView: Bool { webView != nil }

    /// Explicit teardown signal from `PreviewView.dismantleNSView` — the counterpart to the
    /// `onWebView` registration. Required because ARC zeroing the weak `webView` does not fire
    /// its `didSet`, so without this call the `canGoBack`/`canGoForward` mirrors (and the KVO
    /// tokens) would outlive the web view they mirror.
    ///
    /// Identity-checked: SwiftUI may create a replacement view (`makeNSView` → `onWebView`)
    /// before dismantling the old one, in which case `webView` already points at the new
    /// instance and the stale dismantle must not clobber it. The `nil` case is accepted too —
    /// ARC may have zeroed the reference before the dismantle callback runs, leaving stale
    /// mirrors that still need the reset (the `didSet` skips its work when old and new are both
    /// nil, so `observeNavigationState()` is called directly).
    func detachWebView(_ dismantled: WKWebView) {
        guard webView === dismantled || webView == nil else { return }
        webView = nil
        observeNavigationState()
    }

    /// Reload the current preview page (View ▸ Reload Preview, ⌘R). No-ops when the web view
    /// doesn't exist yet, so it's always safe to call.
    func reloadPreview() {
        webView?.reload()
    }

    /// Navigate the preview's history (View ▸ Back ⌘[ / Forward ⌘]). WKWebView no-ops these when
    /// there's nowhere to go, and the menu items are additionally disabled via
    /// `canGoBack`/`canGoForward`.
    func goBack() {
        webView?.goBack()
    }

    func goForward() {
        webView?.goForward()
    }

    /// Zoom commands (View ▸ Zoom In ⌘+ / Zoom Out ⌘− / Actual Size ⌘0). The step policy lives in
    /// `PreviewZoom` (AnglesiteCore, CI-tested); this glue just applies the chosen detent to
    /// `WKWebView.pageZoom`.
    var canZoomIn: Bool { PreviewZoom.canZoomIn(from: zoomLevel) }
    var canZoomOut: Bool { PreviewZoom.canZoomOut(from: zoomLevel) }

    func zoomIn() {
        setZoomLevel(PreviewZoom.zoomIn(from: zoomLevel))
    }

    func zoomOut() {
        setZoomLevel(PreviewZoom.zoomOut(from: zoomLevel))
    }

    func zoomActualSize() {
        setZoomLevel(PreviewZoom.actualSize)
    }

    private func setZoomLevel(_ level: Double) {
        zoomLevel = level
        webView?.pageZoom = CGFloat(level)
    }

    /// (Re)install the KVO mirrors of the web view's history state. `canGoBack`/`canGoForward`
    /// are KVO-compliant on WKWebView and fire on the main thread (`assumeIsolated` asserts that);
    /// mirroring them into observable properties lets the SwiftUI Commands enable/disable without
    /// polling the web view.
    private func observeNavigationState() {
        webViewObservations = []
        canGoBack = false
        canGoForward = false
        guard let webView else { return }
        webViewObservations = [
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, change in
                let value = change.newValue ?? false
                MainActor.assumeIsolated { self?.canGoBack = value }
            },
            webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] _, change in
                let value = change.newValue ?? false
                MainActor.assumeIsolated { self?.canGoForward = value }
            },
        ]
    }

    /// Whether File ▸ Print… has something to print: the preview web view exists and the runtime
    /// is ready with a page to show. The rule itself lives in `PreviewPrinting` (AnglesiteBridge)
    /// so it's covered by `swift test` — this is just the glue reading this model's fields (#525).
    var canPrintPreview: Bool {
        PreviewPrinting.isAvailable(webView: webView, displayURL: displayURL)
    }

    /// Print the previewed page (File ▸ Print ⌘P, #525). Runs the operation as a sheet on the
    /// preview's window when it has one, else app-modal. No-ops when the preview isn't printable
    /// yet (weak `webView` nil or runtime not ready), so this is always safe to call.
    @MainActor
    func printPreview() {
        guard canPrintPreview, let webView else { return }
        let operation = PreviewPrinting.makeOperation(for: webView)
        if let window = webView.window {
            operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            operation.run()
        }
    }

    /// Exposes the runtime's `MCPClient` via the same weak-getter pattern `editRouter` uses,
    /// so other features (annotation feed for chat, etc.) can reuse the per-site client
    /// without spawning a duplicate MCP server.
    func mcpClient() async -> MCPClient? {
        await runtime.mcpClient
    }

    /// Returns the active container control and site ID when the runtime exposes a container
    /// capability (#823) that has successfully started a container.
    ///
    /// Returns `nil` when the capability gate chose a runtime with no container capability (e.g.
    /// `RemoteSandboxSiteRuntime`/`UnavailableSiteRuntime`) or when the container runtime has not
    /// completed `start()` yet.
    ///
    /// Uses only `AnglesiteCore` types (`LocalContainerControl`, `SiteRuntimeContainerCapability`)
    /// — no `AnglesiteContainer` import needed here.
    ///
    /// Reads both fields in a single actor hop via `containerSnapshot()` to avoid a
    /// theoretical TOCTOU window between two separate `await` reads.
    func activeContainerControl() async -> (siteID: String, control: any LocalContainerControl)? {
        guard let capability = runtime.containerCapability else { return nil }
        guard let snapshot = await capability.containerSnapshot() else { return nil }
        return (siteID: snapshot.siteID, control: snapshot.control)
    }

    /// The failure pane's "Restart Networking" action (#812) — unlike `activeContainerControl()`,
    /// works from a `.failed` state (no live container to snapshot) since
    /// `LocalContainerSiteRuntime.resetNetworking()` reaches its `control` unconditionally. No-ops
    /// for runtimes with no container capability; the button that calls this is only shown when
    /// `VmnetFailureRecovery.isRecoverable` recognized the failure, which only the local-container
    /// path can produce.
    func resetNetworking() async {
        guard let capability = runtime.containerCapability else { return }
        await capability.resetNetworking()
    }

    /// Forwards a Workers-tab toggle (#710) to the running runtime so a live local wrangler-dev
    /// session restarts with the new active set. No-op for non-container runtimes — the local
    /// workers dev server is a local-container-only capability (#708).
    func activeWorkersChanged(_ settings: SiteSettings) async {
        await runtime.containerCapability?.updateActiveWorkers(settings)
    }

    /// True when the preview runtime is ready — used to gate the Deploy button so a user
    /// deploying before the container (or dev server) is up sees a coherent error rather than
    /// a silent `ContainerDeployExecutor` "container isn't running" failure.
    ///
    /// On the host path the runtime becomes `.ready` almost immediately (the dev server
    /// starts in the background), so this gate is mostly relevant for the container path.
    var canDeploy: Bool {
        if case .ready = state { return true }
        return false
    }
}
