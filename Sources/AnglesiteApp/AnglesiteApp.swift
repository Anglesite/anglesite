import SwiftUI
import AppKit
import AnglesiteCore
import AnglesiteBridge
import AnglesiteIntents
import AnglesiteContainer

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Single shared `SiteContentGraph` for the app's lifetime. Passed into
    /// `AnglesiteIntents.bootstrap` so it can be registered with `AppDependencyManager`.
    let contentGraph = SiteContentGraph()
    /// Project-local retrieval index used by assistant tools for file-cited RAG context (#307).
    let knowledgeIndex = SiteKnowledgeIndex()
    /// On-device semantic ranker layered over `knowledgeIndex`, synced by the preview runtime so
    /// assistant retrieval ranks by meaning, not just keywords (#312). `nil` when no on-device
    /// embedding model is available — the whole chain takes `SemanticRanker?`, so retrieval then
    /// degrades to pure lexical (never the test-double fake, which would blend nonsense vectors).
    ///
    /// Populated asynchronously from `applicationDidFinishLaunching` because building the
    /// `NLContextualEmbedding` provider calls `model.load()` (hundreds of ms of asset/model init),
    /// which must not run on the main thread during launch. A site window opened in the brief
    /// pre-load window captures `nil` and stays lexical-only for that session (reopening picks up
    /// the ranker) — an acceptable degradation since the launcher is shown first.
    ///
    /// In-memory for v0: the per-site `Config/` embedding cache (`SemanticIndexCache`) and
    /// incremental `upsert`/`remove` re-embedding are built + tested but deliberately not wired
    /// yet — the shared app-global index architecture needs per-site cache routing the runtime
    /// can derive, which is a follow-up.
    var semanticRanker: SemanticRanker?

    /// Shared project-conventions index, learned from each open site's content and consumed by
    /// on-device generation (starting with alt text, #313). Mirrors `knowledgeIndex`'s lifecycle.
    let conventionsEngine = ProjectConventionsEngine(enrich: ProjectConventionsEnricherFactory.makeDefault())

    /// On-device embedding provider, best-first: the multilingual transformer
    /// (`NLContextualEmbedding`), then the lighter `NLEmbedding.sentenceEmbedding`, then `nil`
    /// (→ pure-lexical retrieval). Never the test-double fake. Runs the model load, so call it off
    /// the main thread.
    private static func makeEmbeddingProvider() -> (any EmbeddingProvider)? {
        if let contextual = NLContextualEmbeddingProvider() { return contextual }
        if let sentence = NLEmbeddingProvider() { return sentence }
        return nil
    }
    let contentIndexerStore = ContentIndexerStore()

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await AppleScriptCommandEnvironment.shared.configure(contentGraph: contentGraph) }

        // Register App Intents dependencies before the app surface comes up so backgrounded
        // intent processes (and #101's system MCP entry, later) can resolve immediately.
        // `bootstrap()` is async (it awaits the Spotlight handler installation on `SiteStore`);
        // we kick it off here without waiting — the launcher view's `task` modifier doesn't
        // block on it, and bootstrap's own defensive `load()` closes any race.
        Task { [contentGraph, contentIndexerStore] in
            // This Task inherits the @MainActor context, so the store write needs no extra hop.
            contentIndexerStore.indexer = await AnglesiteIntents.bootstrap(contentGraph: contentGraph)
        }

        // Build the on-device embedding provider off the main thread (model load is expensive),
        // then publish the ranker on the main actor for new site windows to capture.
        Task { [weak self] in
            let provider = await Task.detached(priority: .utility) { Self.makeEmbeddingProvider() }.value
            await MainActor.run { self?.semanticRanker = provider.map { SemanticRanker(provider: $0, cache: nil) } }
        }

        // Begin mirroring the site registry so the File ▸ Open Recent submenu is populated
        // and stays current. Idempotent; safe on the main actor.
        Task { @MainActor in RecentSitesModel.shared.start() }

        // Route notification-center activations (clicks on Deploy/Backup/Audit completion
        // notifications, #526) back to the matching site window. Delegate installation only —
        // authorization is requested lazily on the first posted notice, not at launch.
        CompletionNotifier.shared.install()

    }

    /// Dynamic Dock menu (#522): recent sites + New Site, mirroring File ▸ Open Recent. Recent
    /// sites open via `NSWorkspace.open` on the package URL — the same LaunchServices → `onOpenURL`
    /// path as a Finder double-click, so it works (and mints MAS bookmarks) regardless of which
    /// windows exist. AppKit calls this on the main thread, matching `RecentSitesModel`'s actor.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for site in RecentSitesModel.shared.sites {
            let item = NSMenuItem(title: site.name, action: #selector(openRecentSiteFromDock(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = site.packageURL
            item.isEnabled = site.isValid
            menu.addItem(item)
        }
        if !menu.items.isEmpty { menu.addItem(.separator()) }
        let newSite = NSMenuItem(title: String(localized: "New Site"), action: #selector(newSiteFromDock), keyEquivalent: "")
        newSite.target = self
        menu.addItem(newSite)
        return menu
    }

    @objc private func openRecentSiteFromDock(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        // "Logs are sacred": a declined open (e.g. the package moved since the last registry
        // revalidation) has no other UI feedback loop from a Dock menu — record it.
        if !NSWorkspace.shared.open(url) {
            Task {
                await LogCenter.shared.append(
                    source: "dock-menu", stream: .stderr,
                    text: "open \(url.lastPathComponent) failed: NSWorkspace declined the open"
                )
            }
        }
    }

    @objc private func newSiteFromDock() {
        NSApp.activate()
        // Surface the launcher (it hosts the wizard sheet), then request the wizard — the same
        // two-step used by File ▸ New ▸ Site (FocusedSite.swift).
        WindowRouter.shared.openSitesWindow?()
        WindowRouter.shared.requestNewSite()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task {
            await ProcessSupervisor.shared.shutdownAll(timeout: 5)
            await PausedContainerRegistry.shared.teardownAll()
            await MainActor.run { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }
}

@main
@MainActor
struct AnglesiteApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.openWindow) private var openWindow

    /// Live mirror of the site registry for the File ▸ Open Recent submenu. Held as `@State`
    /// so SwiftUI re-evaluates `.commands` when its `sites` change. Started in AppDelegate.
    @State private var recent = RecentSitesModel.shared

    /// Computed once at launch: Debug builds always show the Debug-pane menu item; Release builds
    /// only when the user opted in (Settings) or held ⌥ while launching. A settings change takes
    /// effect on the next launch — the menu bar is built once here.
    private let debugPaneMenuVisible: Bool

    init() {
        AppSettings.shared.removeLegacyChatBackendDefaultsIfNeeded()

        #if DEBUG
        let isDebugBuild = true
        #else
        let isDebugBuild = false
        #endif
        debugPaneMenuVisible = DebugPaneVisibility.menuItemVisible(
            isDebugBuild: isDebugBuild,
            settingEnabled: AppSettings.shared.debugPaneEnabled,
            optionHeldAtLaunch: NSEvent.modifierFlags.contains(.option)
        )
    }

    private func showAboutPanel() {
        // Credits carries the build info the standard fields don't: the dev phase and the
        // host OS. App name and version come from the bundle via .applicationName and the
        // default .applicationVersion (CFBundleShortVersionString) — passing "Phase X" there
        // would clobber the real version and render as "Version Phase X".
        let credits = NSAttributedString(
            string: "Phase \(BuildInfo.phase) · macOS \(ProcessInfo.processInfo.operatingSystemVersionString)",
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular),
                .foregroundColor: NSColor.secondaryLabelColor
            ]
        )
        NSApplication.shared.orderFrontStandardAboutPanel(options: [
            .applicationName: BuildInfo.appName,
            .credits: credits
        ])
    }

    var body: some Scene {
        // The launcher is the first scene so it's the default window at launch (used when
        // SwiftUI has nothing to restore). It autoopens the most-recently-used site from its
        // own .task — see SitesLauncherView.onFirstAppear().
        Window("Sites", id: "sites") {
            SitesWindowRoot(openWindow: openWindow)
                .onOpenURL { url in
                    // Guard on the extension only (zero I/O on the main thread); `record` reads and
                    // validates the marker and throws a legible error if it isn't a real package.
                    guard url.pathExtension == AnglesitePackage.packageExtension else { return }
                    Task { @MainActor in
                        do {
                            // Shared with launcher drag-drop and the Dock menu (#524/#522);
                            // includes the MAS bookmark mint.
                            let site = try await SiteActions.registerPackage(at: url)
                            openWindow(value: site.id)
                        } catch {
                            await LogCenter.shared.append(source: "open-url", stream: .stderr, text: "open \(url.lastPathComponent) failed: \(error.localizedDescription)")
                        }
                    }
                }
        }
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About Anglesite") { showAboutPanel() }
            }

            CommandGroup(before: .systemServices) {
                Divider()

                Button("Provide Anglesite Feedback…") {
                    NSWorkspace.shared.open(URL(string: "https://anglesite.dwk.io/feedback/")!)
                }

                Divider()

                // Opens the App Store analytics-consent pane when it exists (spec §2.1).
                PlannedItem("Privacy & Analytics…")
            }

            NewContentCommands()
            // Edit ▸ Delete ⌘⌫ / Duplicate ⌘D for the focused window's Navigator selection (#516).
            NavigatorEditCommands()
            // Edit-menu skeleton: selection walkers, annotations, Find ▸ (menu-bar spec §2.3).
            EditMenuSkeletonCommands()
            // Both groups anchor `before: .importExport`; later declarations insert ABOVE earlier
            // ones, so FileItemCommands is declared first to land BELOW SaveCommands, giving the
            // order Save · Duplicate · Rename… · Move To… · Revert To ▸ · Reveal in Finder · Share…
            // (FileItemCommands: Rename/Move To/Revert To/Reveal/Share, #513).
            FileItemCommands()
            // File ▸ Save ⌘S / Duplicate for the focused window's editors (#509; Revert To lives in FileItemCommands).
            SaveCommands()
            // Standard View-menu items: Show/Hide Sidebar ⌃⌘S and Customize Toolbar… (#510).
            // Customize Toolbar… stays inert until the toolbar adopts .toolbar(id:) — see #519.
            SidebarCommands()
            ToolbarCommands()
            CommandGroup(after: .newItem) {
                Menu("Open Recent") {
                    ForEach(recent.sites) { site in
                        Button(site.name) { openWindow(value: site.id) }
                            .disabled(!site.isValid)
                    }
                    if recent.sites.isEmpty {
                        Button("No Recent Sites") {}.disabled(true)
                    }
                }
                Divider()
                Button("Import Site…") {
                    Task { @MainActor in
                        do {
                            if let site = try await SiteActions.importPackage() {
                                openWindow(value: site.id)
                            }
                        } catch {
                            NSAlert(error: error).runModal()
                        }
                    }
                }
            }
            // Export is its own Commands type so @FocusedValue tracks scene focus (see ExportSiteCommands).
            ExportSiteCommands()
            // File ▸ Print… ⌘P for the previewed page — declared after ExportSiteCommands so it
            // renders below Export To… (`after:` groups render in declaration order, #525).
            PrintCommands()
            // Insert menu (menu-bar spec §2.4) — leftmost of the custom menus.
            InsertCommands()
            // Page menu (menu-bar spec §2.5) — CommandMenus render in declaration order:
            // Insert · Page · Format · Arrange · Website.
            PageCommands()
            // Format menu skeleton (menu-bar spec §2.6) — editor-gated.
            FormatCommands()
            // Arrange menu skeleton (menu-bar spec §2.7) — editor-gated, contextual.
            ArrangeCommands()
            // Website menu: the site window's operations, regrouped (menu-bar spec §2.9).
            WebsiteCommands()
            // View ▸ pane switching ⌘1–3 + panel toggles (Chat ⌘K, Related Pages, Inspector ⌥⌘I) —
            // declared before PreviewNavigationCommands so they sit above it (#512).
            // NOTE the anchor asymmetry (verified in the running app): `after:` groups render in
            // DECLARATION order (this one above Preview navigation/Debug Pane), while `before:`
            // groups render in REVERSE declaration order (see FileItemCommands/SaveCommands above).
            ViewMenuCommands()
            // Preview navigation — Reload ⌘R, Back/Forward, zoom (#514) — between the pane/panel
            // toggles above and the Debug Pane below (`after:` groups render in declaration order,
            // see the note above). "Show Web Inspector" used to live here too (#305) but was removed
            // in #1099: it only worked through private WebKit API that's compiled out in every build
            // once direct-download distribution was retired, leaving the command permanently dead.
            PreviewNavigationCommands()
            // Debug pane lives off the View menu — `⌥⌘D` keeps it discoverable without crowding
            // the primary commands. Hidden in Release unless explicitly enabled (see init()).
            CommandGroup(after: .toolbar) {
                if debugPaneMenuVisible {
                    Button("Show Debug Pane") {
                        openWindow(id: "debug")
                    }
                    .keyboardShortcut("d", modifiers: [.command, .option])
                }
            }

            CommandGroup(after: .help) {
                PlannedItem("What's New in Anglesite")

                Button("Anglesite Website") {
                    NSWorkspace.shared.open(URL(string: "https://anglesite.dwk.io/")!)
                }
            }
        }

        // Per-site windows, keyed by SiteStore.Site.id (a stable path-derived String).
        // Each window owns its own PreviewModel/DeployModel/ChatModel and dev-server lifetime.
        // SwiftUI dedupes openWindow(value:) calls, so opening the same site twice just
        // focuses the existing window.
        WindowGroup(for: String.self) { $siteID in
            // SiteWindow takes the optional directly so it can dismiss itself and
            // route to the launcher when restoration hands us a nil or unresolvable
            // id. If we short-circuit with `if let siteID` here the SiteWindow never
            // instantiates and an empty restored window strands the user.
            SiteWindow(
                siteID: siteID,
                contentGraph: appDelegate.contentGraph,
                knowledgeIndex: appDelegate.knowledgeIndex,
                semanticRanker: appDelegate.semanticRanker,
                conventionsEngine: appDelegate.conventionsEngine,
                runtimeFactory: LiveSiteRuntimeFactory(),
                contentIndexerStore: appDelegate.contentIndexerStore
            )
                .frame(minWidth: 960, minHeight: 600)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)

        Window("Anglesite Debug", id: "debug") {
            DebugPaneView()
        }
        .windowResizability(.contentSize)
        .defaultPosition(.bottomTrailing)
        .defaultSize(width: 900, height: 500)

        Settings {
            SettingsView()
        }
    }
}
