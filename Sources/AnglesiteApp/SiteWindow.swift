import SwiftUI
import WebKit
import AnglesiteCore
import AnglesiteIntents

/// Root view for a single per-site window. Per-site orchestration lives in
/// `SiteWindowModel`; this type owns only SwiftUI layout and scene-scoped UI state.
///
/// Multi-window invariant: every site window stands alone. Closing one does not
/// affect the others, and SwiftUI dedupes `openWindow(value: id)` calls — opening
/// the same site twice just focuses the existing window.
struct SiteWindow: View {
    /// Optional because SwiftUI may restore a `WindowGroup(for: String.self)` with a
    /// nil payload — see `SiteWindowModel.loadAndStart` for how that's handled.
    let siteID: String?

    private let contentTypeRegistry = ContentTypeRegistry()
    @State private var model: SiteWindowModel

    /// Sidebar visibility persisted per scene (window), per the design spec. Column WIDTH is restored
    /// automatically by `NavigationSplitView`'s own scene state, so only explicit visibility is wired.
    @SceneStorage("siteNavigator.sidebarVisible") private var sidebarVisible = true
    /// Inspector visibility, persisted per window. Defaults to shown (auto-open); the toolbar toggle
    /// flips it and the choice persists across selections.
    @SceneStorage("siteInspector.shown") private var inspectorShown = true
    /// The title shown in the content-delete confirmation dialog. Held separately from
    /// `model.deleteConfirmation` so the title stays stable through the dismiss animation —
    /// mirrors `SiteNavigatorView`'s `candidateToDeleteTitle` for the same reason.
    @State private var contentDeleteTitle: String = ""
    @State private var unsavedEditsTerminationLease: SuddenTerminationController.Lease?
    /// The component harness canvas's live webview, bubbled up through
    /// `MainPaneEditorView`/`ComponentEditorView` so the window inspector's Style pane can drive
    /// the ColorPicker scrub preview (#714 slice 3). A UI resource handle — view state, not model
    /// state.
    @State private var componentCanvasWebView: WKWebView?
    /// The last `ComponentEditorActivationKey` this window's activation `.task(id:)` actually ran
    /// for — lets that task tell a genuine key change (new component/dev-server URL) apart from a
    /// same-key re-appearance (e.g. a Preview↔Editor toggle), since `.task(id:)` restarts on every
    /// reappearance of its host view even when `id` is unchanged. See the task body for why that
    /// distinction matters (#714 final review, Important 1).
    @State private var lastComponentActivationKey: ComponentEditorActivationKey?

    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    /// Reduce Motion → fade the chat panel and deploy drawer in/out instead of sliding them.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The window's undo manager, published into the model so app-applied edits register with
    /// Edit ▸ Undo (⌘Z) — see `ChatModel.editUndoCoordinator` (#527).
    @Environment(\.undoManager) private var undoManager

    init(
        siteID: String?,
        contentGraph: SiteContentGraph,
        knowledgeIndex: SiteKnowledgeIndex,
        semanticRanker: SemanticRanker?,
        conventionsEngine: ProjectConventionsEngine,
        runtimeFactory: any SiteRuntimeFactory,
        contentIndexerStore: ContentIndexerStore
    ) {
        self.siteID = siteID
        _model = State(initialValue: SiteWindowModel(
            contentGraph: contentGraph,
            knowledgeIndex: knowledgeIndex,
            semanticRanker: semanticRanker,
            conventionsEngine: conventionsEngine,
            runtimeFactory: runtimeFactory,
            contentIndexerStore: contentIndexerStore
        ))
    }

    var body: some View {
        focusedValues(for: coreBody)
            .onAppear {
                // Also stash the launcher-opener here (see SitesWindowRoot): window restoration can
                // relaunch the app with only site windows, so relying on the launcher's onAppear
                // alone would leave Dock ▸ New Site a silent no-op on such launches (#522 review).
                let openWindow = openWindow
                WindowRouter.shared.openSitesWindow = { openWindow(id: "sites") }
            }
            .onDisappear {
                let terminationLease = unsavedEditsTerminationLease
                unsavedEditsTerminationLease = nil
                model.close(suddenTerminationLease: terminationLease)
            }
    }

    /// The Group + lifecycle-task/onChange chain, factored out of `body` as its own type-checking
    /// unit — see `focusedValues(for:)` for why.
    @ViewBuilder
    private var coreBody: some View {
        Group {
            if let site = model.site {
                siteUI(for: site)
            } else {
                ProgressView("Loading site…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: siteID) {
            await model.loadAndStart(
                siteID: siteID,
                openSitesWindow: { openWindow(id: "sites") },
                dismissSiteWindow: { dismissWindow() }
            )
        }
        .task(id: model.site?.id) { await model.observeStoreChanges() }
        // Warm path: an already-open window reacts to a new `PreviewSiteIntent` request (the
        // cold path is `applyPendingNavigation` in `SiteWindowModel.loadAndStart`).
        .onChange(of: model.router.pendingNavigation) { _, _ in
            if let id = model.site?.id { model.applyPendingNavigation(for: id) }
        }
        // Same warm/cold split as above, for `StartDesignInterviewIntent` requests (#631).
        .onChange(of: model.router.pendingDesignInterview) { _, _ in
            if let id = model.site?.id { model.applyPendingDesignInterviewRequest(for: id) }
        }
        .onChange(of: model.site?.id) { _, _ in model.handleSiteChanged() }
        // `initial: true` covers the common case where the environment value is already set on
        // first render; the change handler covers SwiftUI delivering/replacing it later.
        .onChange(of: undoManager, initial: true) { _, newValue in
            model.windowUndoManager = newValue
        }
        .onChange(of: model.preview.state) { _, newState in
            model.previewStateChanged(newState)
        }
        .onChange(of: model.hasUnsavedEdits, initial: true) { _, hasUnsavedEdits in
            if hasUnsavedEdits {
                if unsavedEditsTerminationLease == nil {
                    unsavedEditsTerminationLease = SuddenTerminationController.shared.acquire()
                }
            } else {
                unsavedEditsTerminationLease?.release()
                unsavedEditsTerminationLease = nil
            }
        }
    }

    /// Publishes all `focusedSceneValue`s onto `content`. Factored out of `body` as its own
    /// function (rather than inlined into one long modifier chain) so the type checker solves it
    /// as an independent unit — `navigatorSelectionActions(for:)` pushed the combined `body`
    /// expression over Swift's type-check-in-reasonable-time budget once added inline (#516).
    ///
    /// One exception to "every focused value is published here": `siteSearchActions` is published
    /// by `SiteSearchFieldModifier` (`SiteSearchField.swift`, #520), because it hands out a
    /// closure over that modifier's own `@FocusState` — scene-local state this function has no
    /// access to. Look there too when auditing the full set.
    @ViewBuilder
    private func focusedValues<Content: View>(for content: Content) -> some View {
        content
            // `focusedSceneValue`, not `focusedValue`: keyboard focus often sits in an AppKit
            // responder (the WKWebView preview) where nothing in SwiftUI's focus system is
            // focused, so a plain focusedValue resolves to nil and File ▸ Export To ▸ Astro Website…
            // stays disabled even with the site window frontmost (same trap documented for
            // `\.preview` below).
            .focusedSceneValue(\.siteID, model.site?.id ?? siteID)
            .focusedSceneValue(\.newContentActions, model.site == nil ? nil : NewContentActions(
                newPage: { model.newPagePresented = true },
                newCollection: { model.newCollectionPresented = true },
                newPost: { model.newPostPresented = true },
                newComponent: { model.newComponentPresented = true }
            ))
            .focusedSceneValue(\.navigatorSelectionActions, navigatorSelectionActions(for: model))
            // `focusedSceneValue` (not `focusedValue`): publishes while this site window is the
            // active scene, regardless of where keyboard focus sits. The preview pane is a
            // WKWebView (an AppKit responder), so nothing in SwiftUI's focus system is focused and
            // a plain `focusedValue` would resolve to nil — leaving the preview navigation commands
            // (Reload, Back/Forward, zoom) perpetually disabled.
            .focusedSceneValue(\.preview, model.preview)
            // Publishes the whole window model so menu commands (File ▸ Save/Revert today, the
            // Site menu in #511) can reach the focused window's editing surfaces and site
            // operations.
            .focusedSceneValue(\.siteWindowModel, model)
            // Inspector visibility is scene state (@SceneStorage), so the View menu's Show/Hide
            // Inspector reaches it through its own focused value rather than the window model
            // (#512).
            .focusedSceneValue(\.inspectorPanel, InspectorPanelActions(
                isShown: inspectorShown && model.inspectorSelection != nil,
                isAvailable: model.inspectorSelection != nil,
                toggle: { inspectorShown.toggle() }
            ))
    }

    @ViewBuilder
    private func siteUI(for site: SiteStore.Site) -> some View {
        @Bindable var bindableModel = model

        // Shared with `SiteSearchFieldModifier` below (#1126): search-field activation is
        // another "substantial toolbar re-layout while the inspector is presented" trigger for
        // the same macOS 27 beta AppKit constraint-update storm as the pane-switch case, so it
        // needs the same presented-state read the `.inspector(isPresented:)` modifier itself
        // uses, not a copy that could drift out of sync.
        let inspectorPresented = Binding(
            get: { inspectorShown && model.inspectorSelection != nil },
            set: { newValue in
                // Only persist an explicit show/hide while there is something to inspect.
                // When the selection is nil the panel is auto-hidden; ignore that write so
                // it doesn't clobber the remembered preference (the bug: inspector never returns).
                if model.inspectorSelection != nil { inspectorShown = newValue }
            }
        )

        NavigationSplitView(columnVisibility: Binding(
            get: { sidebarVisible ? .all : .detailOnly },
            set: { sidebarVisible = ($0 != .detailOnly) }
        )) {
            if let navigator = model.navigator {
                SiteNavigatorView(
                    model: navigator,
                    onDeleteRequested: { item in
                        contentDeleteTitle = "Delete “\(item.title)”?"
                        model.deleteConfirmation = item
                    },
                    onDuplicateRequested: { item in
                        Task { await model.duplicate(id: item.id) }
                    },
                    onRepurposeRequested: { item in
                        Task { await model.presentRepurpose(postRowID: item.id) }
                    },
                    onPublishRequested: { item in
                        Task { await model.publish(id: item.id) }
                    },
                    onUnpublishRequested: { item in
                        Task { await model.unpublish(id: item.id) }
                    }
                )
                    .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 360)
                    .onChange(of: navigator.selection) { _, newID in
                        model.applyNavigatorSelection(newID)
                    }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } detail: {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    // Non-blocking conflict banner (#881): docked above the content, never a
                    // sheet/alert, so the site stays fully editable while it's showing.
                    if model.sync.bannerPresented {
                        SyncConflictBannerView(
                            fileCount: (model.sync.conflict?.conflictedPaths.count ?? 0) + model.sync.quarantinedFiles.count,
                            onResolve: { model.sync.openResolutionSheet() },
                            onDismiss: { model.sync.dismissBanner() }
                        )
                        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                    }
                    HStack(spacing: 0) {
                        mainPane(for: site)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        if model.chatPresented, let chat = model.chat {
                            Divider()
                            ChatView(model: chat, revealCitation: { path in model.revealCitationInGraph(path) })
                                .frame(width: 420)
                                .transition(reduceMotion
                                    ? .opacity
                                    : .move(edge: .trailing).combined(with: .opacity))
                        }
                        if model.relatedPagesPresented {
                            Divider()
                            RelatedPagesPanel(model: model.relatedPages)
                                .frame(width: 320)
                                .transition(reduceMotion
                                    ? .opacity
                                    : .move(edge: .trailing).combined(with: .opacity))
                        }
                    }
                    .animation(.easeInOut(duration: 0.18), value: model.chatPresented)
                    .animation(.easeInOut(duration: 0.18), value: model.relatedPagesPresented)
                }
                if model.deploy.drawerPresented {
                    DeployDrawerView(model: model.deploy, siteName: site.name)
                        .transition(reduceMotion
                            ? .opacity
                            : .move(edge: .bottom).combined(with: .opacity))
                        .shadow(radius: 8, y: -2)
                } else if model.backup.drawerPresented {
                    // Backup and deploy can't both run at once (each disables the other's
                    // button while running), but a stale completed-deploy drawer might still
                    // be on screen when a backup finishes. Deploy wins the z-order — its
                    // drawer carries the more critical "your deploy URL" payload.
                    BackupDrawerView(model: model.backup, siteName: site.name)
                        .transition(reduceMotion
                            ? .opacity
                            : .move(edge: .bottom).combined(with: .opacity))
                        .shadow(radius: 8, y: -2)
                }
            }
        }
        .animation(.easeInOut(duration: 0.18), value: model.deploy.drawerPresented)
        .animation(.easeInOut(duration: 0.18), value: model.backup.drawerPresented)
        .inspector(isPresented: inspectorPresented) {
            if let selection = model.inspectorSelection {
                SiteInspectorView(
                    selection: selection,
                    canvasWebView: componentCanvasWebView,
                    previewBaseURL: model.preview.readyURL
                )
                .inspectorColumnWidth(min: 260, ideal: 300, max: 420)
            }
        }
        .navigationTitle(site.name)
        .navigationSubtitle(model.preview.readyURL?.absoluteString ?? "")
        // Titlebar proxy icon (#521): ⌘-click shows the package's path, and the icon drags as the
        // `.anglesite` package itself. The window's security-scoped grant already covers the URL.
        .navigationDocument(site.packageURL)
        // Leading title, free center — the document-style layout (Pages/Freeform) that makes room
        // for the .principal pane switcher.
        .toolbarRole(.editor)
        // Customizable toolbar (#519): every item has a STABLE id — saved customizations key off
        // these strings, so renaming one silently discards users' layouts (the id set is frozen
        // by SiteToolbarItemIDTests in AnglesiteCoreTests). Items must also be
        // unconditional (no `if let` wrappers): identity-swapping or appearing/vanishing items
        // fight the customization palette, so state-dependent items render disabled instead.
        // Curated default ≈8 items; episodic setup/maintenance actions ship hidden and live in
        // the palette (View ▸ Customize Toolbar…, added in #510).
        .toolbar(id: "site") {
            // Fixed center, not movable/removable: the pane switcher is navigation, not a command
            // (Finder/Freeform convention). Replaces the old Picker row above the main pane.
            ToolbarItem(id: SiteToolbarItemID.panes.rawValue, placement: .principal) {
                Picker("View", selection: Binding(
                    get: { model.paneSelection },
                    set: { model.setPaneSelection($0) }
                )) {
                    Text("Preview").tag(0)
                    if model.activeEditorFile != nil { Text("Editor").tag(1) }
                    Text("Graph").tag(2)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .help("Switch between Preview, Editor, and Graph")
            }
            .customizationBehavior(.disabled)

            ToolbarItem(id: SiteToolbarItemID.graph.rawValue, placement: .primaryAction) {
                Button {
                    Task { await model.showGraph() }
                } label: {
                    Label("Site Graph", systemImage: "point.3.connected.trianglepath.dotted")
                }
                .help("Explore pages, layouts, components, collections, and assets")
            }

            // iCloud sync status (#881): renders nothing for a package that isn't in iCloud
            // Drive (`SyncStatusView` is an `EmptyView` when `!model.sync.isEligible`), so this
            // item never widens a local-only site's toolbar.
            ToolbarItem(id: SiteToolbarItemID.sync.rawValue, placement: .primaryAction) {
                SyncStatusView(model: model.sync)
            }

            ToolbarItem(id: SiteToolbarItemID.backup.rawValue, placement: .primaryAction) {
                Button {
                    model.backupSite()
                } label: {
                    Label("Backup", systemImage: "externaldrive.fill.badge.icloud")
                }
                .disabled(!model.canRunBackup)
                .help(site.isValid
                      ? "Commit and push working-tree changes to your current branch"
                      : "Site is missing required files")
            }

            ToolbarItem(id: SiteToolbarItemID.audit.rawValue, placement: .primaryAction) {
                Button {
                    model.auditSite()
                } label: {
                    if model.audit.isRunning {
                        Label("Auditing…", systemImage: "magnifyingglass")
                    } else {
                        Label("Audit", systemImage: "checkmark.shield.fill")
                    }
                }
                .disabled(!model.canRunAudit)
                .help(site.isValid && model.preview.canDeploy
                      ? "Run the structured accessibility audit against this site"
                      : site.isValid
                        ? "Open the preview first to start the runtime before auditing"
                        : "Site is missing required files")
            }

            ToolbarItem(id: SiteToolbarItemID.openInBrowser.rawValue, placement: .primaryAction) {
                Button {
                    model.openPreviewInBrowser()
                } label: {
                    Label("Open in browser", systemImage: "arrow.up.forward.app")
                }
                .disabled(!model.canOpenPreviewInBrowser)
                .help("Open the live preview in your default browser")
            }

            // — Palette-only items (View ▸ Customize Toolbar…) —

            ToolbarItem(id: SiteToolbarItemID.harden.rawValue, placement: .primaryAction) {
                Button {
                    model.harden.openSheet()
                } label: {
                    if model.harden.isRunning {
                        Label("Hardening…", systemImage: "shield.lefthalf.filled")
                    } else {
                        Label("Harden", systemImage: "shield.lefthalf.filled")
                    }
                }
                .disabled(!model.canRunHarden)
                .help(site.isValid
                      ? "Preview and apply Cloudflare security hardening for this site"
                      : "Site is missing required files")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.domainConfigAudit.rawValue, placement: .primaryAction) {
                Button {
                    model.domainConfigAudit.openSheet()
                } label: {
                    if model.domainConfigAudit.isRunning {
                        Label("Checking Domain Config…", systemImage: "arrow.triangle.2.circlepath")
                    } else {
                        Label("Domain Config", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                .disabled(!model.canRunDomainConfigAudit)
                .help(site.isValid
                      ? "Compare anglesite.json's declared domain/DNS/edge config against live Cloudflare state"
                      : "Site is missing required files")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.onionRouting.rawValue, placement: .primaryAction) {
                Button {
                    model.onionRouting.openSheet()
                } label: {
                    Label("Onion Routing", systemImage: "network")
                }
                .disabled(!model.canRunOnionRouting)
                .help(site.isValid
                      ? "Enable Tor Browser access for this site via Cloudflare's zone-level setting"
                      : "Site is missing required files")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.domain.rawValue, placement: .primaryAction) {
                Button {
                    model.domain.openSheet()
                } label: {
                    Label("Domain", systemImage: "globe")
                }
                .disabled(!model.canOpenDomain)
                .help("View and manage this domain's DNS records")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.integration.rawValue, placement: .primaryAction) {
                Button {
                    model.openIntegrationWizard()
                } label: {
                    Label("Add Integration…", systemImage: "puzzlepiece.extension")
                }
                .disabled(!model.canOpenIntegrationWizard)
                .help("Set up a third-party integration for this site")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.siriReadiness.rawValue, placement: .primaryAction) {
                Button {
                    model.openSiriReadiness()
                } label: {
                    Label("Siri AI Readiness", systemImage: "sparkles")
                }
                .disabled(!model.canOpenSiriReadiness)
                .help("Check whether Siri workflows are ready for this site")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.relatedPages.rawValue, placement: .primaryAction) {
                Button {
                    model.relatedPagesPresented.toggle()
                } label: {
                    Label("Related Pages", systemImage: model.relatedPagesPresented
                          ? "link.badge.plus" : "link")
                }
                .help(model.relatedPagesPresented ? "Hide related pages" : "Show related pages")
            }
            .defaultCustomization(.hidden)

            ToolbarItem(id: SiteToolbarItemID.styleGuide.rawValue, placement: .primaryAction) {
                Button {
                    model.openStyleGuide()
                } label: {
                    Label("Style Guide", systemImage: "textformat.abc")
                }
                .help("See and edit this site's learned writing, image, and naming conventions")
            }
            .defaultCustomization(.hidden)

            // One stable item whose label/action reflects publish state — two swapping items
            // would break saved customizations.
            ToolbarItem(id: SiteToolbarItemID.github.rawValue, placement: .primaryAction) {
                if let remote = model.publish.existingRemote {
                    Button {
                        NSWorkspace.shared.open(remote.url)
                    } label: {
                        Label("View on GitHub", systemImage: "arrow.up.forward.square")
                    }
                    .help("Open this site's GitHub repository")
                } else {
                    Button {
                        model.publish.publish(source: site.sourceDirectory, repoName: site.name)
                    } label: {
                        Label("Publish to GitHub", systemImage: "square.and.arrow.up.on.square")
                    }
                    .disabled(!model.canPublishToGitHub)
                    .help(site.isValid ? "Create a private GitHub repo and push this site" : "Site is missing required files")
                }
            }
            .defaultCustomization(.hidden)

            // — Default trailing cluster —

            // Health badge and Deploy are one item: the badge is the readiness signal for the
            // button it gates, so customization can never separate them.
            ToolbarItem(id: SiteToolbarItemID.deploy.rawValue, placement: .primaryAction) {
                HStack(spacing: 8) {
                    HealthBadgeView(
                        model: model.health,
                        onRecheck: { model.recheckHealth() },
                        onAskAssistant: {
                            guard let chat = model.chat else { return }
                            model.chatPresented = true
                            chat.send(SiteWindowModel.healthAssistantPrompt)
                        }
                    )
                    Button {
                        model.deploySite()
                    } label: {
                        Label("Deploy", systemImage: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canRunDeploy)
                    .help(site.isValid && model.preview.canDeploy
                          ? "Build, scan, and run wrangler deploy on this site"
                          : site.isValid
                            ? "Open the preview first to start the runtime before deploying"
                            : "Site is missing required files")
                }
            }
            .customizationBehavior(.reorderable)

            ToolbarItem(id: SiteToolbarItemID.chat.rawValue, placement: .primaryAction) {
                Button {
                    model.chatPresented.toggle()
                } label: {
                    Label("Chat", systemImage: model.chatPresented
                        ? "bubble.left.and.bubble.right.fill"
                        : "bubble.left.and.bubble.right")
                }
                .help(model.chatPresented ? "Hide chat panel" : "Show chat panel")
                // ⌘K moved to View ▸ Show/Hide Chat (#512) — a second registration here would
                // recreate the duplicate-shortcut ambiguity #509 removed for ⌘S.
            }

            // Far trailing, adjacent to the inspector panel it controls (Pages/Freeform convention).
            ToolbarItem(id: SiteToolbarItemID.inspector.rawValue, placement: .primaryAction) {
                Button {
                    inspectorShown.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.right")
                }
                .disabled(model.inspectorSelection == nil)
                .help("Show or hide the inspector")
            }
        }
        // Trailing search field (#520). Not a `.toolbar(id:)` item: `.searchable` mints its own
        // toolbar item id, so it stays out of the frozen `SiteToolbarItemID` set and out of
        // users' saved customizations.
        .modifier(SiteSearchFieldModifier(
            model: model.search,
            siteID: site.id,
            inspectorPresented: inspectorPresented,
            activate: { hit in model.openSearchHit(hit) }
        ))
        .sheet(isPresented: $bindableModel.deploy.blockedPresented) {
            if case .blocked(let failures, let warnings) = model.deploy.phase {
                BlockedDeploySheetView(failures: failures, warnings: warnings) {
                    model.deploy.dismissBlocked()
                }
            }
        }
        .sheet(isPresented: $bindableModel.deploy.tokenPromptPresented) {
            CloudflareTokenPromptView(model: model.deploy) {
                model.deploy.cancelTokenPrompt()
            }
        }
        .sheet(isPresented: $bindableModel.deploy.workerNameConflictPresented) {
            if case .workerNameConflict(let name) = model.deploy.phase {
                WorkerNameConflictSheetView(model: model.deploy, takenName: name) {
                    model.deploy.cancelWorkerNameConflictPrompt()
                }
            }
        }
        .sheet(isPresented: $bindableModel.deploy.domainConflictPresented) {
            if case .conflict(let hostname, let ownedBy) = model.deploy.domainAttachStatus {
                DomainConflictSheetView(hostname: hostname, ownedBy: ownedBy) {
                    model.deploy.dismissDomainConflict()
                }
            }
        }
        .sheet(isPresented: $bindableModel.deploy.webmentionPaidPlanConfirmationPresented) {
            WebmentionPaidPlanConfirmationSheetView(model: model.deploy) {
                model.deploy.cancelWebmentionPaidPlanConfirmation()
            }
        }
        .sheet(isPresented: $bindableModel.deploy.domainConfigDriftPresented) {
            if case .domainConfigDrift(let findings) = model.deploy.phase {
                DomainConfigDriftSheetView(
                    findings: findings,
                    onReview: {
                        model.deploy.dismissDomainConfigDrift()
                        model.domainConfigAudit.openSheet()
                    },
                    onDismiss: { model.deploy.dismissDomainConfigDrift() }
                )
            }
        }
        .sheet(isPresented: $bindableModel.audit.sheetPresented) {
            AuditSheetView(
                model: model.audit,
                siteName: site.name,
                onRunAgain: { model.auditSite() }
            )
        }
        .sheet(isPresented: $bindableModel.sync.resolutionSheetPresented) {
            SyncConflictResolutionSheetView(model: model.sync, siteName: site.name)
        }
        .sheet(isPresented: $bindableModel.domainConfigAudit.sheetPresented) {
            DomainConfigAuditSheetView(model: model.domainConfigAudit)
        }
        .sheet(isPresented: $bindableModel.harden.sheetPresented) {
            HardenSheetView(model: model.harden)
        }
        .sheet(isPresented: $bindableModel.onionRouting.sheetPresented) {
            OnionRoutingSheetView(model: model.onionRouting)
        }
        .sheet(isPresented: Binding(
            get: { bindableModel.styleGuide?.sheetPresented ?? false },
            set: { bindableModel.styleGuide?.sheetPresented = $0 }
        )) {
            if let styleGuide = model.styleGuide {
                ProjectStyleGuideView(model: styleGuide, siteName: site.name)
            }
        }
        .sheet(isPresented: $bindableModel.domain.sheetPresented) {
            DomainSheetView(model: model.domain)
        }
        .sheet(isPresented: $bindableModel.publish.sheetPresented) {
            PublishSheet(model: model.publish, siteName: site.name)
        }
        .sheet(isPresented: $bindableModel.publish.tokenPromptPresented) {
            GitHubTokenPromptView(model: model.publish) {
                model.publish.cancelTokenPrompt()
            }
        }
        .sheet(item: $bindableModel.siriReadinessModel) { readinessModel in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Siri AI readiness for “\(site.name)”.")
                            .font(.caption).foregroundStyle(.secondary)
                        SiriReadinessList(model: readinessModel)
                    }
                    .padding()
                }
                .frame(minWidth: 420, minHeight: 260)
                .navigationTitle("Siri AI Readiness")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { model.siriReadinessModel = nil }
                    }
                }
            }
        }
        .sheet(item: $bindableModel.dependencyUpdateModel) { updateModel in
            NavigationStack {
                List {
                    if !updateModel.offers.updates.isEmpty {
                        Section("Dependency Updates") {
                            ForEach(updateModel.offers.updates, id: \.name) { offer in
                                LabeledContent(offer.name) {
                                    Text("\(offer.currentRange) → \(offer.offeredRange)")
                                        .font(.system(.body, design: .monospaced))
                                }
                            }
                        }
                    }
                    if !updateModel.offers.additions.isEmpty {
                        Section("New Dependencies") {
                            ForEach(updateModel.offers.additions, id: \.name) { offer in
                                LabeledContent {
                                    Text(offer.offeredRange)
                                        .font(.system(.body, design: .monospaced))
                                } label: {
                                    Label(offer.name, systemImage: "plus.circle")
                                }
                            }
                        }
                    }
                }
                .navigationTitle("Dependency Updates Available")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Skip") { updateModel.skip() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Update") { updateModel.update() }
                    }
                }
            }
            .frame(minWidth: 420, minHeight: 260)
            // `loadAndStart()` suspends on a `CheckedContinuation` that only Skip/Update resume
            // (see `SiteWindowModel.loadAndStart`). Block outside-tap/swipe dismissal so those two
            // buttons are structurally the only way out — otherwise the continuation would leak
            // and `preview.open()` would never run.
            .interactiveDismissDisabled()
        }
        .sheet(item: $bindableModel.scriptSyncModel) { syncModel in
            NavigationStack {
                List(syncModel.pending) { divergence in
                    let copy = ScriptSyncModel.rowCopy(for: divergence.relativePath)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(copy.title)
                            .font(.headline)
                        Text(copy.consequence)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(divergence.relativePath)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.tertiary)
                        if syncModel.failedRelativePaths.contains(divergence.relativePath) {
                            Label("Couldn't update this file — see the debug log for details.", systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                        HStack {
                            Button("Keep My Version") { syncModel.keepMine(divergence) }
                            Spacer()
                            Button("Update This File") { syncModel.update(divergence) }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .navigationTitle("Site Scripts Customized")
            }
            .frame(minWidth: 420, minHeight: 260)
            // Mirrors the dependency-update sheet immediately above: `loadAndStart()` suspends on
            // a `CheckedContinuation` that only resumes once every row is resolved (see
            // `ScriptSyncModel.remove`/`SiteWindowModel.loadAndStart`). Block outside-tap/swipe
            // dismissal so per-row buttons are structurally the only way out.
            .interactiveDismissDisabled()
        }
        .sheet(item: $bindableModel.copyEditModel) { reportModel in
            CopyEditReportView(model: reportModel)
        }
        .sheet(item: $bindableModel.socialPlanModel) { planModel in
            SocialPlanView(model: planModel)
        }
        .sheet(item: $bindableModel.repurposeModel) { repurposeModel in
            RepurposeView(model: repurposeModel)
        }
        .sheet(item: $bindableModel.designInterviewModel) { interviewModel in
            NavigationStack {
                DesignInterviewPanel(model: interviewModel)
                    .navigationTitle("Design Interview")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { model.designInterviewModel = nil }
                        }
                    }
            }
            .frame(minWidth: 640, minHeight: 420)
        }
        .sheet(item: $bindableModel.integrationWizardModel) { wizardModel in
            NavigationStack {
                IntegrationWizard(model: wizardModel, onClose: { model.integrationWizardModel = nil })
                    .navigationTitle("Add Integration")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { model.integrationWizardModel = nil }
                        }
                    }
            }
        }
        .alert("Revert to the last saved version?", isPresented: $bindableModel.revertConfirmationPresented) {
            Button("Revert", role: .destructive) { Task { await model.confirmRevertToSaved() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Unsaved changes in the editor and inspector will be discarded.")
        }
        // The setter has NO side effect, and each button is solely responsible for clearing
        // `deleteConfirmation` — the same rule (and the same reason) as `MainPaneEditorView`'s
        // conflict alert. A clearing setter is what made every content delete a silent no-op
        // (#968/#969): SwiftUI runs it as the dialog dismisses, which lands *after* the Delete
        // button's synchronous action but *before* the `Task` it spawns gets to run, so
        // `confirmDelete()`'s `guard let item = deleteConfirmation` always saw nil and returned —
        // no delete, no commit, and no error to raise the alert below.
        .confirmationDialog(
            contentDeleteTitle,
            isPresented: Binding(
                get: { bindableModel.deleteConfirmation != nil },
                set: { _ in }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await model.confirmDelete() } }
            Button("Cancel", role: .cancel) { model.deleteConfirmation = nil }
        } message: {
            Text("This will remove the file from your site. You can bring it back with Edit ▸ Undo.")
        }
        .alert(
            "Couldn't complete that action",
            isPresented: Binding(
                get: { model.contentActionError != nil },
                set: { if !$0 { model.contentActionError = nil } }),
            presenting: model.contentActionError
        ) { _ in
            Button("OK", role: .cancel) { model.contentActionError = nil }
        } message: { msg in
            Text(msg)
        }
        .sheet(item: Binding(
            get: { model.pendingRedirectOfferRoute.map { IdentifiableRoute($0) } },
            set: { model.pendingRedirectOfferRoute = $0?.value }
        )) { route in
            if let navigator = model.navigator {
                AddRedirectSheet(source: route.value) { destination, code in
                    let saved = await navigator.saveRedirect(source: route.value, destination: destination, code: code)
                    return saved ? nil : navigator.redirectSaveError
                }
            }
        }
        .sheet(isPresented: $bindableModel.newPagePresented) {
            NewPageSheet(site: site) { title, route, template in
                await model.createPage(title: title, route: route, template: template)
            }
        }
        .sheet(isPresented: $bindableModel.newCollectionPresented) {
            NewCollectionEntrySheet(
                descriptors: contentTypeRegistry.all.filter { $0.collection != nil }
            ) { title, slug, descriptor, fieldValues in
                await model.createCollectionEntry(
                    title: title, slug: slug, descriptor: descriptor, fieldValues: fieldValues)
            }
        }
        .sheet(isPresented: $bindableModel.newPostPresented) {
            NewPostSheet { title in
                await model.createPost(title: title)
            }
        }
        .sheet(isPresented: $bindableModel.newComponentPresented) {
            NewComponentSheet { name in
                await model.createComponent(name: name)
            }
        }
        .sheet(isPresented: $bindableModel.animationsPresented) {
            AnimationsGalleryView()
        }
        .annotatedAsSite(site)
    }

    @ViewBuilder
    private func mainPane(for site: SiteStore.Site) -> some View {
        // The Preview/Editor/Graph switcher lives in the toolbar (`id: "panes"`, .principal) and
        // the View menu (⌘1–3) — no in-content picker row (#519).
        mainPaneContent(for: site)
    }

    @ViewBuilder
    private func mainPaneContent(for site: SiteStore.Site) -> some View {
        switch model.mainPaneMode {
        case .editor:
            if case .text(let editorModel) = model.activeEditor {
                let activationKey = ComponentEditorActivationKey(
                    baseURL: model.preview.readyURL?.absoluteString,
                    fileID: editorModel.file.id
                )
                MainPaneEditorView(
                    model: editorModel,
                    componentEditor: model.componentEditor,
                    onCanvasWebView: { componentCanvasWebView = $0 }
                )
                    // Re-fires on file change AND on the dev server becoming ready (nil→non-nil
                    // readyURL) — the same identity the old view-local LoadKey watched — so the
                    // hoisted model rebuilds exactly when the old @State model did. It ALSO
                    // restarts on every reappearance of this view (e.g. toggling Preview↔Editor
                    // back to the same component) even though `activationKey` didn't change —
                    // that's `.task(id:)`'s documented behavior, not a bug to work around here.
                    .task(id: activationKey) {
                        // Genuine key change (a new file, or the dev server just came up):
                        // any previously captured canvas webview belongs to the outgoing
                        // component — drop it until the new canvas reports in via
                        // `onCanvasWebView`, so the Style pane's ColorPicker scrub preview never
                        // pairs component B's model with component A's (possibly torn-down)
                        // webview during the rebuild (#714 review).
                        //
                        // A same-key re-appearance (the Preview↔Editor toggle case, #714 final
                        // review Important 1) must NOT clear it: `onCanvasWebView`/`makeNSView`
                        // reports the live webview synchronously during the render commit, which
                        // can land before this async task body even runs, and nil-ing it here
                        // unconditionally would then wipe out that just-reported webview and
                        // permanently break the scrub preview after every toggle.
                        if lastComponentActivationKey != activationKey {
                            componentCanvasWebView = nil
                        }
                        lastComponentActivationKey = activationKey
                        await model.ensureComponentEditorLoaded()
                    }
            } else if case .plist(let plistEditorModel) = model.activeEditor {
                PlistEditorView(model: plistEditorModel) { title in
                    Task { await model.saveWebsiteTitle(title) }
                }
            } else {
                previewPane(for: site)
            }
        case .graph:
            SiteGraphExplorerView(model: model.graphExplorer) { node in
                model.openGraphNode(node, site: site)
            }
        case .cleanup:
            ProjectCleanupView(
                cleanup: model.cleanup,
                onOpen: { model.openCleanupCandidate($0) },
                onDelete: { await model.deleteCleanupCandidate($0) }
            )
        case .reader:
            MicrosubReaderView(reader: model.reader)
        case .followers:
            FollowersView(followers: model.followers)
        case .communities:
            CommunitiesView(communities: model.communities)
        case .preview:
            previewPane(for: site)
        }
    }

    /// Task identity for component-editor activation — see the `.task` above.
    private struct ComponentEditorActivationKey: Hashable {
        let baseURL: String?
        let fileID: String
    }

    @ViewBuilder
    private func previewPane(for site: SiteStore.Site) -> some View {
        switch model.preview.state {
        case .ready(_, let url, _) where !model.startup.isShowingCompletionHold:
            PreviewView(
                url: model.preview.displayURL ?? url,
                router: model.preview.editRouter,
                annotationProvider: model.annotationProvider,
                onWebView: { [preview = model.preview] webView in preview.webView = webView },
                // Explicit detach: ARC zeroing the model's weak `webView` doesn't fire `didSet`,
                // so without this the Back/Forward menu enablement would freeze when the dev
                // server restarts or fails (see PreviewModel.detachWebView).
                onWebViewDismantled: { [preview = model.preview] webView in preview.detachWebView(webView) }
            )
        case .starting, .ready:
            // `.ready` reaches here only while `isShowingCompletionHold` is true (see the guarded
            // case above) — a brief window so the fully-filled phase progress strip is actually
            // visible before swapping to the live preview.
            centeredStatus {
                StartupProgressView(
                    title: model.preview.isUpdatingDependencies
                        ? "Updating dependencies — this may take a minute…"
                        : "Starting dev server for \(site.name)…",
                    model: model.startup,
                    // Deliberately ungated (unlike the ⌥⌘D menu item): the point of #560 is
                    // letting non-developers look under the hood while they wait.
                    onShowLogs: { openWindow(id: "debug") }
                )
            }
        case .failed(_, let message):
            centeredStatus {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.largeTitle).foregroundStyle(.orange)
                    Text("Can't preview \(site.name)").font(.headline)
                    Text(message)
                        .font(.callout).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).frame(maxWidth: 420)
                    // Only for the vmnet failures `VmnetFailureRecovery` recognizes — plain Retry
                    // alone would keep reusing the same wedged network object (#812).
                    if VmnetFailureRecovery.isRecoverable(failureMessage: message) {
                        Button("Restart Networking & Retry") {
                            model.restartNetworkingAndRetry()
                        }
                    }
                    Button("Retry") {
                        model.retryPreview()
                    }
                    // Same deliberately-ungated affordance as the .starting screen (#560/#562):
                    // the message above is a one-liner, but the *why* is in the subprocess log.
                    Button("Show Logs") { openWindow(id: "debug") }
                        .buttonStyle(.link)
                        .font(.callout)
                        .accessibilityHint("Opens the log of the failed dev server launch.")
                }
            }
        case .idle:
            if model.preview.devServerStoppedByUser {
                // Site ▸ Stop Dev Server (#515) parks the runtime at `.idle` on purpose — show a
                // real stopped state with a restart affordance, not the pre-boot spinner.
                centeredStatus {
                    VStack(spacing: 12) {
                        Image(systemName: "stop.circle")
                            .font(.largeTitle).foregroundStyle(.secondary)
                        Text("Dev server stopped").font(.headline)
                        Text("The preview is paused for \(site.name). Start the dev server to resume.")
                            .font(.callout).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center).frame(maxWidth: 420)
                        Button("Start Dev Server") {
                            model.startDevServer()
                        }
                    }
                }
            } else {
                centeredStatus { ProgressView() }
            }
        }
    }

    private func centeredStatus<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(NSColor.windowBackgroundColor))
    }

    /// Builds the Edit-menu Delete/Duplicate actions for the current Navigator selection, or nil
    /// when there's no site or no selection. `delete`/`duplicate` are individually nil when the
    /// selected row isn't a page/post (`canDelete`/`canDuplicate`), which is what disables the
    /// individual menu items rather than hiding the whole group.
    private func navigatorSelectionActions(for model: SiteWindowModel) -> NavigatorSelectionActions? {
        guard model.site != nil, let navigator = model.navigator, let id = navigator.selection else {
            return nil
        }
        let deleteAction: (() -> Void)?
        if navigator.canDelete(id) {
            deleteAction = {
                guard let item = navigator.item(for: id) else { return }
                contentDeleteTitle = "Delete “\(item.title)”?"
                model.deleteConfirmation = item
            }
        } else {
            deleteAction = nil
        }
        let duplicateAction: (() -> Void)?
        if navigator.canDuplicate(id) {
            duplicateAction = {
                Task { await model.duplicate(id: id) }
            }
        } else {
            duplicateAction = nil
        }
        let publishAction: (() -> Void)?
        if navigator.canPublish(id) {
            publishAction = {
                Task { await model.publish(id: id) }
            }
        } else {
            publishAction = nil
        }
        let unpublishAction: (() -> Void)?
        if navigator.canUnpublish(id) {
            unpublishAction = {
                Task { await model.unpublish(id: id) }
            }
        } else {
            unpublishAction = nil
        }
        return NavigatorSelectionActions(
            delete: deleteAction, duplicate: duplicateAction, publish: publishAction, unpublish: unpublishAction)
    }
}
