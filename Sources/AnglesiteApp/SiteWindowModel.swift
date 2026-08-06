import AppKit
import Foundation
import Observation
import OSLog
import AnglesiteCore
import AnglesiteIntents
import AnglesiteSiteModel

/// Which content the main pane shows: the live preview, or the inline text editor
/// for a specific file. Driven by navigator selection (`applyNavigatorSelection`).
enum MainPaneMode: Equatable {
    case preview
    case editor(FileRef)
    case graph
    case cleanup        // Site ▸ Cleanup… (#714 moved it out of the sidebar)
    case reader         // Website ▸ Reader… (V-4.3, #365)
    case followers      // Website ▸ Followers… (V-4.2, #364)
    case communities    // Website ▸ Communities… (V-5.1a, #368)
}

enum ActiveEditor {
    case text(FileEditorModel)
    case plist(PlistEditorModel)

    var file: FileRef {
        switch self {
        case .text(let model): model.file
        case .plist(let model): model.file
        }
    }
}

/// Editor/inspector state that was open on a file when a delete closed it, held so a ⌘Z restore of
/// that file reopens what the delete took away (#675) — "an undo that brings the file back but
/// leaves the user staring at Preview would be only half a restore" (PR #608 review). Keyed by
/// relative path in `SiteWindowModel.closedSurfaces`.
struct ClosedFileSurfaces {
    let mode: MainPaneMode
    let editor: ActiveEditor?
    let inspector: InspectorContext?

    var isEmpty: Bool { editor == nil && inspector == nil }
}

/// Per-site coordinator for `SiteWindow`. Owns runtime startup, child model wiring,
/// selection transitions, editor persistence, and teardown; `SiteWindow` owns only
/// SwiftUI layout and scene storage.
@MainActor
@Observable
final class SiteWindowModel {
    private static let logger = Logger(subsystem: "io.dwk.anglesite", category: "SiteWindowModel")
    private let contentGraph: SiteContentGraph
    private let knowledgeIndex: SiteKnowledgeIndex
    private let semanticRanker: SemanticRanker?
    private let conventionsEngine: ProjectConventionsEngine
    private let contentIndexerStore: ContentIndexerStore
    private let integrationOps = IntegrationOperations.live()
    private let contentCreation: ContentCreationWorkflow
    /// Owns the invisible-publish (#357) queue/watcher/connectivity-monitor lifecycle — see
    /// `InvisiblePublishCoordinator`'s own doc comment (one of #822's four extracted subsystems).
    @ObservationIgnored private let invisiblePublish = InvisiblePublishCoordinator()
    @ObservationIgnored
    private var dismissSiteWindow: (() -> Void)?

    var site: SiteStore.Site?

    #if ANGLESITE_MAS
    /// Owns the security-scoped bookmark grant for this window's lifetime — see
    /// `SecurityScopedGrantController`'s own doc comment (one of #822's four extracted
    /// subsystems). Resolved from the site's persisted bookmark in `loadAndStart()` before any
    /// subprocess spawns; the directly spawned Node/Astro/wrangler children inherit folder
    /// access. Released in `close()`.
    @ObservationIgnored private let grantController = SecurityScopedGrantController()
    #endif

    var preview: PreviewModel
    /// One per site window. Created lazily in `loadAndStart` once `siteID` is known; threaded
    /// into `PreviewView` so the WKWebView's script handler can route `anglesite:visible-elements`
    /// reports into it and AppKit's `appEntityUIElementProvider` can hit-test against its
    /// annotations (Siri AI Phase B / #146 + #148).
    var annotationProvider: PreviewAnnotationProvider?
    var deploy: DeployModel
    private(set) var invisiblePublishState: InvisiblePublishQueue.State = .idle
    var publish = PublishModel()
    var backup = BackupModel()
    var audit = AuditModel()
    /// Drives this site's iCloud git sync (#881): status surface, `NSMetadataQuery` bundle-change
    /// observation, and the conflict banner/resolution sheet. No-ops entirely for a package that
    /// doesn't live in iCloud Drive — see `SyncModel.start(package:)`.
    var sync = SyncModel()
    // Chat is now on both targets and backed by the on-device `FoundationModelAssistant`;
    // the panel UI is target-agnostic.
    var chat: ChatModel?
    var chatPresented = false
    /// Created once the site resolves in `loadAndStart` (needs `siteDirectory`/`configDirectory`),
    /// same lifecycle as `chat`. Its own `sheetPresented` drives the `.sheet(isPresented:)` in
    /// `SiteWindow`, following `AuditModel`'s pattern rather than the item-based sheets.
    var styleGuide: ProjectConventionsModel?
    /// Non-nil ⟺ the Review Copy sheet is presented (`.sheet(item:)`), following the same
    /// coupling-presentation-to-the-model pattern as `siriReadinessModel`/`integrationWizardModel`.
    /// Built fresh each time (`presentCopyEdit`) with a new `ProjectConventionsStore` scoped to
    /// this site's `configDirectory` — the store is a stateless, file-backed actor (Task 10, #465).
    var copyEditModel: CopyEditReportModel?
    /// Non-nil ⟺ the Social Media Plan sheet is presented (`.sheet(item:)`), same coupling and
    /// fresh-`ProjectConventionsStore` pattern as `copyEditModel` (Task 13, #465).
    var socialPlanModel: SocialPlanModel?
    /// Non-nil ⟺ the Repurpose Post sheet is presented (`.sheet(item:)`), same coupling and
    /// fresh-`ProjectConventionsStore` pattern as `copyEditModel`/`socialPlanModel` (Task 16, #465).
    var repurposeModel: RepurposeModel?
    /// Non-nil ⟺ the Design Interview sheet is presented (`.sheet(item:)`), same fresh-
    /// construction-from-`site` pattern as `copyEditModel`/`socialPlanModel`/`repurposeModel` (#631).
    var designInterviewModel: DesignInterviewModel?
    /// The window's `UndoManager`, published down from `SiteWindow`'s
    /// `@Environment(\.undoManager)` so applied edits register for Edit ▸ Undo (#527). Weak +
    /// `@ObservationIgnored`: the window owns it and it isn't render state. Forwarded on set
    /// (environment arrives/changes) and again in `loadAndStart` (chat is created after the
    /// first set on cold open).
    @ObservationIgnored
    weak var windowUndoManager: UndoManager? {
        didSet {
            chat?.editUndoCoordinator.undoManager = windowUndoManager
            contentUndoCoordinator.undoManager = windowUndoManager
        }
    }
    /// Bridges structural content operations — New / Duplicate / Delete / Rename — into the
    /// window's `UndoManager` so ⌘Z and ⇧⌘Z reverse and replay them (#675). Sibling of
    /// `chat.editUndoCoordinator` (#527, assistant edits); both register into the same manager and
    /// interleave LIFO. `lazy` only because the applier captures `self`; unlike the chat
    /// coordinator it has no per-site construction to wait for, so the `didSet` above can attach
    /// the manager to it on a cold open, before `loadAndStart()` has resolved a site.
    @ObservationIgnored
    private(set) lazy var contentUndoCoordinator = ContentUndoCoordinator { [weak self] mutation in
        guard let self else { return .failed }
        return await self.applyContentUndo(mutation)
    }
    var relatedPages: RelatedPagesModel
    var relatedPagesPresented = false
    /// Drives the toolbar search field and its suggestions (#520).
    var search: SiteSearchModel
    /// Drives the main-pane Cleanup view (Site ▸ Cleanup…, #714 moved it out of the sidebar).
    /// `scan()` runs once automatically when `ProjectCleanupView` first appears; the manual
    /// Rescan button re-runs it on demand afterward.
    var cleanup: ProjectCleanupModel
    /// Drives the main-pane Reader view (Website ▸ Reader…, V-4.3 #365): Microsub sign-in, follow,
    /// and timeline.
    var reader = MicrosubReaderModel()
    /// Drives the main-pane Followers view (Website ▸ Followers…, V-4.2 #364): the site's public
    /// ActivityPub followers collection, with lazily-enriched display identities.
    var followers = FollowersModel()
    /// Drives the main-pane Communities view (Website ▸ Communities…, V-5.1a #368): join/leave
    /// fediverse Group actors and read a per-group timeline.
    var communities = CommunitiesModel()
    var harden = HardenModel()
    var domainConfigAudit = DomainConfigAuditModel()
    var onionRouting = OnionRoutingModel()
    var domain = DomainModel()
    var connectDomain = ConnectDomainModel()
    var buyDomain = BuyDomainModel()
    var health = HealthModel(runner: DefaultHealthCheckRunner())
    /// Open GitHub security advisories and Dependabot alerts for this site's repo (#975, the
    /// inbound half of #843). Drives `SecurityReportsBadgeView` in the toolbar and the "Open
    /// reports" section of Website Settings ▸ Security Reports — both read this one instance.
    var securityReports = SecurityReportsModel()
    /// Drives the determinate startup progress bar shown in `mainPane` while the dev server boots.
    var startup = StartupProgressModel()
    /// Observed so an already-open window reacts to a `PreviewSiteIntent` navigation request.
    var router = WindowRouter.shared
    /// Non-nil ⟺ the Siri AI Readiness sheet is presented (`.sheet(item:)`); coupling presentation
    /// to the model rather than a separate Bool makes an empty, undismissable sheet impossible.
    var siriReadinessModel: SiriReadinessModel?
    /// Non-nil ⟺ the Add Integration wizard is presented. Coupling presentation to the model
    /// (`.sheet(item:)`) prevents an empty sheet if construction somehow lags.
    var integrationWizardModel: IntegrationWizardModel?
    /// Non-nil ⟺ the dependency-update-offer sheet is presented (`.sheet(item:)`), set by the
    /// detection hook in `loadAndStart()` when `DependencySyncChecker` finds offers to show.
    var dependencyUpdateModel: DependencyUpdateModel?
    /// The most recent `DependencySyncChecker.check` result from `loadAndStart()`, kept even
    /// when empty so the Security Reports tab's Dependabot-alert rows can offer the same fix
    /// (`DependencySync.fixOffer`, #975) without a second `package.json` read. Set once per site
    /// open; not re-derived reactively.
    private(set) var dependencySyncOffers = DependencySyncOffers()
    /// Non-nil ⟺ the scripts/-divergence sheet is presented (`.sheet(item:)`), set by the
    /// detection hook in `loadAndStart()` when `TemplateScriptsSyncChecker` finds files the owner
    /// customized that the template has also moved on past (#1053).
    var scriptSyncModel: ScriptSyncModel?
    var newPagePresented = false
    var newCollectionPresented = false
    var newPostPresented = false
    var newComponentPresented = false
    /// Website ▸ Animations… (#1007). The gallery is self-contained (owns its own
    /// `AnimationsGalleryModel`, resolves the bundled template itself) so a plain Bool is enough —
    /// no per-site data to carry, unlike the `.sheet(item:)` models above.
    var animationsPresented = false
    /// Non-nil ⟺ the Delete confirmation dialog is showing for this navigator item (#516).
    /// Hosted in `SiteWindow` (mirrors `revertConfirmationPresented`'s alert-hosting pattern) —
    /// set from both the navigator's row context menu and the Edit ▸ Delete menu command.
    var deleteConfirmation: NavigatorItem?
    /// Surfaces a Delete/Duplicate failure — mirrors `cleanup.deleteError`, but for content
    /// (page/post) delete/duplicate rather than Cleanup's dead-asset delete.
    var contentActionError: String?
    /// Non-nil ⟺ the "Add Redirect?" prompt is showing (#530), holding the route that was just
    /// deleted (a page's `route`, or a post's `postRoute(for:)`) — set by `confirmDelete()` only
    /// when the delete actually succeeded. Never break an inbound URL a user didn't choose to
    /// abandon (#584).
    var pendingRedirectOfferRoute: String?
    /// Editor/inspector state closed by a delete, keyed by the deleted file's relative path, so a
    /// ⌘Z restore of that file can put it back (#675). Written by every path that closes surfaces
    /// for a delete (`confirmDelete()` and `applyContentUndo`'s delete branch) and removed the
    /// moment it's consumed — by the restore, by `confirmDelete()`'s own `.failed` rollback, or by
    /// a site change — so it can't grow unbounded or outlive the site it belongs to.
    private var closedSurfaces: [String: ClosedFileSurfaces] = [:]
    /// File ▸ Revert to Saved is destructive, so it routes through a confirmation alert hosted by
    /// `SiteWindow` (#509).
    var revertConfirmationPresented = false
    var navigator: SiteNavigatorModel?
    var graphExplorer: SiteGraphExplorerModel
    var mainPaneMode: MainPaneMode = .preview
    /// The open file's editor state. Owned here (not in `MainPaneEditorView`) so navigating away can
    /// auto-save it and the Preview/Editor toggle keeps the buffer alive. Replaced when a different
    /// file opens; cleared on window close / site replay.
    var activeEditor: ActiveEditor?
    /// The right-hand inspector's current target (typed entry or plain page), or nil when the
    /// selection has no editable metadata. Set by `applyNavigatorSelection`.
    var inspectorContext: InspectorContext?
    /// The inspector's collection context — set by a `.directory` navigator selection, cleared by
    /// every other selection/pane transition. Only surfaces while the main pane shows the preview
    /// (see `inspectorSelection`, added with the component case in this slice).
    var collectionInspection: CollectionInspection?
    /// The hoisted Component Editor model (#714 slice 3) — created/rebuilt by
    /// `ensureComponentEditorLoaded()` when the active editor file is an `.astro` component, so
    /// the window inspector can host its Metadata/Style panes. It does NOT share `activeEditor`'s
    /// lifetime: route/pane transitions `nil` `activeEditor` (e.g. switching to Preview or to a
    /// non-component file) while this is retained, so it survives those round-trips and only
    /// *surfaces* while its file is the open editor pane — see `inspectorSelection`. It's replaced
    /// when a different component opens or the dev-server URL changes, and torn down on site
    /// change, window close, or the open component being deleted out from under it.
    private(set) var componentEditor: ComponentEditorModel?

    /// What the window inspector is inspecting, in precedence order. Component and collection are
    /// gated on the pane mode they belong to, so a stale value from an earlier selection can never
    /// shadow the current one after a pane toggle.
    var inspectorSelection: InspectorSelection? {
        if case .editor(let file) = mainPaneMode, let componentEditor,
           componentEditor.file.id == file.id {
            return .component(componentEditor)
        }
        if case .preview = mainPaneMode, let collectionInspection {
            return .collection(collectionInspection)
        }
        if let inspectorContext { return .page(inspectorContext) }
        return nil
    }

    private let gitRunner: BackupCommand.GitRunner
    private let githubToken: @Sendable () throws -> String?
    private let runningAppVersion: () -> String?

    init(
        contentGraph: SiteContentGraph,
        knowledgeIndex: SiteKnowledgeIndex,
        semanticRanker: SemanticRanker?,
        conventionsEngine: ProjectConventionsEngine,
        runtimeFactory: any SiteRuntimeFactory,
        contentIndexerStore: ContentIndexerStore,
        gitRunner: @escaping BackupCommand.GitRunner = BackupCommand.defaultRunner,
        githubToken: @escaping @Sendable () throws -> String? = { try KeychainStore().readGitHubToken() },
        runningAppVersion: @escaping () -> String? = { AppVersion.current() }
    ) {
        self.gitRunner = gitRunner
        self.githubToken = githubToken
        self.runningAppVersion = runningAppVersion
        self.contentGraph = contentGraph
        self.deploy = DeployModel(
            contentGraph: contentGraph,
            workerCatalog: { await WorkerCatalogFetcher(catalogURL: WorkerCatalogFetcher.productionCatalogURL).catalog() }
        )
        self.knowledgeIndex = knowledgeIndex
        self.semanticRanker = semanticRanker
        self.conventionsEngine = conventionsEngine
        self.contentIndexerStore = contentIndexerStore
        self.preview = PreviewModel(
            contentGraph: contentGraph,
            knowledgeIndex: knowledgeIndex,
            semanticRanker: semanticRanker,
            conventionsEngine: conventionsEngine,
            runtimeFactory: runtimeFactory
        )
        self.contentCreation = ContentCreationWorkflow.native(
            contentGraph: contentGraph,
            knowledgeIndex: knowledgeIndex,
            siteDirectory: { id in await SiteStore.shared.find(id: id)?.sourceDirectory }
        )
        self.graphExplorer = SiteGraphExplorerModel(graph: contentGraph)
        self.relatedPages = RelatedPagesModel(index: knowledgeIndex, ranker: semanticRanker)
        self.search = SiteSearchModel(index: knowledgeIndex)
        self.cleanup = ProjectCleanupModel(knowledgeIndex: knowledgeIndex, contentGraph: contentGraph)
        // Wired once here (not per-site in loadAndStart): the hooks capture nothing from self
        // and receive the run's site id from the model, so there is nothing to rebind on
        // window replay — see CompletionNotificationHub's own doc comment.
        CompletionNotificationHub.wire(deploy: deploy, backup: backup, audit: audit)
        // Layered on top of (not inside) CompletionNotificationHub, which deliberately captures
        // nothing from this model: a successful backup or deploy is one of #881's three debounced
        // push triggers (design doc §2's "App wiring" paragraph). `[weak self]` mirrors the same
        // "an abandoned window doesn't block the operation's own terminal notification" contract —
        // if the window is already gone by the time this fires, there's no sync status surface
        // left to update either, and the site's next open runs `siteOpened()` regardless.
        let backupHook = backup.onPhaseTransition
        backup.onPhaseTransition = { [weak self] siteID, phase in
            backupHook?(siteID, phase)
            if case .succeeded = phase { self?.sync.backupCompleted() }
        }
        let deployHook = deploy.onPhaseTransition
        let deploySound: DialupSoundEffectPlaying = DialupSoundEffectPlayer()
        deploy.onPhaseTransition = { [weak self] siteID, phase in
            deployHook?(siteID, phase)
            if case .succeeded = phase { self?.sync.deployCompleted() }
            if case .running = phase { deploySound.play() } else { deploySound.stop() }
        }
    }

    var activeEditorFile: FileRef? {
        activeEditor?.file
    }

    var paneSelection: Int {
        if case .editor = mainPaneMode { return 1 }
        if case .graph = mainPaneMode { return 2 }
        // Cleanup has no toolbar/View-menu segment of its own (Site ▸ Cleanup… is the only way
        // in) — an out-of-range value so the pane Picker and the Preview/Editor/Graph Toggles
        // all correctly read as unselected instead of Cleanup falsely appearing as Preview (#723
        // review).
        if case .cleanup = mainPaneMode { return 3 }
        // Same reasoning as Cleanup above: Reader has no toolbar/View-menu segment (Website ▸
        // Reader… is the only way in).
        if case .reader = mainPaneMode { return 4 }
        return 0
    }

    func setPaneSelection(_ value: Int) {
        if value == 0 {
            // Switching to Preview auto-saves the open editor (abort on an unresolved conflict).
            // The flush is async (off-main IO), so do it in a Task and only switch on success.
            Task { if await leaveCurrentEditor() { mainPaneMode = .preview } }
        } else if value == 1, let file = activeEditorFile {
            mainPaneMode = .editor(file)
        } else if value == 2 {
            Task { await showGraph() }
        }
    }

    /// Returns whether the pane actually switched to Graph — `false` when `leaveCurrentEditor()`/
    /// `leaveCurrentInspector()` aborted (e.g. an external-change conflict dialog is now showing),
    /// so callers that queue follow-up work (like `revealCitationInGraph`) can skip it rather than
    /// mutating `graphExplorer` state the user never navigated to see.
    @discardableResult
    func showGraph() async -> Bool {
        guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return false }
        await clearInspectorThenSwitchPane(to: .graph)
        return true
    }

    /// Switches the main pane to Cleanup (Site ▸ Cleanup…, #714 moved it out of the sidebar).
    /// Mirrors `showGraph()`'s leave-current-surface-first guard.
    func presentCleanup() {
        Task {
            guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
            activeEditor = nil
            await clearInspectorThenSwitchPane(to: .cleanup)
        }
    }

    /// Switches the main pane to Reader (Website ▸ Reader…, V-4.3 #365). Mirrors
    /// `presentCleanup()`'s leave-current-surface-first guard.
    func presentReader() {
        Task {
            guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
            activeEditor = nil
            await clearInspectorThenSwitchPane(to: .reader)
        }
    }

    /// Switches the main pane to Followers (Website ▸ Followers…, V-4.2 #364). Mirrors
    /// `presentReader()`'s leave-current-surface-first guard.
    func presentFollowers() {
        Task {
            guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
            activeEditor = nil
            await clearInspectorThenSwitchPane(to: .followers)
        }
    }

    /// Switches the main pane to Communities (Website ▸ Communities…, V-5.1a #368). Mirrors
    /// `presentFollowers()`'s leave-current-surface-first guard.
    func presentCommunities() {
        Task {
            guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
            activeEditor = nil
            await clearInspectorThenSwitchPane(to: .communities)
        }
    }

    /// Clears the inspector and swaps the main pane, giving the inspector's own
    /// `.inspector(isPresented:)` dismissal a moment to settle in its own SwiftUI transaction
    /// before `mainPaneMode` tears down and rebuilds the entire detail view. Doing both in the
    /// same synchronous step — clearing the inspector state (which flips the inspector's binding
    /// to false) and swapping `mainPaneMode` right after — sent macOS 27 beta's AppKit layout
    /// engine into an unrecoverable constraint-update storm that hung the window and then
    /// crashed the app (#1126), most reliably via Graph but not exclusive to it. Same class of
    /// problem, same mitigation (`AppKitConstraintStormMitigation`), as the sheet-dismissal delay
    /// in `loadAndStart()` below — skipped entirely when there was no inspector to dismiss.
    ///
    /// For Graph/Cleanup/Reader/Followers/Communities the inspector has no companion to reopen,
    /// so clearing it here is the whole story. `openFile` also routes through here — a component
    /// file's `ComponentEditorModel` inspector companion is presented separately afterward by
    /// `ensureComponentEditorLoaded()`, with its own settle delay (#1139); see that call site.
    /// The `.directory` navigator-selection case deliberately does NOT go through here: it swaps
    /// `inspectorContext`'s page context for a new `collectionInspection` while staying presented,
    /// and `inspectorSelection` must never observe a transient nil in between (#968/#969's
    /// presentation-binding setter race) — adding this method's delay there would reopen exactly
    /// that gap.
    @MainActor
    private func clearInspectorThenSwitchPane(to mode: MainPaneMode) async {
        let wasInspecting = inspectorSelection != nil
        inspectorContext = nil
        collectionInspection = nil
        if wasInspecting {
            await AppKitConstraintStormMitigation.settle()
        }
        mainPaneMode = mode
    }

    /// Resolves a chat citation's file path to a Site Graph Explorer node and reveals it there
    /// (#314): switches the main pane to Graph and selects the node. Returns `false` — and does
    /// nothing — when the path doesn't match any node in the current snapshot, so the caller
    /// (`ChatView`'s citation click handler) can fall back to opening the file directly.
    ///
    /// The pane switch and selection happen asynchronously (matching `setPaneSelection`'s
    /// existing fire-and-forget `Task { await showGraph() }` pattern) — the `Bool` this returns
    /// reflects only whether a matching node was found, not whether the navigation has finished.
    @discardableResult
    func revealCitationInGraph(_ path: String) -> Bool {
        guard let node = graphExplorer.snapshot.nodes.first(where: { $0.filePath == path }) else {
            return false
        }
        Task { [weak self] in
            guard let self, await self.showGraph() else { return }
            self.graphExplorer.revealNode(node)
        }
        return true
    }

    func openSiriReadiness() {
        guard siriReadinessModel == nil, let indexer = contentIndexerStore.indexer, let site else { return }
        siriReadinessModel = SiriReadinessModel(
            probes: SiriReadinessProbes.site(siteID: site.id, graph: contentGraph, indexer: indexer)
        )
    }

    var canOpenSiriReadiness: Bool {
        contentIndexerStore.indexer != nil && site != nil
    }

    func openIntegrationWizard() {
        guard integrationWizardModel == nil, let site else { return }
        integrationWizardModel = IntegrationWizardModel(service: integrationOps, siteID: site.id)
    }

    func openStyleGuide() {
        guard let styleGuide else { return }
        Task { await styleGuide.presentSheet() }
    }

    var canOpenCopyEdit: Bool { site != nil }

    /// Presents the Review Copy sheet (#465). Reconstructs a `ProjectConventionsStore` from the
    /// site's `configDirectory` — the same expression `ProjectConventionsModel.init` uses for
    /// `styleGuide` at `loadAndStart` (~line 1068) — rather than reaching into that model's
    /// private store, since the store is a stateless file-backed actor keyed off the directory.
    func presentCopyEdit() {
        guard copyEditModel == nil, let site else { return }
        copyEditModel = CopyEditReportModel(
            siteID: site.id,
            sourceDirectory: site.sourceDirectory,
            conventionsStore: ProjectConventionsStore(configDirectory: site.configDirectory)
        )
    }

    var canOpenSocialPlan: Bool { site != nil }

    var canOpenDesignInterview: Bool { site != nil }

    /// Website ▸ Animations… (#1007), same shape as `canOpenSocialPlan` — gated on a site window
    /// being focused, even though the gallery itself only reads the bundled template.
    var canOpenAnimations: Bool { site != nil }

    /// Presents the Animations gallery sheet (Website ▸ Animations…, #1007). Mirrors
    /// `presentReader()`'s naming (`present…`), but toggles a plain Bool rather than switching
    /// `mainPaneMode` — the gallery is a modal browse surface, not a main-pane mode.
    func presentAnimations() {
        animationsPresented = true
    }

    /// Presents the Social Media Plan sheet (#465), same pattern as `presentCopyEdit`.
    func presentSocialPlan() {
        guard socialPlanModel == nil, let site else { return }
        socialPlanModel = SocialPlanModel(
            siteID: site.id,
            sourceDirectory: site.sourceDirectory,
            conventionsStore: ProjectConventionsStore(configDirectory: site.configDirectory)
        )
    }

    /// Presents the Design Interview sheet (#631), same fresh-construction-from-`site` pattern as
    /// `presentCopyEdit`/`presentSocialPlan`. Builds a standalone `FoundationModelAssistant`
    /// rather than reusing the site's shared `chat` assistant — the interview is its own
    /// independent conversation, not a turn appended to the main chat's session/transcript.
    func presentDesignInterview() {
        guard designInterviewModel == nil, let site else { return }
        designInterviewModel = DesignInterviewModel(
            businessType: SiteBusinessType.read(sourceDirectory: site.sourceDirectory) ?? "",
            assistant: FoundationModelAssistant(tier: .onDevice),
            package: AnglesitePackage(url: site.packageURL),
            siteID: site.id
        )
    }

    /// Presents the Repurpose Post sheet (#465), same pattern as `presentCopyEdit`/`presentSocialPlan`.
    func presentRepurpose(slug: String) {
        guard repurposeModel == nil, let site else { return }
        repurposeModel = RepurposeModel(
            siteID: site.id, sourceDirectory: site.sourceDirectory, slug: slug,
            conventionsStore: ProjectConventionsStore(configDirectory: site.configDirectory)
        )
    }

    /// Resolves a Navigator row id to its post's slug, then presents — mirrors `duplicate(id:)`'s
    /// id→Post resolution pattern for reaching the actor-isolated `SiteContentGraph` from the
    /// Navigator's context menu, which only carries a `NavigatorItem.id` (Task 16, #465).
    func presentRepurpose(postRowID id: String) async {
        guard let post = await contentGraph.post(id: id) else { return }
        presentRepurpose(slug: post.slug)
    }

    /// The `.failed`-state pane's Retry button — same recovery as Site ▸ Start Dev Server (#515),
    /// kept as one code path rather than two that could drift.
    func retryPreview() {
        preview.startDevServer()
    }

    /// The `.failed`-state pane's "Restart Networking" button (#812), shown only when
    /// `VmnetFailureRecovery.isRecoverable` recognizes the failure. Drops this process's cached
    /// vmnet network (`PreviewModel.resetNetworking()`) before retrying, so the retry that follows
    /// doesn't just fail against the same wedged network object.
    func restartNetworkingAndRetry() {
        Task {
            await preview.resetNetworking()
            retryPreview()
        }
    }

    func previewStateChanged(_ state: SiteRuntimeState) {
        startup.ingest(state: state)
        guard preview.canDeploy else { return }
        invisiblePublish.retryPendingIfDeployable()
    }

    func handleSiteChanged() {
        stopInvisiblePublishing()
        siriReadinessModel = nil
        // Undo records are site-relative paths plus captured contents — replaying a different
        // site into this window makes every pending one meaningless, and applying one would write
        // into the new site (#675).
        contentUndoCoordinator.invalidateAll()
        closedSurfaces.removeAll()
        // Persist any unsaved edits before dropping the old site's editor on replay (#188 reuse).
        persistEditorBufferBestEffort()
        activeEditor = nil
        // Overwrite unconditionally on teardown (save(), not flushBeforeLeaving): no conflict
        // alert can be shown on a closing window, so a conflict-gated flush would silently drop
        // the edits. Last-writer-wins, matching the .text/.plist teardown above.
        if let model = inspectorContext?.model { Task { await model.save() } }
        inspectorContext = nil
        collectionInspection = nil
        componentEditor = nil
        mainPaneMode = .preview
    }

    func close(suddenTerminationLease: SuddenTerminationController.Lease? = nil) {
        stopInvisiblePublishing()
        sync.stop()
        preview.close()
        startup.stop()
        // Note: an in-flight Deploy/Backup/Audit is intentionally NOT cancelled or cleaned up
        // here. The operation's Task retains its model through the async call, so it runs to a
        // real terminal phase after the window closes — and its completion hooks (wired in init,
        // capturing nothing from self) still post the notification and clear the Dock token then
        // (#526). An eager Dock clear here would be wrong: the still-running deploy's next
        // milestone would simply re-add it.
        // Unregister the annotation provider from the shared registry so
        // `ElementEntityQuery` stops resolving stale entity ids for a window that's no
        // longer on screen.
        if let provider = annotationProvider {
            PreviewAnnotationProviderRegistry.shared.unregister(siteID: provider.siteID)
            annotationProvider = nil
        }
        chat = nil
        styleGuide = nil
        copyEditModel = nil
        socialPlanModel = nil
        repurposeModel = nil
        navigator?.stop()
        navigator = nil
        graphExplorer.stop()
        // Window closing: persist unsaved edits unconditionally (consistent with
        // auto-save-on-leave). No conflict dialog is possible during teardown, so we don't gate
        // on a flush return value — just write the buffer best-effort, off the main actor.
        let editorSaveTask = persistEditorBufferBestEffort()
        activeEditor = nil
        // Overwrite unconditionally on teardown (save(), not flushBeforeLeaving): no conflict
        // alert can be shown on a closing window, so a conflict-gated flush would silently drop
        // the edits. Last-writer-wins, matching the .text/.plist teardown above.
        let inspectorWasDirty = inspectorContext?.model.isDirty == true
        let inspectorSaveTask = (inspectorContext?.model).map { model in
            Task { await model.save() }
        }
        inspectorContext = nil
        collectionInspection = nil
        componentEditor = nil
        let closeTerminationLease = suddenTerminationLease
            ?? ((editorSaveTask != nil || inspectorWasDirty) ? SuddenTerminationController.shared.acquire() : nil)
        #if ANGLESITE_MAS
        let closingScopedURL = grantController.release()
        #endif
        Task { @MainActor in
            await editorSaveTask?.value
            _ = await inspectorSaveTask?.value
            #if ANGLESITE_MAS
            closingScopedURL?.stopAccessingSecurityScopedResource()
            #endif
            closeTerminationLease?.release()
        }
    }

    /// Flush the open editor before leaving it: auto-saves a dirty buffer, but returns false (and the
    /// model raises its conflict alert) when the file changed externally — so the caller aborts the
    /// switch instead of clobbering the other tool's edit. Safe to call when not editing. Async
    /// because the save/check IO runs off the main actor.
    // MARK: - Site operations (shared by the toolbar and the Site menu, #511)

    /// Deploy, Backup, and Audit are mutually exclusive: each is unavailable while any of the
    /// three runs (matches the long-standing toolbar behavior).
    private var siteOperationRunning: Bool {
        deploy.isRunning || backup.isRunning || audit.isRunning
    }

    var canRunDeploy: Bool { site?.isValid == true && !siteOperationRunning && preview.canDeploy }
    var canRunBackup: Bool { site?.isValid == true && !siteOperationRunning }
    var canRunAudit: Bool { site?.isValid == true && !siteOperationRunning && preview.canDeploy }
    var canRunHarden: Bool { site?.isValid == true && !harden.isRunning }
    var canRunDomainConfigAudit: Bool { site?.isValid == true && !domainConfigAudit.isRunning }
    var canRunOnionRouting: Bool { site?.isValid == true && !onionRouting.isRunning }
    var canRecheckHealth: Bool { site != nil }
    var canOpenDomain: Bool { site != nil && !domain.isRunning }
    var canOpenIntegrationWizard: Bool { site != nil }
    var canOpenPreviewInBrowser: Bool { preview.readyURL != nil }
    var canShowGraph: Bool { site != nil }
    var canPublishToGitHub: Bool { site?.isValid == true && !publish.isRunning }

    /// Build, scan, and `wrangler deploy` — the container control is resolved by `DeployModel`
    /// itself, via the provider below, at the moment the deploy actually runs (#823).
    func deploySite() {
        guard let site, canRunDeploy else { return }
        Task { @MainActor in
            // Posts are routed too (#584) — a vanished post's URL must trip the same
            // orphaned-route scan as a vanished page's, not vanish silently from the snapshot.
            let pageRoutes = await contentGraph.pages(for: site.id).map(\.route)
            let postRoutes = await contentGraph.posts(for: site.id).map(postRoute(for:))
            let currentRoutes = pageRoutes + postRoutes
            deploy.deploy(
                siteID: site.id, siteDirectory: site.sourceDirectory,
                configDirectory: site.configDirectory, currentRoutes: currentRoutes,
                containerControlProvider: { [preview] in await preview.activeContainerControl() },
                siteName: site.name)
        }
    }

    func backupSite() {
        guard let site, canRunBackup else { return }
        backup.backup(siteID: site.id, siteDirectory: site.sourceDirectory)
    }

    func auditSite() {
        guard let site, canRunAudit else { return }
        audit.audit(
            siteID: site.id, siteDirectory: site.sourceDirectory,
            containerControlProvider: { [preview] in await preview.activeContainerControl() })
    }

    func recheckHealth() {
        guard let site else { return }
        health.recheck(siteID: site.id, siteDirectory: site.sourceDirectory)
    }

    /// Resolves this site's GitHub origin via the injected `gitRunner`, sharing
    /// `GitRemoteResolver.origin(in:runner:)` with `PlistEditorModel.currentRemoteRepo()` — see
    /// that type's doc comment for why `PublishModel`'s `RepoBootstrap`-based resolution stays
    /// separate. `nil` for no remote, a non-GitHub remote, or a failed git call.
    private func currentGitHubRemote() async -> RemoteRepo? {
        guard let site else { return nil }
        return await GitRemoteResolver.origin(in: site.sourceDirectory, runner: gitRunner)
    }

    /// Kicks off a `securityReports` check and returns the settling `Task` so callers (and
    /// tests) can await completion; production callers other than tests discard it. Called from
    /// `loadAndStart()` on every site open (not awaited there, so it never delays open) and from
    /// the badge popover / Settings-tab "Check for reports" action — one code path, many triggers.
    @discardableResult
    func recheckSecurityReports() -> Task<Void, Never> {
        Task { [weak self] in
            guard let self else { return }
            let repo = await self.currentGitHubRemote()
            let token = (try? self.githubToken()) ?? nil
            await self.securityReports.recheck(repo: repo, token: token).value
        }
    }

    /// Writes `offers` (bumps + additions) into the site's `package.json`. Shared by
    /// `loadAndStart()`'s automatic offer sheet and `presentDependencyFixSheet(_:)`'s
    /// single-offer sheet (#975), so both apply through the identical path. Uses the injected
    /// `runningAppVersion` (not a direct `AppVersion.current()` call) so tests can supply a
    /// non-nil version — a plain SwiftPM test host has no `CFBundleShortVersionString`.
    private func applyDependencySyncOffers(_ offers: DependencySyncOffers, sourceDirectory: URL, configDirectory: URL) {
        guard let runningVersion = runningAppVersion() else { return }
        do {
            try DependencySyncApplier.apply(
                offers, sourceDirectory: sourceDirectory, configDirectory: configDirectory,
                runningAppVersion: runningVersion)
            preview.isUpdatingDependencies = true
        } catch {
            // package.json rewrite failed — nothing was written, so the site keeps its
            // unchanged files; this boot/action is not treated as a post-update one.
        }
    }

    /// Opens the dependency-update sheet pre-scoped to a single package bump — the Security
    /// Reports tab's "Update available" action (#975) for a Dependabot alert
    /// `DependencySync.fixOffer` already matched against the bundled template. Reuses the same
    /// apply path as the automatic offer sheet, just for one offer instead of the full set.
    func presentDependencyFixSheet(_ offer: DependencyUpdateOffer) {
        guard let site else { return }
        let offers = DependencySyncOffers(updates: [offer])
        dependencyUpdateModel = DependencyUpdateModel(offers: offers) { [weak self] accepted in
            guard let self else { return }
            if accepted {
                self.applyDependencySyncOffers(offers, sourceDirectory: site.sourceDirectory, configDirectory: site.configDirectory)
            }
            self.dependencyUpdateModel = nil
        }
    }

    func openPreviewInBrowser() {
        guard let url = preview.readyURL else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: - Dev-server commands (Site menu, #515)

    /// Thin pass-throughs so `WebsiteCommands` reads one focused model, like every other Site
    /// item. Enablement rules live in `DevServerControls` (AnglesiteCore, CI-tested); the state
    /// plumbing lives in `PreviewModel`.
    var canStartDevServer: Bool { preview.canStartDevServer }
    var canStopDevServer: Bool { preview.canStopDevServer }
    var canRestartDevServer: Bool { preview.canRestartDevServer }

    func startDevServer() { preview.startDevServer() }
    func stopDevServer() { preview.stopDevServer() }
    func restartDevServer() { preview.restartDevServer() }

    // MARK: - File-menu targets (#513)

    var canRevealInFinder: Bool {
        activeEditorFile != nil || inspectorContext != nil || site != nil
    }

    /// File ▸ Reveal in Finder: the most specific focused surface wins — the open editor's file,
    /// else the inspected page's source file, else the site's `Source/` directory (the package
    /// itself is opaque in Finder, so revealing its contents is the useful target).
    func revealInFinder() {
        if let file = activeEditorFile {
            NSWorkspace.shared.activateFileViewerSelecting([file.url])
        } else if let model = inspectorContext?.model {
            NSWorkspace.shared.activateFileViewerSelecting([model.file.url])
        } else if let site {
            NSWorkspace.shared.activateFileViewerSelecting([site.sourceDirectory])
        }
    }

    var canRenameNavigatorItem: Bool {
        guard let navigator, let selection = navigator.selection else { return false }
        return navigator.canRename(selection)
    }

    /// File ▸ Rename…: begins the navigator's inline-edit flow for the selected item (same path as
    /// its context menu). Site display-name rename stays in the launcher's context menu.
    func renameNavigatorItem() {
        guard let navigator, let selection = navigator.selection, navigator.canRename(selection) else { return }
        navigator.beginEditing(selection)
    }

    /// True when the main-pane editor or the inspector holds unsaved edits — drives File ▸ Save /
    /// Revert to Saved enablement (#509). The `.plist` editor hosts several independent settings-pane
    /// dirty flags (Website, Analytics, Redirects, …); `PlistEditorModel.hasAnyUnsavedEdits` (#741)
    /// aggregates all of them, matching `PlistEditorModel.flushBeforeLeaving()` (PR #532 review).
    var hasUnsavedEdits: Bool {
        let editorDirty = switch activeEditor {
        case .text(let model): model.isDirty
        case .plist(let model): model.hasAnyUnsavedEdits
        case nil: false
        }
        return editorDirty || (inspectorContext?.model.isDirty ?? false)
    }

    /// True while any save/revert IO is in flight on either editing surface. File ▸ Save / Revert
    /// disable during it: none of the editor models guard `load()` against a concurrent in-flight
    /// `save()`, so a revert racing a slow save could desync the buffer from disk (PR #532 review).
    var editCommandInFlight: Bool {
        if menuEditCommandRunning { return true }
        switch activeEditor {
        case .text(let model): if model.isSaving { return true }
        case .plist(let model): if model.isAnySaving { return true }
        case nil: break
        }
        return inspectorContext?.model.isSaving ?? false
    }

    /// Serializes File ▸ Save / Revert themselves (the per-model `isSaving` flags only cover each
    /// model's own write).
    private var menuEditCommandRunning = false

    /// File ▸ Save. Writes every dirty editing surface: a page's content (main-pane editor) and its
    /// metadata (inspector) are one document to the user, so Save covers both. Each model's `save()`
    /// no-ops when clean; the plist editor's settings-pane facets save via `saveAllDirty()` (#741).
    func saveAllEdits() async {
        guard !menuEditCommandRunning else { return }
        menuEditCommandRunning = true
        defer { menuEditCommandRunning = false }
        switch activeEditor {
        case .text(let model):
            await model.save()
        case .plist(let model):
            await model.saveAllDirty()
        case nil: break
        }
        if let model = inspectorContext?.model { await model.save() }
    }

    /// File ▸ Revert to Saved: present the confirmation alert (no-op when nothing is dirty, so a
    /// stale-enabled menu item can't surface a pointless prompt).
    func requestRevertToSaved() {
        guard hasUnsavedEdits, !editCommandInFlight else { return }
        revertConfirmationPresented = true
    }

    /// Discard unsaved edits by re-reading each dirty surface from disk. Uses `load()` — not
    /// `reloadFromDisk()`, which is conflict-flow-specific and no-ops without a pending conflict.
    /// `load()` re-reads every settings-pane facet, so `hasAnyUnsavedEdits` (#741) fully reverts.
    func confirmRevertToSaved() async {
        guard !menuEditCommandRunning else { return }
        menuEditCommandRunning = true
        defer { menuEditCommandRunning = false }
        switch activeEditor {
        case .text(let model) where model.isDirty: await model.load()
        case .plist(let model) where model.hasAnyUnsavedEdits: await model.load()
        default: break
        }
        if let model = inspectorContext?.model, model.isDirty { await model.load() }
    }

    func leaveCurrentEditor() async -> Bool {
        guard case .editor = mainPaneMode else { return true }
        switch activeEditor {
        case .text(let model):
            return await model.flushBeforeLeaving()
        case .plist(let model):
            return await model.flushBeforeLeaving()
        case nil:
            return true
        }
    }

    /// Flush the inspector's editor before changing selection or tearing down — autosaves a dirty
    /// buffer, returns false (and the model raises its conflict alert) on an external conflict so the
    /// caller aborts the switch. Safe when no inspector is active.
    func leaveCurrentInspector() async -> Bool {
        guard let model = inspectorContext?.model else { return true }
        return await model.flushBeforeLeaving()
    }

    /// Best-effort off-main save of the open editor's buffer when the editor is torn down (window
    /// close or site replay), where no conflict dialog can be shown. Consistent with the
    /// auto-save-on-leave model; last-writer-wins on the rare teardown-time external conflict.
    /// The `.plist` editor flushes every dirty settings-pane facet via `saveAllDirty()` (#741) — a
    /// prior version only ever persisted the Website entries here, silently dropping unsaved
    /// Analytics/Redirects edits on window close.
    @discardableResult
    private func persistEditorBufferBestEffort() -> Task<Void, Never>? {
        switch activeEditor {
        case .text(let model) where model.isDirty:
            let url = model.file.url
            let contents = model.text
            return Task.detached(priority: .userInitiated) { _ = try? FileDocumentIO.save(contents, to: url) }
        case .plist(let model):
            guard model.hasAnyUnsavedEdits else { return nil }
            return Task { await model.saveAllDirty() }
        case .text, nil:
            return nil
        }
    }

    // MARK: - Lifecycle

    /// React to registry changes for this window's site (#188, #266). Subscribes to the store's
    /// broadcast only after `site` is resolved. On the first snapshot that no longer contains this
    /// site's id — an explicit `remove(id:)` from the launcher, or a `refresh()` that prunes a stale
    /// entry — dismisses the window: `dismissWindow()` triggers `onDisappear`, which stops the
    /// dev-server/MCP subprocess and releases the MAS security-scoped grant, so no teardown is
    /// duplicated here. Otherwise, if the entry's `name` changed (a rename via `setDisplayName`),
    /// refresh the local `@State site` so `.navigationTitle` and the drawer headings update live.
    /// The `for await` loop is cancelled when the window tears down or `site` changes, which
    /// terminates the stream and prunes the store-side continuation.
    func observeStoreChanges() async {
        guard let resolvedID = site?.id else { return }
        for await snapshot in SiteStore.shared.changeStream() {
            guard let entry = snapshot.first(where: { $0.id == resolvedID }) else {
                dismissSiteWindow?()
                return
            }
            if entry.name != site?.name {
                site?.name = entry.name
                navigator?.updateWebsiteTitle(entry.name)
            }
        }
    }

    /// Apply (and clear) any pending `PreviewSiteIntent` navigation for `siteID`: navigate to a
    /// page route, or reset the preview to the site root. Called from `loadAndStart` (cold-open,
    /// where `.onChange` won't fire for the value set before the window observed it) and from
    /// `.onChange(of: router.pendingNavigation)` (an already-open window) — the dual cold/warm
    /// handling `SitesLauncherView` uses for `newSiteRequested`. `consumeNavigation` is keyed by
    /// siteID, so other sites' windows observing the same dict no-op here.
    @MainActor
    func applyPendingNavigation(for siteID: String) {
        switch router.consumeNavigation(for: siteID) {
        case .some(.some(let route)): preview.navigate(toRoute: route)
        case .some(.none): preview.clearRoute()
        case .none: break
        }
    }

    /// Apply (and clear) any pending `StartDesignInterviewIntent` request for `siteID`: presents
    /// the design-interview sheet if it isn't already up. Same dual cold/warm calling convention
    /// as `applyPendingNavigation` — called from `loadAndStart` (cold-open) and from
    /// `.onChange(of: router.pendingDesignInterview)` (an already-open window).
    @MainActor
    func applyPendingDesignInterviewRequest(for siteID: String) {
        guard router.consumeDesignInterviewRequest(for: siteID) else { return }
        presentDesignInterview()
    }

    /// Route a navigator selection: pages/posts switch to preview and navigate; files open the editor.
    /// Async — leaving the current editor flushes it to disk off the main actor first, and aborts the
    /// switch if an external conflict needs resolving.
    @MainActor
    func applyNavigatorSelection(_ id: String?) {
        guard let id, let target = navigator?.target(for: id) else { return }
        switch target {
        case .route(let route):
            Task {
                // Captured before any `await` below, so a faster subsequent selection changing
                // `navigator.selection` in the meantime can't be mistaken for this task's own
                // request — same reasoning as the `.directory` branch below (#714 final review,
                // Important 3 follow-up).
                let requestedID = id
                guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
                let context = await makeInspectorContext(forNavigatorID: id)
                // `makeInspectorContext` awaits real work, a suspension point a faster subsequent
                // selection (e.g. a `.directory` pick) can land in during. That branch's own guard
                // stops IT from clobbering a newer selection, but this branch's unconditional
                // `collectionInspection = nil` was the unguarded mirror image: `.route` outranks
                // nothing, but its stale `nil` would still wipe out a newer `.directory`
                // selection's just-assigned `collectionInspection` once this task resumed. Bail
                // unless this is still the live selection (same `navigator?.selection` liveness
                // check as `.directory`), and skip the related-pages load below too — a stale
                // selection shouldn't populate that either.
                guard navigator?.selection == requestedID else { return }
                // One synchronous transaction — every flip below lands together, AFTER the awaits
                // above, so `inspectorSelection` never passes through a transient nil between the
                // old context and this one. `activeEditor`/`mainPaneMode` used to flip to Preview
                // *before* awaiting `makeInspectorContext`, which (with a component inspector
                // showing in editor mode) opened exactly that nil window: `inspectorSelection`
                // reads nil while the old `.component` context is gone and the new page context
                // hasn't landed yet, the live `.inspector` panel's presentation gate reads that as
                // "nothing to show" and auto-dismisses, and SwiftUI's asynchronous write-back of
                // `isPresented = false` can land AFTER this task resumes — permanently persisting
                // `inspectorShown = false` even though the page context ends up correct (the
                // presentation-binding setter race, #968/#969; found here in #714 slice-3 GUI
                // smoke). See the `.directory` branch below for the mirror case.
                activeEditor = nil
                mainPaneMode = .preview
                if route.isEmpty || route == "/" { preview.clearRoute() } else { preview.navigate(toRoute: route) }
                inspectorContext = context
                collectionInspection = nil
                // Load related-page suggestions for the newly selected page.
                if let siteID = site?.id {
                    let filePath: String?
                    if let page = await contentGraph.page(id: id) {
                        filePath = page.filePath
                    } else if let post = await contentGraph.post(id: id) {
                        filePath = post.filePath
                    } else {
                        filePath = nil
                    }
                    if let path = filePath {
                        await relatedPages.load(siteID: siteID, path: path)
                    }
                }
            }
        case .file(let file):
            openFile(file)
        case .websiteSettings:
            // Slice-1 interim: the website row opens the package Info.plist — exactly what the
            // old sidebar Metadata row opened. The full Website Settings surface is slice 2
            // (spec §7, docs/superpowers/specs/2026-07-13-website-design-window-cleanup-design.md).
            guard let site else { return }
            let layout = SiteFileTree.layout(for: site.packageURL)
            guard let infoPlist = layout.infoPlist else { return }
            openFile(FileRef(url: infoPlist, group: .metadata, name: "Info.plist"))
        case .directory(let collection, let route):
            // #714 slice 3 (§6): a directory shows its route in the preview and its properties
            // (type, entries, feeds, template) in the inspector's collection context.
            Task {
                // Captured before any `await` below, so a faster subsequent selection changing
                // `navigator.selection` in the meantime can't be mistaken for this task's own
                // request (#714 final review, Important 3).
                let requestedID = id
                guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
                let inspection = await makeCollectionInspection(
                    collection: collection, route: route, navigatorID: id)
                // `makeCollectionInspection` awaits the content-graph actor and, for a real
                // collection, a detached feed probe — real suspension points a faster subsequent
                // selection (e.g. a `.route` pick) can land in between. `.collection` outranks
                // `.page` in `inspectorSelection`, so an unguarded assignment here would silently
                // shadow that newer selection's page context once this stale task resumes. Bail
                // unless this is still the live selection — `navigator?.selection` is the same
                // signal `SiteNavigatorView`'s List binding drives and `SiteWindow`'s
                // `.onChange(of: navigator.selection)` reacts to, so it always reflects the
                // current selection by the time we get here.
                guard navigator?.selection == requestedID else { return }
                // One synchronous transaction — every flip below lands together, AFTER the awaits
                // above, so `inspectorSelection` never passes through a transient nil between the
                // old context and `.collection`. These used to flip to Preview (nil-ing
                // `inspectorContext`) *before* awaiting `makeCollectionInspection`, which opened
                // exactly that nil window: `inspectorSelection` reads nil while the old context is
                // gone and `collectionInspection` hasn't landed yet, the live `.inspector` panel's
                // presentation gate reads that as "nothing to show" and auto-dismisses, and
                // SwiftUI's asynchronous write-back of `isPresented = false` can land AFTER this
                // task resumes — permanently persisting `inspectorShown = false` even though the
                // collection context ends up correct (the presentation-binding setter race,
                // #968/#969; found here in #714 slice-3 GUI smoke). See the `.route` branch above
                // for the mirror case. Accepted tradeoff: preview navigation now happens a
                // probe-latency later than before (imperceptible in practice).
                activeEditor = nil
                inspectorContext = nil
                mainPaneMode = .preview
                preview.navigate(toRoute: route)
                collectionInspection = inspection
            }
        }
    }

    /// Routes an activated toolbar-search hit (#520). A hit whose route matches a live navigator
    /// row goes through `applyNavigatorSelection` so the sidebar selection, preview, inspector,
    /// and Related Pages panel all land where a sidebar click would have put them; everything
    /// else opens its file. `SiteSearchDestination` owns that decision (and is tested in
    /// AnglesiteCore) — this method only executes it.
    @MainActor
    func openSearchHit(_ hit: SiteSearchIndex.Hit) {
        guard let site else { return }
        let destination = SiteSearchDestination.resolve(
            hit: hit, navigatorRouteIDs: navigator?.routeIDs ?? [:])
        // Dismiss the suggestions list first: both branches below can suspend, and leaving the
        // dropdown up over the destination reads as the navigation not having happened.
        search.clear()

        switch destination {
        case .navigator(let id):
            navigator?.selection = id
            applyNavigatorSelection(id)
        case .file(let path, let group):
            let url = site.sourceDirectory.appendingPathComponent(path)
            openFile(FileRef(
                url: url, group: group,
                name: hit.title ?? url.lastPathComponent))
        }
    }

    @MainActor
    func openGraphNode(_ node: SiteGraphNode, site: SiteStore.Site) {
        guard let filePath = node.filePath else { return }
        let group: FileGroup
        switch node.kind {
        case .page:
            group = .pages
        case .collection, .contentEntry:
            group = .posts
        case .layout, .component:
            group = .components
        case .style:
            group = .styles
        case .asset:
            NSWorkspace.shared.activateFileViewerSelecting([site.sourceDirectory.appendingPathComponent(filePath)])
            return
        }
        let url = site.sourceDirectory.appendingPathComponent(filePath)
        openFile(FileRef(url: url, group: group, name: node.title))
    }

    @MainActor
    func openFile(_ file: FileRef) {
        if activeEditorFile?.id == file.id {
            mainPaneMode = .editor(file)
            return
        }
        // `[self]` is explicit rather than implicit so the `onOpenDependencyFix` closure below can
        // spell its own `[weak self]` capture without the compiler flagging the mismatch against an
        // implicitly-captured strong `self` in this outer scope.
        Task { [self] in
            guard await leaveCurrentEditor(), await leaveCurrentInspector() else { return }
            let kind = EditorKind.resolve(for: file)
            switch kind {
            case .text, .component, .markdown:
                // `.component` also builds a plain `FileEditorModel`: `MainPaneEditorView` re-resolves
                // `EditorKind` itself and renders `ComponentEditorView` (backed by the same
                // `FileEditorModel` for its Source-mode escape hatch) when a `componentContext` is
                // wired in at the call site — see `SiteWindow.mainPaneContent`.
                activeEditor = .text(FileEditorModel(file: file))
            case .plist:
                // The data-providing closures capture the per-window child models directly (they
                // outlive any editor and are never replaced) rather than `self` — no ownership
                // cycle, since none of them owns the editor model. `onOpenDependencyFix` is the
                // deliberate exception: presenting the fix sheet is window-level state, so it
                // routes back through `presentDependencyFixSheet(_:)` on `self`, captured weakly
                // so a closed window's model isn't kept alive by an editor that outlives it.
                let graphExplorer = graphExplorer
                let preview = preview
                let securityReports = securityReports
                let dependencySyncOffers = dependencySyncOffers
                activeEditor = .plist(PlistEditorModel(
                    file: file,
                    websiteTitle: site?.name ?? file.name,
                    sourceDirectory: site?.sourceDirectory ?? file.url.deletingLastPathComponent(),
                    configDirectory: site?.configDirectory,
                    graphSnapshotProvider: { graphExplorer.snapshot },
                    onActiveWorkersChanged: { settings in
                        await preview.activeWorkersChanged(settings)
                    },
                    containerControlProvider: { [preview] in await preview.activeContainerControl() },
                    securityReports: securityReports,
                    dependencySyncOffers: dependencySyncOffers,
                    onOpenDependencyFix: { [weak self] offer in self?.presentDependencyFixSheet(offer) }
                ))
            }
            // Same mitigation as Graph/Cleanup/Reader/Followers/Communities (#1126): give a
            // presented inspector's dismissal its own transaction before the pane rebuild below,
            // rather than coalescing both into one.
            await clearInspectorThenSwitchPane(to: .editor(file))
            if kind == .component {
                // `ensureComponentEditorLoaded()`'s synchronous prefix (the `componentEditor =
                // editor` assignment, before its `await editor.load()` suspends) flips
                // `inspectorSelection` from nil to `.component`, presenting the window inspector
                // for the first time. Calling it right after the pane swap above coalesces that
                // *presentation* into the same transaction as the main-pane rebuild — the mirror
                // image of #1126's dismissal case, and the actual trigger of the Component
                // Editor's own AppKit constraint-update storm crash (#1139). Give the pane swap a
                // moment to settle first, same 300ms mitigation as `clearInspectorThenSwitchPane`.
                // Any resulting transient close/reopen flicker of an already-presented inspector
                // is the same benign transient-nil window `SiteWindow`'s `inspectorPresented`
                // binding already tolerates (it preserves `inspectorShown` across a nil selection
                // rather than clobbering it — see its setter, #968/#969) — it does not reintroduce
                // the "inspector never returns" failure mode that guard was written for.
                //
                // This can stack with `clearInspectorThenSwitchPane`'s own conditional sleep just
                // above (up to ~600ms total when a different file's inspector was already
                // presented): the two delays guard two *different* transaction boundaries — old
                // inspector dismissing vs. pane rebuild, then pane rebuild vs. new inspector
                // presenting — so collapsing them back into one wait would reopen whichever gap
                // it skipped. Deliberate, not an oversight; unlike that one, this sleep isn't
                // conditioned on `wasInspecting` because the storm trigger here is the pane
                // rebuild + inspector *presentation* landing together, which happens regardless
                // of whether an inspector was already up.
                await AppKitConstraintStormMitigation.settle()
            }
            await ensureComponentEditorLoaded()
        }
    }

    /// Routes a Cleanup-section row: components/layouts/pages open in the existing in-app editor
    /// (reusing `openFile`, so `.astro` components still get the rich Component Editor via
    /// `EditorKind.resolve`'s `.components`-group check); images have no in-app editor, so Open
    /// reveals the file in Finder instead.
    @MainActor
    func openCleanupCandidate(_ candidate: DeadAssetScanner.CleanupCandidate) {
        guard let site else { return }
        let url = site.sourceDirectory.appendingPathComponent(candidate.path)
        switch candidate.kind {
        case .image:
            NSWorkspace.shared.activateFileViewerSelecting([url])
        case .component, .layout:
            openFile(FileRef(url: url, group: .components, name: url.lastPathComponent))
        case .page:
            openFile(FileRef(url: url, group: .pages, name: url.lastPathComponent))
        }
    }

    /// Deletes a Cleanup-section candidate, discarding (without saving) any editor tab *or*
    /// Inspector context open on that same file — flushing either via its normal leave path would
    /// re-write the buffer to disk and silently resurrect the file `cleanup.delete` removes. A
    /// page selected via the navigator's `.route` branch populates `inspectorContext` (not
    /// `activeEditor`), so both are checked independently.
    ///
    /// Discarded *before* calling `cleanup.delete`, not after: `delete` suspends across two
    /// awaited git subprocess calls, and Swift frees the `@MainActor` during that suspension — any
    /// other main-actor action (the Preview/Editor toggle, closing the window) could otherwise
    /// flush a still-open dirty buffer back to disk while the delete is in flight or immediately
    /// after, resurrecting the file. Discarding first closes that window entirely. Tradeoff: if
    /// the delete subsequently fails, an unsaved edit in that editor/inspector is already gone —
    /// in the ordinary failure case (dirty tree, no HEAD copy, rejecting hook) the file itself is
    /// still untouched, though not in the rare double-failure case `processGitDelete` itself logs
    /// (commit *and* its rollback both fail). Either way this is accepted as strictly preferable
    /// to a silent, undetected resurrection of a file git already recorded as removed.
    ///
    /// On success, also force-refreshes `navigator` and `graphExplorer`: neither observes anything
    /// that fires for a component/layout/page deleted this way (the only thing that does,
    /// `SiteContentGraph`, is never touched here), so without this a stale entry for the deleted
    /// file would stay selectable/openable in the main Navigator tree or the Site Graph explorer —
    /// the same resurrection risk this method just closed for the editor/inspector, reachable
    /// through a different surface.
    ///
    /// **Known residual risk:** the guards above only cover editor/inspector state open *at the
    /// moment this method starts*. Nothing stops a *new* selection on `deletedURL` from
    /// (re)populating `activeEditor`/`inspectorContext` while `cleanup.delete` is still suspended
    /// on its git subprocess calls — the Navigator isn't disabled or told a delete is in flight for
    /// this path. Closing that fully would need a "deleting" set consulted by
    /// `applyNavigatorSelection`/`openFile`/`openCleanupCandidate`, or disabling Navigator
    /// selection for the duration; not attempted here given how narrow the window is in practice
    /// (a `git rm` + `commit` pair, not user-perceptible latency) relative to the scope of that
    /// change.
    @MainActor
    func deleteCleanupCandidate(_ candidate: DeadAssetScanner.CleanupCandidate) async {
        guard let site else { return }
        let deletedURL = site.sourceDirectory.appendingPathComponent(candidate.path)
        if activeEditorFile?.url == deletedURL {
            activeEditor = nil
            mainPaneMode = .preview
        }
        if inspectorContext?.model.file.url == deletedURL {
            inspectorContext = nil
        }
        if componentEditor?.file.url == deletedURL {
            componentEditor = nil
        }
        guard await cleanup.delete(candidate) else { return }
        await navigator?.refreshNow()
        await graphExplorer.refreshNow()
    }

    /// Build the inspector context for a content navigator id: the typed descriptor form when the
    /// file resolves to a content type, the plain title/description form for a frontmatter-bearing
    /// markdown page, or nil (plain `.astro`/other → preview only, no inspector).
    private func makeInspectorContext(forNavigatorID id: String) async -> InspectorContext? {
        guard let source = site?.sourceDirectory else { return nil }
        let relPath: String
        let group: FileGroup
        let displayName: String
        let route: String
        if let page = await contentGraph.page(id: id) {
            relPath = page.filePath; group = .pages; displayName = page.title ?? page.route; route = page.route
        } else if let post = await contentGraph.post(id: id) {
            relPath = post.filePath; group = .posts; displayName = post.title; route = postRoute(for: post)
        } else {
            return nil
        }
        let url = source.appendingPathComponent(relPath)
        let file = FileRef(url: url, group: group, name: displayName)
        if let descriptor = ContentTypeResolver.descriptor(forRelativePath: relPath) {
            return .typed(TypedEntryEditorModel(file: file, descriptor: descriptor, route: route, sourceDirectory: source))
        }
        if isFrontmatterPage(relPath) {
            return .page(PageMetadataModel(file: file, route: route, sourceDirectory: source))
        }
        // Plain .astro / other: no safe generic way to parse or rewrite its frontmatter (JS, not
        // YAML), so title/description/body stay read-only (#1100) — the search/crawling toggles
        // are the one exception (#1093), backed by the shared robots config, not this file.
        return .generic(GenericPageInspectorModel(file: file, route: route, sourceDirectory: source))
    }

    /// Assembles the collection context for a `.directory` selection: title/children from the
    /// navigator node, entry count from the graph, feed routes from the (off-main) probe, and
    /// type/template identity from the registry. Read-mostly v1 (#714 §6).
    private func makeCollectionInspection(
        collection: String?, route: String, navigatorID: String
    ) async -> CollectionInspection? {
        guard let site else { return nil }
        let node = navigator?.node(for: navigatorID)
        let entryCount: Int
        if let collection {
            entryCount = await contentGraph.posts(for: site.id)
                .filter { $0.collection == collection }.count
        } else {
            entryCount = node?.children?.count ?? 0
        }
        let feeds: [SiteFileTree.DetectedFeed]
        if let collection {
            let packageURL = site.packageURL
            feeds = await Task.detached {
                SiteFileTree.detectedFeeds(siteRoot: packageURL, collection: collection)
            }.value
        } else {
            feeds = []
        }
        let descriptor = collection.flatMap { ContentTypeRegistry.default.descriptor(forCollection: $0) }
        return CollectionInspection(
            title: node?.title ?? route, route: route, collection: collection,
            entryCount: entryCount, feeds: feeds,
            contentTypeName: descriptor?.displayName,
            microformat: descriptor?.projections.microformat)
    }

    /// Builds the Component Editor's context from current preview state. Mirrors what
    /// `SiteWindow.mainPaneContent` used to construct inline: `editRouter` is deliberately
    /// `preview.editRouter` — the registered, chat-history-wired router the preview canvas uses —
    /// so edits made through either canvas behave identically.
    private func makeComponentEditorContext(site: SiteStore.Site) -> ComponentEditorContext {
        ComponentEditorContext(
            baseURL: preview.readyURL,
            modelClient: ComponentModelClient(mcpClient: { [preview] in await preview.mcpClient() }),
            sourceRoot: site.sourceDirectory,
            site: CurrentSite(site),
            editRouter: preview.editRouter,
            onOpenFile: { [weak self] file in self?.openFile(file) },
            duplicateComponent: { [weak self] relativePath in
                await self?.duplicateComponent(relativePath: relativePath) ?? .siteNotFound
            }
        )
    }

    /// (Re)builds the hoisted component editor for the active editor file when it is an `.astro`
    /// component — keyed on (file, dev-server baseURL) exactly like `ComponentEditorView`'s old
    /// view-local `LoadKey`: a nil→non-nil `readyURL` transition rebuilds the model so the harness
    /// canvas can load; a repeat call for the same (file, baseURL) is idempotent only while the
    /// existing model is healthy — an unhealthy one (a failed or cancelled `load()`) is rebuilt
    /// instead, never returned as-is (#714 final review, Important 2). Clears the editor for
    /// non-component files.
    @MainActor
    func ensureComponentEditorLoaded() async {
        guard let site, let file = activeEditorFile,
              EditorKind.resolve(for: file) == .component else {
            componentEditor = nil
            return
        }
        // Only skip the rebuild when the existing model is actually healthy — a prior `load()`
        // that failed (including a `CancellationError` from a pane toggle mid-load, which lands
        // in `load()`'s generic `catch` as `.other`) must not wedge this file on a permanently
        // broken instance forever (#714 final review, Important 2). `.notConnected` recovery is
        // already handled above by the `baseURL` key changing once the dev server comes up.
        if let existing = componentEditor, existing.file.id == file.id,
           existing.context.baseURL == preview.readyURL,
           existing.loadError == nil, existing.model != nil {
            return
        }
        let editor = ComponentEditorModel(file: file, context: makeComponentEditorContext(site: site))
        componentEditor = editor
        await editor.load()
    }

    private func isFrontmatterPage(_ relPath: String) -> Bool {
        let ext = (relPath as NSString).pathExtension.lowercased()
        return ext == "md" || ext == "mdx" || ext == "markdown"
    }

    nonisolated static let healthAssistantPrompt =
        "Audit this site for issues and suggest improvements to make it deploy-ready. Review the available site content and call out concrete files or sections when relevant."

    func saveWebsiteTitle(_ title: String) async {
        guard let id = site?.id else { return }
        do {
            guard let updated = try await SiteStore.shared.setDisplayName(title, for: id) else { return }
            site = updated
            navigator?.updateWebsiteTitle(updated.name)
        } catch {
            await LogCenter.shared.append(
                source: "editor", stream: .stderr,
                text: "Saving website title failed: \(error.localizedDescription)"
            )
        }
    }

    /// `contentCreation`'s successful create already rescans `SiteContentGraph` and publishes a
    /// change event, but the Navigator consumes that event on its own long-running observer `Task`
    /// (`SiteNavigatorModel.start()`) — decoupled from this call, so nothing guarantees it has
    /// drained and rebuilt `sections` before the New-content sheet reads `.created` and dismisses
    /// itself. Force-refreshing here closes that race, same as `createComponent` already did (#586).
    func createPage(
        title: String,
        route: String?,
        template: ContentScaffold.PageTemplate
    ) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.createPage(
            siteID: site.id,
            title: title,
            route: route,
            template: template
        )
        if case .created(let filePath, _) = result {
            await navigator?.refreshNow()
            registerContentUndo(
                actionName: ContentUndoCoordinator.createActionName("Page"),
                relativePath: filePath, before: nil, after: createdContents(at: filePath))
        }
        return result
    }

    /// See `createPage`'s force-refresh note (#586) — same race, same fix.
    func createCollectionEntry(
        title: String,
        slug: String?,
        descriptor: ContentTypeDescriptor,
        fieldValues: [String: String] = [:]
    ) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.createTyped(
            siteID: site.id,
            typeID: descriptor.id,
            title: title,
            slug: slug,
            fieldValues: fieldValues
        )
        if case .created(let filePath, _) = result {
            await navigator?.refreshNow()
            registerContentUndo(
                actionName: ContentUndoCoordinator.createActionName(descriptor.displayName),
                relativePath: filePath, before: nil, after: createdContents(at: filePath))
        }
        return result
    }

    /// See `createPage`'s force-refresh note (#586) — same race, same fix.
    func createPost(title: String) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.createPost(siteID: site.id, title: title, collection: nil, slug: nil)
        if case .created(let filePath, _) = result {
            await navigator?.refreshNow()
            registerContentUndo(
                actionName: ContentUndoCoordinator.createActionName("Post"),
                relativePath: filePath, before: nil, after: createdContents(at: filePath))
        }
        return result
    }

    /// Components aren't tracked in `SiteContentGraph` at all, so there's no change-stream event to
    /// race with — this force-refresh is the *only* way the Navigator learns about a new component.
    /// Same reasoning as `deleteCleanupCandidate`'s force-refresh for non-graph-tracked files.
    func createComponent(name: String) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.createComponent(siteID: site.id, name: name)
        if case .created(let filePath, _) = result {
            await navigator?.refreshNow()
            registerContentUndo(
                actionName: ContentUndoCoordinator.createActionName("Component"),
                relativePath: filePath, before: nil, after: createdContents(at: filePath))
        }
        return result
    }

    /// Duplicates the component at `relativePath` (design spec §6.3: "duplicate-and-modify" —
    /// surfaced on the Component Editor's own palette, since project components aren't tracked
    /// in `SiteContentGraph` or shown in the page-only Navigator). Same force-refresh reasoning
    /// as `createComponent`.
    func duplicateComponent(relativePath: String) async -> ContentCreateResult {
        guard let site else { return .siteNotFound }
        let result = await contentCreation.duplicateComponent(siteID: site.id, relativePath: relativePath)
        if case .created(let filePath, let identifier) = result {
            await navigator?.refreshNow()
            registerContentUndo(
                actionName: ContentUndoCoordinator.duplicateActionName(identifier),
                relativePath: filePath, before: nil, after: createdContents(at: filePath))
        }
        return result
    }

    /// Registers a completed structural content operation for Edit ▸ Undo / Redo (#675). One line
    /// per call site; everything about stack mechanics lives in `ContentUndoCoordinator`.
    /// `before`/`after` are the file's contents on either side of the operation, `nil` meaning the
    /// file did not exist. A `nil` contents read (unreadable encoding, permissions) simply means
    /// no undo record — never a blocked operation.
    private func registerContentUndo(
        actionName: String, relativePath: String, before: String?, after: String?
    ) {
        guard before != nil || after != nil else { return }
        // A create/duplicate: the file didn't exist a moment ago, so nothing can be owed to it.
        // Drops any snapshot an earlier, never-undone delete of this same path left behind.
        if before == nil { closedSurfaces[relativePath] = nil }
        contentUndoCoordinator.register(ContentUndoCoordinator.Mutation(
            relativePath: relativePath, before: before, after: after, actionName: actionName))
    }

    /// Reads the contents a create/duplicate just wrote, so the operation's redo side is captured.
    /// Best-effort, per `registerContentUndo`.
    private func createdContents(at relativePath: String) -> String? {
        guard let site else { return nil }
        return try? String(
            contentsOf: site.sourceDirectory.appendingPathComponent(relativePath), encoding: .utf8)
    }

    /// Closes any editor/inspector open on `url` and snapshots what was closed under
    /// `relativePath`, so a later restore of that file can reopen it. Shared by `confirmDelete()`
    /// and `applyContentUndo`'s delete branch, which must both close surfaces *before* the delete
    /// call — a suspended editor flush across the git calls would otherwise resurrect the file.
    @discardableResult
    private func closeSurfaces(for url: URL, relativePath: String) -> ClosedFileSurfaces {
        var editor: ActiveEditor?
        let mode = mainPaneMode
        if activeEditorFile?.url == url, let open = activeEditor {
            editor = open
            activeEditor = nil
            mainPaneMode = .preview
        }
        var inspector: InspectorContext?
        if inspectorContext?.model.file.url == url {
            inspector = inspectorContext
            inspectorContext = nil
        }
        let closed = ClosedFileSurfaces(mode: mode, editor: editor, inspector: inspector)
        // Assigned unconditionally, `nil` included: closing nothing has to *clear* any snapshot a
        // previous delete of this same path left behind unconsumed, or a later restore would
        // reopen an editor holding a long-dead buffer for a file that has since been recreated.
        closedSurfaces[relativePath] = closed.isEmpty ? nil : closed
        return closed
    }

    /// Reopens whatever `closeSurfaces(for:relativePath:)` snapshotted for `relativePath`, and
    /// forgets it. No-op when nothing was open.
    private func reopenSurfaces(for relativePath: String) {
        guard let closed = closedSurfaces.removeValue(forKey: relativePath) else { return }
        if let editor = closed.editor {
            activeEditor = editor
            mainPaneMode = closed.mode
        }
        if let inspector = closed.inspector {
            inspectorContext = inspector
        }
    }

    /// Shared by every content-action failure path below whose `contentCreation` call resolves
    /// `.siteNotFound` (#987) — matches `NewContentSheets`' wording for the same case, so a user
    /// who hits this from a create flow and a content-action flow sees consistent text.
    private static let siteNotFoundMessage = "This site is no longer available."

    /// Reports a Navigator row that outlived its `SiteContentGraph` entry (#987) — a page/post
    /// deleted outside the app, or a rescan racing the action. Falls back to a generic phrase
    /// when `navigator` itself no longer has the row either (e.g. no `loadAndStart()` ran, as in
    /// most of this file's own tests).
    private func reportUnresolvedRow(id: String) {
        contentActionError = "\(navigator?.item(for: id)?.title ?? "This item") is no longer part of this site's content."
    }

    /// The `ContentUndoCoordinator` applier: realize `mutation.before` at its path — write those
    /// exact bytes, or delete the file when `before` is nil. Both halves route through
    /// `contentCreation`, so an undo commits and rescans the content graph exactly like the
    /// operation it reverses; the Navigator is force-refreshed for the same reason the create and
    /// delete paths do it (its observer task is decoupled from this call, #586).
    /// Internal rather than private only so `SiteWindowModelTests` can drive it directly.
    @MainActor
    func applyContentUndo(
        _ mutation: ContentUndoCoordinator.Mutation
    ) async -> ContentUndoCoordinator.ApplyOutcome {
        guard let site else { return .failed }
        let url = site.sourceDirectory.appendingPathComponent(mutation.relativePath)

        guard let contents = mutation.before else {
            closeSurfaces(for: url, relativePath: mutation.relativePath)
            switch await contentCreation.deleteContent(
                siteID: site.id, relativePath: mutation.relativePath) {
            case .deleted:
                await navigator?.refreshNow()
                // Resolved against the *rebuilt* tree rather than by comparing paths up front:
                // whatever row backed this file is simply gone now, and a selection pointing at a
                // node that no longer exists leaves the sidebar highlighting nothing openable.
                if let selection = navigator?.selection, navigator?.item(for: selection) == nil {
                    navigator?.selection = nil
                }
                return .applied
            case .failed(let reason):
                contentActionError = reason
                // The delete never touched the file, so put back what closing it took away.
                reopenSurfaces(for: mutation.relativePath)
                return .failed
            case .siteNotFound:
                contentActionError = Self.siteNotFoundMessage
                reopenSurfaces(for: mutation.relativePath)
                return .failed
            }
        }

        switch await contentCreation.restoreContent(
            siteID: site.id, relativePath: mutation.relativePath, contents: contents) {
        case .created:
            await navigator?.refreshNow()
            reopenSurfaces(for: mutation.relativePath)
            return .applied
        case .failed(let reason):
            contentActionError = reason
            // `restoreContent` reports `.failed` both when the write itself failed and when only
            // its recommit did — reopen iff the file actually made it back to disk, matching the
            // check the retired one-shot undo affordance used.
            if FileManager.default.fileExists(atPath: url.path) {
                await navigator?.refreshNow()
                reopenSurfaces(for: mutation.relativePath)
            }
            return .failed
        case .siteNotFound:
            contentActionError = Self.siteNotFoundMessage
            return .failed
        }
    }

    /// Resolves `deleteConfirmation` to its page/post record, deletes via
    /// `contentCreation.deleteContent`, and clears the confirmation. Mirrors
    /// `deleteCleanupCandidate`'s ordering: editor/inspector state open on the file being deleted
    /// is discarded *before* the delete call (not after), so a suspended flush across the git
    /// subprocess calls can't resurrect the file. Unlike `deleteCleanupCandidate` (dead assets,
    /// rarely under active edit), pages/posts routinely are — so the discarded state is snapshotted
    /// and restored on `.failed`, rather than silently dropped, since a failed delete never
    /// actually touched the file (PR #585 review); on success it's kept keyed by path so a ⌘Z
    /// restore reopens it (#675).
    @MainActor
    func confirmDelete() async {
        guard let item = deleteConfirmation else { return }
        deleteConfirmation = nil
        guard let site, case .route = item.target else { return }

        let relPath: String
        // Captured before the delete call, not derived after: `.deleted(filePath:)` doesn't carry
        // a route. Both pages and posts are redirect-offer candidates (#584) — a post's route is
        // derived via `postRoute(for:)`, the same helper the navigator uses to give posts a
        // `.route` target in the first place.
        var deletedRoute: String?
        if let page = await contentGraph.page(id: item.id) {
            relPath = page.filePath
            deletedRoute = page.route
        } else if let post = await contentGraph.post(id: item.id) {
            relPath = post.filePath
            deletedRoute = postRoute(for: post)
        } else {
            // Reachable whenever the row outlived the graph entry behind it (a page deleted
            // outside the app, a rescan mid-dialog). Reported rather than returned silently:
            // an unexplained no-op here is exactly what #968 was raised about.
            contentActionError = "\(item.title) is no longer part of this site's content."
            return
        }

        let deletedURL = site.sourceDirectory.appendingPathComponent(relPath)
        // Read before the delete call, not after: the file is gone from disk once the delete
        // succeeds. Best-effort — a read failure (unreadable encoding, permissions) just means no
        // ⌘Z record, not a blocked delete.
        let savedContents = try? String(contentsOf: deletedURL, encoding: .utf8)
        closeSurfaces(for: deletedURL, relativePath: relPath)

        let result = await contentCreation.deleteContent(siteID: site.id, relativePath: relPath)
        switch result {
        case .deleted:
            if navigator?.selection == item.id { navigator?.selection = nil }
            // `deleteContent` only rescans `SiteContentGraph`; the Navigator's own consumption of
            // that change is a decoupled async observer task, so nothing guarantees it has rebuilt
            // `sections` yet — force it, same race/fix as the create paths (#586).
            await navigator?.refreshNow()
            registerContentUndo(
                actionName: ContentUndoCoordinator.deleteActionName(item.title),
                relativePath: relPath, before: savedContents, after: nil)
            if let deletedRoute {
                pendingRedirectOfferRoute = deletedRoute
            }
        case .failed(let reason):
            contentActionError = reason
            // A failed delete never touched the file, so put back what closing it took away.
            reopenSurfaces(for: relPath)
        case .siteNotFound:
            contentActionError = Self.siteNotFoundMessage
            reopenSurfaces(for: relPath)
        }
    }

    /// Duplicates the page/post at `id`. Non-destructive, so no confirmation. On success, refreshes
    /// the Navigator (deterministic — doesn't rely on `SiteContentGraph`'s change-stream having
    /// already been drained by the time this returns) and selects the new item, whose id follows
    /// the documented `SiteContentGraph.Page`/`Post` format (`"{siteID}:page:{route}"` /
    /// `"{siteID}:post:{slug}"`) — `identifier` in `ContentCreateResult.created` is exactly the
    /// route (page) or slug (post) per that type's own doc comment.
    @MainActor
    func duplicate(id: String) async {
        guard let site else { return }

        let result: ContentCreateResult
        let isPost: Bool
        let sourceTitle: String
        if let page = await contentGraph.page(id: id) {
            isPost = false
            sourceTitle = page.title ?? page.route
            result = await contentCreation.duplicatePage(
                siteID: site.id, relativePath: page.filePath, title: sourceTitle)
        } else if let post = await contentGraph.post(id: id) {
            isPost = true
            sourceTitle = post.title
            result = await contentCreation.duplicatePost(
                siteID: site.id, relativePath: post.filePath, collection: post.collection, title: sourceTitle)
        } else {
            reportUnresolvedRow(id: id)
            return
        }

        switch result {
        case .created(let filePath, let identifier):
            await navigator?.refreshNow()
            navigator?.selection = isPost ? "\(site.id):post:\(identifier)" : "\(site.id):page:\(identifier)"
            // Named for the *source* item, not the generated "About Copy" — "Undo Duplicate
            // “About”" is what the user recognizes as the action they just took.
            registerContentUndo(
                actionName: ContentUndoCoordinator.duplicateActionName(sourceTitle),
                relativePath: filePath, before: nil, after: createdContents(at: filePath))
        case .failed(let reason):
            contentActionError = reason
        case .siteNotFound:
            contentActionError = Self.siteNotFoundMessage
        }
    }

    /// Publishes the post at `id` (#798): sets `draft: false`, re-stamping `publishDate` only on
    /// a first publish. Non-destructive (Unpublish reverses it), so no confirmation — same
    /// no-confirmation precedent as `duplicate(id:)`.
    @MainActor
    func publish(id: String) async {
        guard let site else { return }
        guard let post = await contentGraph.post(id: id) else {
            reportUnresolvedRow(id: id)
            return
        }
        let result = await contentCreation.publish(
            siteID: site.id, relativePath: post.filePath, collection: post.collection)
        switch result {
        case .created:
            await navigator?.refreshNow()
        case .failed(let reason):
            contentActionError = reason
        case .siteNotFound:
            contentActionError = Self.siteNotFoundMessage
        }
    }

    /// Unpublishes the post at `id` (#798): sets `draft: true`, leaving `publishDate` untouched.
    @MainActor
    func unpublish(id: String) async {
        guard let site else { return }
        guard let post = await contentGraph.post(id: id) else {
            reportUnresolvedRow(id: id)
            return
        }
        let result = await contentCreation.unpublish(
            siteID: site.id, relativePath: post.filePath, collection: post.collection)
        switch result {
        case .created:
            await navigator?.refreshNow()
        case .failed(let reason):
            contentActionError = reason
        case .siteNotFound:
            contentActionError = Self.siteNotFoundMessage
        }
    }

    /// Scan `sourceDirectory` and load the result into `contentGraph`. Called from `loadAndStart`
    /// so the graph is warm (`isPopulated(siteID:) == true`) before the first chat turn, not just
    /// after the first content create/delete (#660).
    func refreshContentGraph(siteID: String, sourceDirectory: URL) async {
        await contentGraph.rescan(siteID: siteID, projectRoot: sourceDirectory)
    }

    func loadAndStart(siteID: String?, openSitesWindow: () -> Void, dismissSiteWindow: @escaping () -> Void) async {
        self.dismissSiteWindow = dismissSiteWindow
        // SwiftUI's NSPersistentUIManager will happily restore a WindowGroup with a
        // nil payload, or one whose value no longer matches a known site (sites.json
        // edited externally, a previous-session site was removed, etc). Both cases
        // route back to the launcher rather than stranding the user in an empty or
        // unresolvable SiteWindow.
        guard let siteID else {
            openSitesWindow()
            dismissSiteWindow()
            return
        }
        let store = SiteStore.shared
        do {
            try await store.load()
        } catch {
            // Non-fatal: we'll fall back to whatever's already in the persisted list.
        }
        guard let resolved = await store.find(id: siteID) else {
            openSitesWindow()
            dismissSiteWindow()
            return
        }
        site = resolved
        // Constructed once and threaded into every child model below instead of each one
        // separately re-deriving `id`/`sourceDirectory`/`packageURL`/`configDirectory` from
        // `resolved` at its own call site (#822) — see `CurrentSite`'s own doc comment.
        let currentSite = CurrentSite(resolved)
        AppSettings.shared.lastOpenedSiteID = resolved.id
        try? await store.touch(id: resolved.id)
        // #881: pull on site open. `SyncModel.start` no-ops entirely for a package that isn't in
        // iCloud Drive, so a plain local site sees zero sync activity here.
        sync.start(package: AnglesitePackage(url: resolved.packageURL))
        // #975: fired here (not awaited) so a slow/offline GitHub check never delays site open —
        // the toolbar badge and Settings tab populate whenever it settles.
        recheckSecurityReports()

        #if ANGLESITE_MAS
        await grantController.acquireGrant(for: resolved, in: store)
        #endif

        // Recreate the provider whenever the resolved siteID changes — SwiftUI's
        // `WindowGroup` can replay a different value into the same view instance on restore,
        // so a `nil` check alone isn't enough; a stale provider would hold the wrong siteID
        // and Siri would hit-test against the wrong site's entities.
        if annotationProvider?.siteID != resolved.id {
            if let old = annotationProvider {
                PreviewAnnotationProviderRegistry.shared.unregister(siteID: old.siteID)
            }
            let provider = PreviewAnnotationProvider(siteID: resolved.id, graph: contentGraph)
            annotationProvider = provider
            // Register so `ElementEntityQuery` resolves entity ids in production (not just
            // under the `ElementEntityProviderOverride.scoped` TaskLocal that tests use).
            PreviewAnnotationProviderRegistry.shared.register(provider, for: resolved.id)
        }

        if let templateURL = TemplateRuntime.bundledURL(), let runningVersion = AppVersion.current() {
            let offers = DependencySyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL,
                runningAppVersion: runningVersion
            )
            dependencySyncOffers = offers
            if !offers.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    dependencyUpdateModel = DependencyUpdateModel(offers: offers) { [weak self] accepted in
                        guard let self else { continuation.resume(); return }
                        if accepted {
                            self.applyDependencySyncOffers(
                                offers, sourceDirectory: resolved.sourceDirectory, configDirectory: resolved.configDirectory)
                        }
                        self.dependencyUpdateModel = nil
                        continuation.resume()
                    }
                }
            }
        }
        // Give SwiftUI a moment to fully settle the dependency-sync sheet's dismissal (including
        // its dismiss *animation*, not just the state change) before the scripts-sync sheet below
        // requests its own presentation — back-to-back `.sheet(item:)` presentations in the same
        // synchronous continuation-resumption stack risk a silently-failed second presentation,
        // which (with `.interactiveDismissDisabled()` on both sheets) would leave this method's
        // `CheckedContinuation` unresumed forever. Same mitigation, same class of problem, as
        // `clearInspectorThenSwitchPane` above (`AppKitConstraintStormMitigation`) — a real
        // guarantee would mean gating on the first sheet's actual `onDisappear`, which isn't done
        // here; accepted as low-risk because this path only triggers when a single site-open
        // queues both a dependency offer and a script divergence at once (an app-upgrade edge
        // case) — narrow enough that a manual QA pass covering it (see this PR's test plan) is the
        // practical verification, not a proof.
        await AppKitConstraintStormMitigation.settle()
        if let templateURL = TemplateRuntime.resolve().url {
            let plan = TemplateScriptsSyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL
            )
            if !plan.toApply.isEmpty {
                do {
                    try TemplateScriptsSyncApplier.applyQueued(
                        plan.toApply,
                        sourceDirectory: resolved.sourceDirectory,
                        configDirectory: resolved.configDirectory,
                        templateDirectory: templateURL
                    )
                } catch {
                    Self.logger.error(
                        "scripts/ silent refresh failed for \(resolved.id, privacy: .public): \(String(describing: error), privacy: .public)"
                    )
                }
            }
            if !plan.divergences.isEmpty {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    scriptSyncModel = ScriptSyncModel(
                        divergences: plan.divergences,
                        onResolve: { [weak self] divergence, decision in
                            guard let self else { return false }
                            do {
                                try TemplateScriptsSyncApplier.resolve(
                                    divergence,
                                    decision: decision,
                                    sourceDirectory: resolved.sourceDirectory,
                                    configDirectory: resolved.configDirectory,
                                    templateDirectory: templateURL
                                )
                                return true
                            } catch {
                                // Logged, and the row stays in `ScriptSyncModel.pending` rather than
                                // being silently marked resolved — a failed write must not read to
                                // the owner as a successful one (that's the exact failure mode
                                // #1053 exists to close, just moved one layer down).
                                Self.logger.error(
                                    "scripts/ divergence resolve failed for \(divergence.relativePath, privacy: .public): \(String(describing: error), privacy: .public)"
                                )
                                return false
                            }
                        },
                        onFinished: { [weak self] in
                            self?.scriptSyncModel = nil
                            continuation.resume()
                        }
                    )
                }
            }
        }
        styleGuide = ProjectConventionsModel(
            engine: conventionsEngine,
            siteID: resolved.id,
            siteDirectory: resolved.sourceDirectory,
            configDirectory: resolved.configDirectory
        )
        // Seed the shared engine from any persisted override BEFORE preview.open() below
        // triggers the runtime's own boot-time rebuild — engine.seed(...) is a no-op once a
        // value is present, so seeding order matters: seed first, or a restored override is
        // silently discarded by the runtime's fresh scan (#313).
        await styleGuide?.seedFromDisk()
        preview.open(site: currentSite)
        startInvisiblePublishing(for: currentSite)
        // Warm the content graph now rather than waiting for the first create/delete (#660), so
        // `SearchContentTool`'s `isPopulated` check is already reliable by the time the chat
        // assistant is wired up below. Kicked off in the background (not awaited here) so its
        // filesystem walk runs concurrently with the Navigator's and Graph Explorer's own,
        // independent scans just below rather than serializing three full-tree walks; only
        // awaited right before `SiteAssistantSessionFactory.makeSession` constructs
        // `SearchContentTool`, the one thing that actually needs it done. Runs unconditionally —
        // the scan is deterministic filesystem I/O, independent of whether a container runtime
        // is available.
        let contentGraphRefresh = Task {
            await refreshContentGraph(siteID: resolved.id, sourceDirectory: resolved.sourceDirectory)
        }
        // Warm the knowledge index here for the same reason, and on the same terms (#980): it is
        // a filesystem scan of Source/ that needs no container, no MCP, and no dev server. Until
        // this, the only thing that populated it on the open path was the runtime — *after*
        // `control.start` and `connect(...)` in `LocalContainerSiteRuntime` — so every index
        // consumer (toolbar search #520, assistant retrieval, Related Pages) silently returned
        // nothing for as long as the container took to boot, and forever on a machine where the
        // runtime can't start at all. Searching a page by its own name and getting "No matching
        // content" is indistinguishable from a real miss, which is what made it worth fixing here
        // rather than leaving search to inherit it.
        //
        // The runtime still rebuilds when it comes up; `SiteKnowledgeIndex` is an actor and
        // rebuild is idempotent, so the two serialize and the later one simply refreshes from the
        // hydrated repo. Not awaited — nothing below needs it, and the assistant's tools read the
        // index lazily at call time.
        Task { [knowledgeIndex] in
            await knowledgeIndex.rebuild(siteID: resolved.id, projectRoot: resolved.sourceDirectory)
        }
        // Scan from the package ROOT (not Source/): SiteFileTree's adaptive layout detects the
        // `.anglesite` package here and resolves Source/ for Components/Styles plus the sibling
        // Config/ + Info.plist for the Metadata group. Handing it Source/ would hide Metadata.
        // Stop any prior navigator (window replay into the same instance) right before replacing it,
        // so its observe task doesn't leak and keep streaming for the stale site. Done here at the
        // deterministic replacement point rather than in `onChange(of: site?.id)`, which could race
        // this creation and stop the freshly-made navigator instead.
        navigator?.stop()
        let navModel = SiteNavigatorModel(graph: contentGraph)
        // Rename is the one structural operation this model doesn't own (it's the navigator's
        // inline edit, also reached from File ▸ Rename…), so the navigator registers its own ⌘Z
        // record through this hook rather than duplicating the coordinator (#675).
        navModel.registerUndo = { [weak self] mutation in
            self?.contentUndoCoordinator.register(mutation)
        }
        navModel.start(site: currentSite, websiteTitle: currentSite.name)
        navigator = navModel
        graphExplorer.start(site: currentSite)
        cleanup.configure(site: currentSite)
        reader.configure(site: currentSite)
        followers.configure(site: currentSite)
        communities.configure(site: currentSite)
        domain.configure(site: currentSite)
        connectDomain.configure(site: currentSite)
        buyDomain.configure(site: currentSite)
        harden.configure(site: currentSite)
        domainConfigAudit.configure(site: currentSite)
        // Cold-open path for any `PreviewSiteIntent` (#139) navigation; the already-open window
        // is handled reactively by `.onChange(of: router.pendingNavigation)` in `body`.
        applyPendingNavigation(for: resolved.id)
        applyPendingDesignInterviewRequest(for: resolved.id)
        await contentGraphRefresh.value
        let assistantSession = AssistantSessionAssembler.makeSession(
            for: currentSite,
            preview: preview,
            contentGraph: contentGraph,
            knowledgeIndex: knowledgeIndex,
            semanticRanker: semanticRanker,
            conventionsEngine: conventionsEngine,
            integrationService: integrationOps,
            graphSnapshotProvider: { [weak self] in
                guard let self else { return SiteGraphExplorerSnapshot(nodes: [], edges: []) }
                return await MainActor.run { self.graphExplorer.snapshot }
            }
        )
        chat = assistantSession.chat
        // The environment undo manager usually lands before the chat exists (cold open) —
        // attach it now so edits applied with the chat panel closed still register for ⌘Z.
        assistantSession.chat.editUndoCoordinator.undoManager = windowUndoManager
        preview.setEditObserver(
            assistantSession.editObserver,
            postProcess: assistantSession.editPostProcessor
        )
        deploy.onScanComplete = { [health] outcome in
            health.ingestDeployOutcome(outcome)
        }
        publish.refreshRemote(source: resolved.sourceDirectory)
    }

    // MARK: - Invisible publishing (#357)

    private func startInvisiblePublishing(for site: CurrentSite) {
        invisiblePublish.start(
            for: site,
            publisher: { [weak self] in
                guard let self else { return .deferred(reason: "the site window closed") }
                return await self.performInvisiblePublish(siteID: site.id)
            },
            onStateChange: { [weak self] state in self?.invisiblePublishState = state }
        )
    }

    private func stopInvisiblePublishing() {
        invisiblePublish.stop()
        invisiblePublishState = .idle
    }

    private func performInvisiblePublish(siteID: String) async -> InvisiblePublishQueue.Result {
        guard let site, site.id == siteID else { return .deferred(reason: "the site is no longer open") }
        guard !backup.isRunning, !audit.isRunning else {
            return .deferred(reason: "another site operation is running")
        }
        let pageRoutes = await contentGraph.pages(for: site.id).map(\.route)
        let postRoutes = await contentGraph.posts(for: site.id).map(postRoute(for:))
        return await deploy.deployAutomatically(
            siteID: site.id,
            siteDirectory: site.sourceDirectory,
            configDirectory: site.configDirectory,
            currentRoutes: pageRoutes + postRoutes,
            containerControlProvider: { [preview] in await preview.activeContainerControl() },
            siteName: site.name
        )
    }
}
