import Testing
import Foundation
import AnglesiteCore
@testable import AnglesiteAppCore

/// `PreviewModel`'s convenience init constructs its runtime eagerly via `makeRuntime` (not lazily
/// on `startDevServer()`), so this factory must hand back a real, safe-to-construct `SiteRuntime`
/// rather than fatal-erroring. `UnavailableSiteRuntime` is the same inert runtime
/// `LiveSiteRuntimeFactory` falls back to in production when no container runtime is available:
/// its `start()` just settles to `.failed` rather than spawning anything, so it stays inert for
/// every test in this file — none of them call `preview.startDevServer()`. If a future test needs
/// a working fake runtime, extend this rather than adding a second fake type.
struct NeverStartedSiteRuntimeFactory: SiteRuntimeFactory {
    func makeRuntime(
        contentGraph: SiteContentGraph?,
        knowledgeIndex: SiteKnowledgeIndex?,
        semanticRanker: SemanticRanker?,
        conventionsEngine: ProjectConventionsEngine?
    ) -> any SiteRuntime {
        UnavailableSiteRuntime(reason: "NeverStartedSiteRuntimeFactory should not be started in this test suite")
    }
}

/// Construction smoke test + `deleteCleanupCandidate` coverage for `SiteWindowModel` (issue
/// #555). `SiteWindowModel` is the mega-coordinator this whole cluster is trying to make
/// testable, so this file is deliberately narrow: it proves the model can be built with real
/// (if empty) dependencies, and that `deleteCleanupCandidate` runs its guard chain end-to-end
/// without needing a live preview/runtime.
@Suite("SiteWindowModel")
@MainActor
struct SiteWindowModelTests {
    private func makeModel(contentGraph: SiteContentGraph = SiteContentGraph()) -> SiteWindowModel {
        SiteWindowModel(
            contentGraph: contentGraph,
            knowledgeIndex: SiteKnowledgeIndex(),
            semanticRanker: nil,
            conventionsEngine: ProjectConventionsEngine(),
            runtimeFactory: NeverStartedSiteRuntimeFactory(),
            contentIndexerStore: ContentIndexerStore()
        )
    }

    @Test("constructs with all dependencies wired")
    func constructs() {
        let model = makeModel()
        #expect(model.site == nil)
        #expect(model.paneSelection == 0)
    }

    @Test("close retains its sudden-termination lease until a dirty editor is saved")
    func closeRetainsLeaseUntilEditorSaveFinishes() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("site-window-close-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let fileURL = root.appendingPathComponent("page.astro")
        try Data("original".utf8).write(to: fileURL)
        let editor = FileEditorModel(
            file: FileRef(url: fileURL, group: .pages, name: "page.astro")
        )
        await editor.load()
        editor.text = "saved during close"

        let model = makeModel()
        model.activeEditor = .text(editor)
        let controller = SuddenTerminationController(disable: {}, enable: {})
        let lease = controller.acquire()

        model.close(suddenTerminationLease: lease)
        while controller.activeLeaseCount > 0 {
            await Task.yield()
        }

        let saved = try String(contentsOf: fileURL, encoding: .utf8)
        #expect(saved == "saved during close")
        #expect(controller.activeLeaseCount == 0)
    }
}

extension SiteWindowModelTests {
    @Test("deleteCleanupCandidate no-ops safely when there is no open site")
    func deleteCleanupCandidateNoSiteIsNoOp() async {
        let model = makeModel()
        // model.site is nil (no loadAndStart() ran) — deleteCleanupCandidate's first guard
        // (`guard let site else { return }`, SiteWindowModel.swift:643) must return immediately
        // without touching activeEditor/inspectorContext/cleanup.
        let candidate = DeadAssetScanner.CleanupCandidate(
            id: "public/images/ghost.png", path: "public/images/ghost.png",
            kind: .image, lastModified: Date(timeIntervalSince1970: 0), referenceCount: 0
        )

        await model.deleteCleanupCandidate(candidate)

        #expect(model.activeEditor == nil)
        #expect(model.cleanup.candidates.isEmpty)
        #expect(model.cleanup.deleteError == nil)
    }

    @Test("deleteCleanupCandidate refuses a candidate not in the live cleanup list, even with a real site set")
    func deleteCleanupCandidateRefusesUnknownCandidate() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("site-window-model-\(UUID().uuidString)")
        let sourceDirectory = root.appendingPathComponent("Test.anglesite/Source")
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: root.appendingPathComponent("Test.anglesite"),
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        // `deleteCleanupCandidate` never calls `cleanup.configure` itself — that only happens in
        // `loadAndStart()` (SiteWindowModel.swift:841), which this test does not run. Without it,
        // `cleanup.sourceDirectory` stays nil and `ProjectCleanupModel.delete`'s *first* guard
        // (`guard let sourceDirectory, !isBusy else { return false }`, ProjectCleanupModel.swift:96)
        // would short-circuit before ever reaching the stale-candidate check this test targets —
        // exactly the trap Task 4's fix-cycle flagged. Configure it directly so execution reaches
        // the second guard.
        model.cleanup.configure(site: CurrentSite(id: "site-a", packageURL: sourceDirectory, sourceDirectory: sourceDirectory))
        let candidate = DeadAssetScanner.CleanupCandidate(
            id: "public/images/ghost.png", path: "public/images/ghost.png",
            kind: .image, lastModified: Date(timeIntervalSince1970: 0), referenceCount: 0
        )

        // model.cleanup.candidates is still empty (no scan() ran) — cleanup.delete's own
        // stale-candidate guard (Task 4) refuses, so this exercises the two guards composing
        // correctly end-to-end through SiteWindowModel rather than ProjectCleanupModel alone.
        await model.deleteCleanupCandidate(candidate)

        #expect(model.cleanup.deleteError?.contains("no longer in the Cleanup list") == true)
    }
}

extension SiteWindowModelTests {
    @Test("createPost no-ops safely when there is no open site")
    func createPostNoSiteReturnsSiteNotFound() async {
        let model = makeModel()
        let result = await model.createPost(title: "Hello")
        #expect(result == .siteNotFound)
    }

    @Test("createComponent no-ops safely when there is no open site")
    func createComponentNoSiteReturnsSiteNotFound() async {
        let model = makeModel()
        let result = await model.createComponent(name: "Widget")
        #expect(result == .siteNotFound)
    }

    @Test("duplicateComponent no-ops safely when there is no open site")
    func duplicateComponentNoSiteReturnsSiteNotFound() async {
        let model = makeModel()
        let result = await model.duplicateComponent(relativePath: "src/components/Card.astro")
        #expect(result == .siteNotFound)
    }

    @Test("confirmDelete clears deleteConfirmation and no-ops when there is no open site")
    func confirmDeleteNoSiteIsNoOp() async {
        let model = makeModel()
        model.deleteConfirmation = NavigatorItem(id: "site-1:page:/about", title: "About", target: .route("/about"))

        await model.confirmDelete()

        #expect(model.deleteConfirmation == nil)
    }

    @Test("duplicate no-ops safely when there is no open site")
    func duplicateNoSiteIsNoOp() async {
        let model = makeModel()
        await model.duplicate(id: "site-1:page:/about")
        // No crash, no error surfaced — there's nothing to duplicate without an open site.
        #expect(model.contentActionError == nil)
    }

    /// `confirmDelete`'s post branch now resolves `deletedRoute` via `postRoute(for:)` (#584)
    /// instead of leaving it `nil` — this exercises that the lookup + route derivation for a real,
    /// graph-registered post runs cleanly (finds the post, computes its route, proceeds to the
    /// delete call) rather than crashing or mis-typing. It stops short of proving the route reaches
    /// `pendingRedirectOfferRoute`, because that only happens on a real `.deleted` result, and
    /// `ContentCreationWorkflow.native`'s `siteDirectory` resolver is hardwired to `SiteStore.shared`
    /// (`SiteWindowModel.swift`'s `contentCreation` init) — a real process-wide singleton that
    /// persists to the developer's actual `recents.json`. There's no test seam to redirect it to a
    /// throwaway location, and registering a fake site into the real one would risk corrupting real
    /// user data. That's a pre-existing gap shared with the page case (#530 never had this coverage
    /// either), not one #584 introduces; `postRoute(for:)` itself is covered in `NavigatorTreeTests`,
    /// and the full end-to-end behavior is left to manual GUI verification (#586).
    @Test("confirmDelete resolves a registered post's route without crashing, even though delete itself can't succeed here")
    func confirmDeletePostRouteResolvesCleanly() async {
        let graph = SiteContentGraph()
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: URL(fileURLWithPath: "/tmp/nonexistent.anglesite"),
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let post = SiteContentGraph.Post(
            id: "site-a:post:hello-world", siteID: "site-a", collection: "blog", slug: "hello-world",
            title: "Hello World", draft: false, publishDate: nil, tags: [],
            filePath: "src/content/blog/hello-world.md", lastModified: Date()
        )
        await graph.upsertPost(post)
        model.deleteConfirmation = NavigatorItem(id: post.id, title: "Hello World", target: .route(postRoute(for: post)))

        await model.confirmDelete()

        #expect(model.deleteConfirmation == nil)
        // `SiteStore.shared` doesn't know "site-a" — `deleteContent` resolves `.siteNotFound`, so no
        // redirect offer (correctly: nothing was actually deleted) and `contentActionError` reports
        // it (#987 — this used to be a silent no-op here too).
        #expect(model.pendingRedirectOfferRoute == nil)
        #expect(model.contentActionError == "This site is no longer available.")
    }

    // MARK: - ⌘Z for structural content operations (#675)
    //
    // The one-shot post-delete "Undo" alert (#586) was retired here in favour of the window
    // `UndoManager`, so its `pendingDeleteUndo`/`dismissDeleteUndo` tests are replaced by the
    // coverage below. The same seam limit called out on `confirmDeletePostRouteResolvesCleanly`
    // applies: `ContentCreationWorkflow.native`'s resolver is hardwired to `SiteStore.shared`, so
    // no test here can drive a *successful* delete or restore. What is reachable — and what these
    // cover — is the guard/rollback wiring around them; the write paths themselves are covered by
    // `ContentUndoCoordinatorTests` and `NativeContentOperationsTests`.

    @Test("applyContentUndo reports failure rather than crashing when there is no open site")
    func applyContentUndoNoSiteFails() async {
        let model = makeModel()

        let outcome = await model.applyContentUndo(ContentUndoCoordinator.Mutation(
            relativePath: "src/pages/about.astro", before: "restored", after: nil,
            actionName: "Delete \u{201C}About\u{201D}"))

        // `.failed` (not a silent `.applied`) is what makes the coordinator re-arm the record, so
        // a ⌘Z fired at a window whose site went away stays retryable instead of being consumed.
        #expect(outcome == .failed)
        #expect(model.contentActionError == nil)
    }

    @Test("handleSiteChanged drops pending content-undo records")
    func siteChangeInvalidatesContentUndo() {
        let model = makeModel()
        let undoManager = UndoManager()
        undoManager.groupsByEvent = false
        model.windowUndoManager = undoManager
        model.contentUndoCoordinator.register(ContentUndoCoordinator.Mutation(
            relativePath: "src/pages/about.astro", before: "old", after: "new",
            actionName: "Rename"))
        #expect(undoManager.canUndo)

        model.handleSiteChanged()

        // Records are site-relative paths plus captured contents — applying one after a site
        // replay would write the old site's bytes into the new site.
        #expect(!undoManager.canUndo)
    }

    @Test("a failed delete reopens the editor it closed")
    func failedDeleteReopensEditor() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("site-window-undo-\(UUID().uuidString)")
        let sourceDirectory = root.appendingPathComponent("Test.anglesite/Source/src/pages")
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fileURL = sourceDirectory.appendingPathComponent("about.astro")
        try Data("<h1>About</h1>".utf8).write(to: fileURL)

        let graph = SiteContentGraph()
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: root.appendingPathComponent("Test.anglesite"),
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let page = SiteContentGraph.Page(
            id: "site-a:page:/about", siteID: "site-a", route: "/about",
            filePath: "src/pages/about.astro", title: "About", lastModified: Date())
        await graph.upsertPage(page)

        let editor = FileEditorModel(file: FileRef(url: fileURL, group: .pages, name: "about.astro"))
        model.activeEditor = .text(editor)
        model.mainPaneMode = .editor(editor.file)
        model.deleteConfirmation = NavigatorItem(id: page.id, title: "About", target: .route("/about"))

        await model.confirmDelete()

        // `SiteStore.shared` doesn't know "site-a", so the delete resolves `.siteNotFound` and
        // never touches the file. The editor was closed *before* the delete call (so a suspended
        // flush couldn't resurrect the file), which means the model owes it back — leaving the
        // user on Preview with their buffer discarded for a delete that didn't happen would be a
        // silent data loss.
        #expect(model.activeEditor != nil)
        #expect(model.mainPaneMode == .editor(editor.file))
        #expect(FileManager.default.fileExists(atPath: fileURL.path))
        #expect(model.contentActionError == "This site is no longer available.")
    }
}

extension SiteWindowModelTests {
    // MARK: - #987: content-action failure paths must surface `contentActionError`
    //
    // Distinct from the "no open site" no-op already covered above (`duplicateNoSiteIsNoOp`,
    // `applyContentUndoNoSiteFails`) — that one stays a silent no-op by design (nothing to act
    // on). These cover the two classes #987 flagged as actually reachable: a Navigator row that
    // outlived its `SiteContentGraph` entry, and `contentCreation`'s own `.siteNotFound` (the
    // site left `SiteStore.shared` mid-session).

    private func makeUnregisteredSite() -> SiteStore.Site {
        SiteStore.Site(
            id: "site-a", name: "Test", packageURL: URL(fileURLWithPath: "/tmp/nonexistent.anglesite"),
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
    }

    @Test("duplicate reports an error when the row has no matching page or post")
    func duplicateUnresolvedRowReportsError() async {
        let model = makeModel()
        model.site = makeUnregisteredSite()

        await model.duplicate(id: "site-a:page:/ghost")

        #expect(model.contentActionError == "This item is no longer part of this site's content.")
    }

    @Test("publish reports an error when the row has no matching post")
    func publishUnresolvedRowReportsError() async {
        let model = makeModel()
        model.site = makeUnregisteredSite()

        await model.publish(id: "site-a:post:ghost")

        #expect(model.contentActionError == "This item is no longer part of this site's content.")
    }

    @Test("unpublish reports an error when the row has no matching post")
    func unpublishUnresolvedRowReportsError() async {
        let model = makeModel()
        model.site = makeUnregisteredSite()

        await model.unpublish(id: "site-a:post:ghost")

        #expect(model.contentActionError == "This item is no longer part of this site's content.")
    }

    @Test("duplicate reports an error when contentCreation resolves .siteNotFound")
    func duplicateSiteNotFoundReportsError() async {
        let graph = SiteContentGraph()
        let model = makeModel(contentGraph: graph)
        model.site = makeUnregisteredSite()
        let page = SiteContentGraph.Page(
            id: "site-a:page:/about", siteID: "site-a", route: "/about",
            filePath: "src/pages/about.astro", title: "About", lastModified: Date())
        await graph.upsertPage(page)

        await model.duplicate(id: page.id)

        // `SiteStore.shared` doesn't know "site-a" — `duplicatePage` resolves `.siteNotFound`.
        #expect(model.contentActionError == "This site is no longer available.")
    }

    @Test("publish reports an error when contentCreation resolves .siteNotFound")
    func publishSiteNotFoundReportsError() async {
        let graph = SiteContentGraph()
        let model = makeModel(contentGraph: graph)
        model.site = makeUnregisteredSite()
        let post = SiteContentGraph.Post(
            id: "site-a:post:hello-world", siteID: "site-a", collection: "blog", slug: "hello-world",
            title: "Hello World", draft: true, publishDate: nil, tags: [],
            filePath: "src/content/blog/hello-world.md", lastModified: Date()
        )
        await graph.upsertPost(post)

        await model.publish(id: post.id)

        #expect(model.contentActionError == "This site is no longer available.")
    }

    @Test("unpublish reports an error when contentCreation resolves .siteNotFound")
    func unpublishSiteNotFoundReportsError() async {
        let graph = SiteContentGraph()
        let model = makeModel(contentGraph: graph)
        model.site = makeUnregisteredSite()
        let post = SiteContentGraph.Post(
            id: "site-a:post:hello-world", siteID: "site-a", collection: "blog", slug: "hello-world",
            title: "Hello World", draft: false, publishDate: nil, tags: [],
            filePath: "src/content/blog/hello-world.md", lastModified: Date()
        )
        await graph.upsertPost(post)

        await model.unpublish(id: post.id)

        #expect(model.contentActionError == "This site is no longer available.")
    }

    @Test("applyContentUndo's delete branch reports an error when contentCreation resolves .siteNotFound")
    func applyContentUndoDeleteBranchSiteNotFoundReportsError() async {
        let model = makeModel()
        model.site = makeUnregisteredSite()

        let outcome = await model.applyContentUndo(ContentUndoCoordinator.Mutation(
            relativePath: "src/pages/about.astro", before: nil, after: "<h1>About</h1>",
            actionName: "Create \u{201C}About\u{201D}"))

        #expect(outcome == .failed)
        #expect(model.contentActionError == "This site is no longer available.")
    }

    @Test("applyContentUndo's restore branch reports an error when contentCreation resolves .siteNotFound")
    func applyContentUndoRestoreBranchSiteNotFoundReportsError() async {
        let model = makeModel()
        model.site = makeUnregisteredSite()

        let outcome = await model.applyContentUndo(ContentUndoCoordinator.Mutation(
            relativePath: "src/pages/about.astro", before: "<h1>About</h1>", after: nil,
            actionName: "Delete \u{201C}About\u{201D}"))

        #expect(outcome == .failed)
        #expect(model.contentActionError == "This site is no longer available.")
    }
}

extension SiteWindowModelTests {
    @Test("revealCitationInGraph returns true and switches to the graph pane for a matching path")
    func revealCitationInGraphMatches() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let contentGraph = SiteContentGraph()
        await contentGraph.load(
            siteID: "site-1",
            pages: [SiteContentGraph.Page(
                id: "site-1:page:/about", siteID: "site-1", route: "/about",
                filePath: "src/pages/about.astro", title: "About", lastModified: Date()
            )],
            posts: [], images: []
        )
        let model = makeModel(contentGraph: contentGraph)
        model.graphExplorer.start(site: CurrentSite(id: "site-1", packageURL: root, sourceDirectory: root))
        while model.graphExplorer.snapshot.nodes.isEmpty { await Task.yield() }

        let handled = model.revealCitationInGraph("src/pages/about.astro")

        #expect(handled)
        while model.mainPaneMode != .graph { await Task.yield() }
        #expect(model.graphExplorer.selectedNodeID == model.graphExplorer.snapshot.nodes.first?.id)
    }

    @Test("revealCitationInGraph returns false and does not switch panes for an unknown path")
    func revealCitationInGraphNoMatch() {
        let model = makeModel()

        let handled = model.revealCitationInGraph("src/pages/unknown.astro")

        #expect(!handled)
        #expect(model.mainPaneMode == .preview)
    }

    /// Review finding: `revealCitationInGraph`'s deferred `Task` used to call `revealNode`
    /// unconditionally, even when `showGraph()` aborted (e.g. an unresolved external-file
    /// conflict), mutating `graphExplorer`'s selection/search state while the user was still
    /// looking at the editor's conflict dialog. `showGraph()` now reports whether it actually
    /// switched, and `revealCitationInGraph` only reveals the node when it did.
    @Test("revealCitationInGraph doesn't touch graph state when showGraph aborts on an editor conflict")
    func revealCitationInGraphSkipsRevealWhenShowGraphAborts() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let contentGraph = SiteContentGraph()
        await contentGraph.load(
            siteID: "site-1",
            pages: [SiteContentGraph.Page(
                id: "site-1:page:/about", siteID: "site-1", route: "/about",
                filePath: "src/pages/about.astro", title: "About", lastModified: Date()
            )],
            posts: [], images: []
        )
        let model = makeModel(contentGraph: contentGraph)
        model.graphExplorer.start(site: CurrentSite(id: "site-1", packageURL: root, sourceDirectory: root))
        while model.graphExplorer.snapshot.nodes.isEmpty { await Task.yield() }

        // A dirty editor whose file changed externally under it — `flushBeforeLeaving()`'s real
        // conflict path (same technique as `EditableFileSessionTests`'s `writeExternally`).
        let editedFile = root.appendingPathComponent("conflict.txt")
        try Data("original".utf8).write(to: editedFile)
        let fileRef = FileRef(url: editedFile, group: .components, name: "conflict.txt")
        let editorModel = FileEditorModel(file: fileRef)
        await editorModel.load()
        editorModel.text = "dirty edit"
        try Data("changed on disk".utf8).write(to: editedFile)
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(2)], ofItemAtPath: editedFile.path
        )
        model.mainPaneMode = .editor(fileRef)
        model.activeEditor = .text(editorModel)

        let handled = model.revealCitationInGraph("src/pages/about.astro")
        #expect(handled)

        // Bounded poll (not unbounded) for the conflict to surface — the signal that
        // `showGraph()`'s deferred Task has finished running and aborted.
        var iterations = 0
        while editorModel.conflictDiskContents == nil, iterations < 10_000 {
            await Task.yield()
            iterations += 1
        }
        guard editorModel.conflictDiskContents != nil else {
            Issue.record("flushBeforeLeaving never surfaced the external conflict")
            return
        }

        #expect(model.mainPaneMode == .editor(fileRef))
        #expect(model.graphExplorer.selectedNodeID == nil)
    }
}

extension SiteWindowModelTests {
    private func siteWithNonexistentPackage(id: String = "site-a") -> SiteStore.Site {
        SiteStore.Site(
            id: id, name: "Test",
            packageURL: URL(fileURLWithPath: "/tmp/site-window-model-\(UUID().uuidString).anglesite"),
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
    }

    @Test("presentDesignInterview builds a fresh model from the open site, defaulting business type to empty when the site has no .site-config")
    func presentDesignInterviewBuildsModel() {
        let model = makeModel()
        model.site = siteWithNonexistentPackage()

        model.presentDesignInterview()

        #expect(model.designInterviewModel != nil)
        #expect(model.designInterviewModel?.draft.businessType == "")
    }

    @Test("presentDesignInterview no-ops when there is no open site")
    func presentDesignInterviewNoSiteIsNoOp() {
        let model = makeModel()

        model.presentDesignInterview()

        #expect(model.designInterviewModel == nil)
    }

    @Test("presentDesignInterview doesn't replace an already-presented model")
    func presentDesignInterviewDoesNotReplaceExisting() {
        let model = makeModel()
        model.site = siteWithNonexistentPackage()
        model.presentDesignInterview()
        let first = model.designInterviewModel

        model.presentDesignInterview()

        #expect(model.designInterviewModel === first)
    }

    @Test("applyPendingDesignInterviewRequest presents the sheet when a request is pending for this site")
    func applyPendingDesignInterviewRequestConsumesPendingRequest() {
        let model = makeModel()
        model.site = siteWithNonexistentPackage()
        model.router.requestDesignInterview(siteID: "site-a")

        model.applyPendingDesignInterviewRequest(for: "site-a")

        #expect(model.designInterviewModel != nil)
    }

    @Test("applyPendingDesignInterviewRequest no-ops when nothing is pending for this site")
    func applyPendingDesignInterviewRequestNoPendingRequestIsNoOp() {
        let model = makeModel()
        model.site = siteWithNonexistentPackage()
        _ = model.router.consumeDesignInterviewRequest(for: "site-a")   // defensive: clear any stale request

        model.applyPendingDesignInterviewRequest(for: "site-a")

        #expect(model.designInterviewModel == nil)
    }

    /// #660: `loadAndStart` should warm the content graph at site-open rather than leaving
    /// `isPopulated` false until the first create/delete. This exercises the scan-and-load step
    /// directly (bypassing `loadAndStart`'s `SiteStore.shared` dependency, same seam gap noted
    /// throughout this file) against a real temp source directory.
    @Test("refreshContentGraph scans a real source directory and marks the site's content graph populated")
    func refreshContentGraphPopulatesFromSourceDirectory() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("site-window-model-\(UUID().uuidString)")
        let pagesDir = root.appendingPathComponent("src/pages")
        try FileManager.default.createDirectory(at: pagesDir, withIntermediateDirectories: true)
        try Data().write(to: pagesDir.appendingPathComponent("about.astro"))
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        let model = makeModel(contentGraph: graph)
        #expect(await graph.isPopulated(siteID: "site-a") == false)

        await model.refreshContentGraph(siteID: "site-a", sourceDirectory: root)

        #expect(await graph.isPopulated(siteID: "site-a") == true)
        let pages = await graph.pages(for: "site-a")
        #expect(pages.map(\.route) == ["/about"])
    }
}

extension SiteWindowModelTests {
    /// #714 slice 1, Task 3 review finding: `applyNavigatorSelection`'s two new cases
    /// (`.websiteSettings`, `.directory`) had zero coverage. Both tests below drive a real
    /// `SiteNavigatorModel` built from `buildSiteURLTree` (not a hand-rolled `NavigatorItem` stub),
    /// so `navigator.target(for:)` resolves through the same code path the live sidebar uses —
    /// and each asserts the target really is `.websiteSettings`/`.directory` before exercising the
    /// selection, so a future change to the tree builder can't silently turn these into a no-op.
    private func makeSitePackage(named name: String = "Test") throws -> (root: URL, packageURL: URL, package: AnglesitePackage) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("site-window-model-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let packageURL = root.appendingPathComponent("\(name).anglesite", isDirectory: true)
        let (package, _) = try AnglesitePackage.createSkeleton(at: packageURL, displayName: name)
        return (root, packageURL, package)
    }

    @Test("applyNavigatorSelection opens the package Info.plist for .websiteSettings, same as the old Metadata row")
    func applyNavigatorSelectionWebsiteSettingsOpensInfoPlist() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a",
            pages: [SiteContentGraph.Page(
                id: "site-a:page:/about", siteID: "site-a", route: "/about",
                filePath: "src/pages/about.astro", title: "About", lastModified: Date()
            )],
            posts: [], images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL), websiteTitle: "Test")
        while navModel.nodes.isEmpty { await Task.yield() }
        #expect(navModel.target(for: "website") == .websiteSettings)
        model.navigator = navModel

        model.applyNavigatorSelection("website")

        // `applyNavigatorSelection` calls `openFile`, which sets `activeEditor`/`mainPaneMode` from
        // inside its own `Task { ... }` after awaiting `leaveCurrentEditor`/`leaveCurrentInspector` —
        // both no-ops here, but still real suspension points, so poll rather than assert inline.
        while model.activeEditor == nil { await Task.yield() }
        guard case .plist(let plistModel) = model.activeEditor else {
            Issue.record("expected the Info.plist to open as a .plist editor")
            return
        }
        #expect(plistModel.file.url == package.infoPlistURL)
        #expect(plistModel.file.group == .metadata)
        #expect(model.mainPaneMode == .editor(plistModel.file))
        #expect(model.inspectorContext == nil)
    }

    @Test("applyNavigatorSelection navigates the preview to a directory's route for .directory, clearing any open editor/inspector")
    func applyNavigatorSelectionDirectoryNavigatesPreview() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a", pages: [],
            posts: [SiteContentGraph.Post(
                id: "site-a:post:hello", siteID: "site-a", collection: "notes", slug: "hello",
                title: "Hello", draft: false, publishDate: nil, tags: [],
                filePath: "src/content/notes/hello.md", lastModified: Date()
            )],
            images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        // Seed a real open editor + inspector first, so the post-selection assertions prove
        // `.directory` actually clears them rather than trivially finding them already nil.
        let priorFile = FileRef(url: root.appendingPathComponent("dummy.astro"), group: .components, name: "dummy.astro")
        model.activeEditor = .text(FileEditorModel(file: priorFile))
        model.mainPaneMode = .editor(priorFile)
        model.inspectorContext = .page(PageMetadataModel(file: priorFile, route: "/dummy/", sourceDirectory: package.sourceURL))

        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL), websiteTitle: "Test")
        while navModel.nodes.count < 2 { await Task.yield() }
        let directoryID = "dir:/notes/"
        #expect(navModel.target(for: directoryID) == .directory(collection: "notes", route: "/notes/"))
        model.navigator = navModel

        // #714 final review, Important 3: `applyNavigatorSelection`'s `.directory` branch only
        // assigns `collectionInspection` once `navigator.selection` still matches the requested
        // id when its awaits resolve — the same liveness check `SiteNavigatorView`'s List binding
        // (which writes `selection`) and `SiteWindow`'s `.onChange(of: navigator.selection)`
        // (which then calls `applyNavigatorSelection`) provide together in production. Set it
        // first here to mirror that real sequencing.
        navModel.selection = directoryID
        model.applyNavigatorSelection(directoryID)

        // `.directory`'s body runs inside its own `Task { ... }`, same reasoning as the
        // `.websiteSettings` test above — poll for the final state rather than asserting inline.
        while model.mainPaneMode != .preview { await Task.yield() }
        #expect(model.activeEditor == nil)
        #expect(model.inspectorContext == nil)
        #expect(model.preview.activeRoute == "/notes/")

        // #714 slice 3: a directory selection populates the collection context.
        while model.collectionInspection == nil { await Task.yield() }
        let inspection = try #require(model.collectionInspection)
        #expect(inspection.collection == "notes")
        #expect(inspection.route == "/notes/")
        #expect(inspection.entryCount == 1)
        #expect(inspection.contentTypeName
            == ContentTypeRegistry.default.descriptor(forCollection: "notes")?.displayName)
    }

    @Test("the collection context carries probed feed routes, and a route selection clears it")
    func collectionInspectionFeedsAndClearing() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a",
            pages: [SiteContentGraph.Page(
                id: "site-a:page:/about", siteID: "site-a", route: "/about",
                filePath: "src/pages/about.md", title: "About", lastModified: Date()
            )],
            posts: [SiteContentGraph.Post(
                id: "site-a:post:hello", siteID: "site-a", collection: "notes", slug: "hello",
                title: "Hello", draft: false, publishDate: nil, tags: [],
                filePath: "src/content/notes/hello.md", lastModified: Date()
            )],
            images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        // Materialize two of the three feed route modules the probe looks for.
        let notesPages = package.sourceURL.appendingPathComponent("src/pages/notes")
        try FileManager.default.createDirectory(at: notesPages, withIntermediateDirectories: true)
        try Data().write(to: notesPages.appendingPathComponent("rss.xml.ts"))
        try Data().write(to: notesPages.appendingPathComponent("atom.xml.ts"))

        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(
            site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL),
            websiteTitle: "Test")
        while navModel.nodes.isEmpty { await Task.yield() }
        model.navigator = navModel
        let dirID = try #require(navModel.nodes.first(where: {
            if case .directory = $0.kind { return true } else { return false }
        })?.id)

        navModel.selection = dirID
        model.applyNavigatorSelection(dirID)
        while model.collectionInspection == nil { await Task.yield() }
        #expect(model.collectionInspection?.feeds.map(\.kind) == [.rss, .atom])

        // Selecting a routed page again clears the collection context. The `.route` branch also
        // guards its `collectionInspection = nil` on `navigator.selection` still matching the
        // request (#714 final review, Important 3 follow-up), so this must be set here too, same
        // as the directory selection above.
        navModel.selection = "site-a:page:/about"
        model.applyNavigatorSelection("site-a:page:/about")
        while model.collectionInspection != nil { await Task.yield() }
        #expect(model.collectionInspection == nil)
    }

    @Test("a stale .directory selection task never clobbers a newer selection's collection context (#714 final review, Important 3)")
    func applyNavigatorSelectionDirectoryStaleTaskDoesNotClobberNewerSelection() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a", pages: [],
            posts: [SiteContentGraph.Post(
                id: "site-a:post:hello", siteID: "site-a", collection: "notes", slug: "hello",
                title: "Hello", draft: false, publishDate: nil, tags: [],
                filePath: "src/content/notes/hello.md", lastModified: Date()
            )],
            images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(
            site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL),
            websiteTitle: "Test")
        while navModel.nodes.count < 2 { await Task.yield() }
        let directoryID = "dir:/notes/"
        #expect(navModel.target(for: directoryID) == .directory(collection: "notes", route: "/notes/"))
        model.navigator = navModel

        // `makeCollectionInspection` (invoked by the `.directory` Task below) awaits the
        // content-graph actor and a detached feed probe for a real collection like "notes" — real
        // suspension points. Simulate a faster subsequent selection landing in that window by
        // moving `navigator.selection` away *before yielding at all*: exactly what
        // `SiteWindow`'s `.onChange(of: navigator.selection)` does the instant a newer row is
        // clicked, and this synchronous call returns before the `.directory` Task's body has run
        // at all (it's merely enqueued), so there is no timing race to get wrong here.
        model.applyNavigatorSelection(directoryID)
        navModel.selection = "site-a:post:hello"

        // Give the stale task's awaits every chance to resolve and (pre-fix) assign anyway.
        for _ in 0..<2_000 { await Task.yield() }

        // Pre-fix, the `.directory` Task unconditionally assigned `collectionInspection` once its
        // awaits resolved, regardless of whether the selection had since moved on — and
        // `.collection` outranks `.page` in `inspectorSelection`, so it would have silently
        // shadowed whatever the newer selection put in the inspector. The fix bails unless
        // `navigator.selection` still matches the request, so this must stay nil.
        #expect(model.collectionInspection == nil)
    }

    @Test("a stale .route selection task never installs a stale page context over a newer selection (#714 final review, Important 3 follow-up)")
    func applyNavigatorSelectionRouteStaleTaskDoesNotClobberNewerSelection() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a",
            pages: [SiteContentGraph.Page(
                id: "site-a:page:/about", siteID: "site-a", route: "/about",
                filePath: "src/pages/about.md", title: "About", lastModified: Date()
            )],
            posts: [SiteContentGraph.Post(
                id: "site-a:post:hello", siteID: "site-a", collection: "notes", slug: "hello",
                title: "Hello", draft: false, publishDate: nil, tags: [],
                filePath: "src/content/notes/hello.md", lastModified: Date()
            )],
            images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(
            site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL),
            websiteTitle: "Test")
        while navModel.nodes.count < 2 { await Task.yield() }
        let routeID = "site-a:page:/about"
        let directoryID = "dir:/notes/"
        #expect(navModel.target(for: routeID) == .route("/about"))
        #expect(navModel.target(for: directoryID) == .directory(collection: "notes", route: "/notes/"))
        model.navigator = navModel

        // Select route A first — its Task awaits `leaveCurrentEditor`/`leaveCurrentInspector` and
        // then the content-graph actor inside `makeInspectorContext`, real suspension points — then
        // move `navigator.selection` to the directory *before yielding at all*: this synchronous
        // call returns before the `.route` Task's body has run at all (it's merely enqueued), so
        // there is no timing race to get wrong here, mirroring the `.directory` stale-task test
        // above (this is the reverse case — the `.route` branch's own `collectionInspection = nil`
        // is the unguarded mirror of that bug).
        navModel.selection = routeID
        model.applyNavigatorSelection(routeID)
        navModel.selection = directoryID

        // Give the stale task's awaits every chance to resolve and (pre-fix) assign anyway.
        for _ in 0..<2_000 { await Task.yield() }

        // Pre-fix, the `.route` Task unconditionally installed `inspectorContext` once its awaits
        // resolved, regardless of whether the selection had since moved on to a directory — this
        // fixture's `/about` page has frontmatter, so it would have become a live `.page` context.
        // The fix bails unless `navigator.selection` still matches the request, so the stale page
        // context must never install.
        #expect(model.inspectorContext == nil)
    }

    @Test("the collection context for a plain nested-page folder (no collection) counts child pages, not graph posts")
    func collectionInspectionPlainFolderHasNoCollectionOrFeeds() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a",
            pages: [
                SiteContentGraph.Page(
                    id: "site-a:page:/blog", siteID: "site-a", route: "/blog",
                    filePath: "src/pages/blog/index.astro", title: "Blog", lastModified: Date()
                ),
                SiteContentGraph.Page(
                    id: "site-a:page:/blog/hello", siteID: "site-a", route: "/blog/hello",
                    filePath: "src/pages/blog/hello.astro", title: "Hello", lastModified: Date()
                ),
            ],
            posts: [], images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )

        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(
            site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL),
            websiteTitle: "Test")
        while navModel.nodes.isEmpty { await Task.yield() }
        model.navigator = navModel
        let dirID = "dir:/blog/"
        #expect(navModel.target(for: dirID) == .directory(collection: nil, route: "/blog/"))
        let expectedEntryCount = navModel.node(for: dirID)?.children?.count ?? 0

        navModel.selection = dirID
        model.applyNavigatorSelection(dirID)
        while model.collectionInspection == nil { await Task.yield() }
        let inspection = try #require(model.collectionInspection)
        #expect(inspection.collection == nil)
        #expect(inspection.feeds.isEmpty)
        #expect(inspection.contentTypeName == nil)
        #expect(inspection.microformat == nil)
        #expect(inspection.entryCount == expectedEntryCount)
    }

    @Test("applyNavigatorSelection populates a read-only inspector for a plain .astro page (#1100)")
    func applyNavigatorSelectionPlainAstroPageGetsGenericInspector() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        // Most of a real site's pages are plain .astro (only the "about" singleton and content
        // collection entries get a typed/markdown editor) — Home is the common case that made the
        // View ▸ Inspector ▸ Show Inspector command look permanently disabled (#1100).
        let graph = SiteContentGraph()
        await graph.load(
            siteID: "site-a",
            pages: [SiteContentGraph.Page(
                id: "site-a:page:/", siteID: "site-a", route: "/",
                filePath: "src/pages/index.astro", title: "Home", lastModified: Date()
            )],
            posts: [], images: []
        )
        let model = makeModel(contentGraph: graph)
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let navModel = SiteNavigatorModel(graph: graph)
        navModel.start(site: CurrentSite(id: "site-a", packageURL: packageURL, sourceDirectory: package.sourceURL), websiteTitle: "Test")
        while navModel.nodes.isEmpty { await Task.yield() }
        model.navigator = navModel

        navModel.selection = "site-a:page:/"
        model.applyNavigatorSelection("site-a:page:/")

        while model.inspectorContext == nil { await Task.yield() }
        guard case .generic(let generic) = model.inspectorContext else {
            Issue.record("expected a .generic read-only inspector context for a plain .astro page")
            return
        }
        #expect(generic.route == "/")
        #expect(generic.file.url == package.sourceURL.appendingPathComponent("src/pages/index.astro"))
        #expect(generic.isDirty == false)
    }
}

extension SiteWindowModelTests {
    /// Review finding (#714 slice 1, Task 4): `presentCleanup()` — the Site ▸ Cleanup… entry
    /// point that replaced the old sidebar Cleanup row — had zero coverage. Mirrors `showGraph()`'s
    /// leave-current-surface-first guard, so these tests follow the same conventions as the
    /// `.websiteSettings`/`.directory` `applyNavigatorSelection` tests above (real package fixture,
    /// poll for the async `Task { ... }` body to land) and the `revealCitationInGraph` conflict test
    /// (real dirty-editor-with-external-change fixture to prove the guard actually aborts).
    @Test("presentCleanup switches the main pane to Cleanup, clearing any open editor/inspector")
    func presentCleanupSwitchesPane() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        // Seed a real open editor + inspector first, so the post-call assertions prove
        // `presentCleanup()` actually clears them rather than trivially finding them already nil
        // (same anti-tautology technique as `applyNavigatorSelectionDirectoryNavigatesPreview`).
        let priorFile = FileRef(url: root.appendingPathComponent("dummy.astro"), group: .components, name: "dummy.astro")
        model.activeEditor = .text(FileEditorModel(file: priorFile))
        model.mainPaneMode = .editor(priorFile)
        model.inspectorContext = .page(PageMetadataModel(file: priorFile, route: "/dummy/", sourceDirectory: package.sourceURL))

        model.presentCleanup()

        // `presentCleanup()`'s body runs inside its own `Task { ... }` after awaiting
        // `leaveCurrentEditor()`/`leaveCurrentInspector()` — both no-ops here, but still real
        // suspension points, so poll rather than assert inline (same pattern as
        // `applyNavigatorSelection`'s `.websiteSettings`/`.directory` tests).
        while model.mainPaneMode != .cleanup { await Task.yield() }
        #expect(model.activeEditor == nil)
        #expect(model.inspectorContext == nil)
        // PR #723 review: paneSelection previously fell through to 0 (Preview) for `.cleanup`,
        // so the toolbar pane Picker (tags 0/1/2 only) and the View-menu Preview/Editor/Graph
        // Toggles all misread Cleanup as Preview being selected — silently breaking ⌘1 from the
        // Cleanup pane (its Toggle read as already-on, so toggling it off was a no-op). 3 is
        // deliberately out of the Picker's/Toggles' 0–2 range so nothing shows selected instead.
        #expect(model.paneSelection == 3)
    }

    /// Mirrors `revealCitationInGraphSkipsRevealWhenShowGraphAborts`'s real external-conflict
    /// fixture: a dirty editor whose file changed on disk under it makes `flushBeforeLeaving()`
    /// (invoked via `leaveCurrentEditor()`) return `false`, so `presentCleanup()`'s guard should
    /// abort before touching `mainPaneMode`/`activeEditor`.
    @Test("presentCleanup doesn't switch panes when leaveCurrentEditor aborts on an editor conflict")
    func presentCleanupAbortsOnEditorConflict() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let model = makeModel()
        let editedFile = root.appendingPathComponent("conflict.txt")
        try Data("original".utf8).write(to: editedFile)
        let fileRef = FileRef(url: editedFile, group: .components, name: "conflict.txt")
        let editorModel = FileEditorModel(file: fileRef)
        await editorModel.load()
        editorModel.text = "dirty edit"
        try Data("changed on disk".utf8).write(to: editedFile)
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(2)], ofItemAtPath: editedFile.path
        )
        model.mainPaneMode = .editor(fileRef)
        model.activeEditor = .text(editorModel)

        model.presentCleanup()

        // Bounded poll for the conflict to surface — the signal that `presentCleanup()`'s
        // deferred Task has finished running and aborted (same bounded-poll reasoning as
        // `revealCitationInGraphSkipsRevealWhenShowGraphAborts`, since on the abort path there's
        // no discriminating state change other than the editor's own conflict flag to poll on).
        var iterations = 0
        while editorModel.conflictDiskContents == nil, iterations < 10_000 {
            await Task.yield()
            iterations += 1
        }
        guard editorModel.conflictDiskContents != nil else {
            Issue.record("flushBeforeLeaving never surfaced the external conflict")
            return
        }

        #expect(model.mainPaneMode == .editor(fileRef))
        #expect(model.activeEditor != nil)
    }

    /// Mirrors `presentCleanupSwitchesPane` for `presentReader()` (V-4.3, #365) — same
    /// leave-current-surface-first guard, same out-of-range `paneSelection` reasoning.
    @Test("presentReader switches the main pane to Reader, clearing any open editor/inspector")
    func presentReaderSwitchesPane() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }

        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let priorFile = FileRef(url: root.appendingPathComponent("dummy.astro"), group: .components, name: "dummy.astro")
        model.activeEditor = .text(FileEditorModel(file: priorFile))
        model.mainPaneMode = .editor(priorFile)
        model.inspectorContext = .page(PageMetadataModel(file: priorFile, route: "/dummy/", sourceDirectory: package.sourceURL))

        model.presentReader()

        while model.mainPaneMode != .reader { await Task.yield() }
        #expect(model.activeEditor == nil)
        #expect(model.inspectorContext == nil)
        // Same "out of the Picker's 0–2 range" reasoning as Cleanup's 3 (#723) — Reader has no
        // toolbar/View-menu segment of its own either.
        #expect(model.paneSelection == 4)
    }

    /// Mirrors `presentCleanupAbortsOnEditorConflict` for `presentReader()`.
    @Test("presentReader doesn't switch panes when leaveCurrentEditor aborts on an editor conflict")
    func presentReaderAbortsOnEditorConflict() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let model = makeModel()
        let editedFile = root.appendingPathComponent("conflict.txt")
        try Data("original".utf8).write(to: editedFile)
        let fileRef = FileRef(url: editedFile, group: .components, name: "conflict.txt")
        let editorModel = FileEditorModel(file: fileRef)
        await editorModel.load()
        editorModel.text = "dirty edit"
        try Data("changed on disk".utf8).write(to: editedFile)
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(2)], ofItemAtPath: editedFile.path
        )
        model.mainPaneMode = .editor(fileRef)
        model.activeEditor = .text(editorModel)

        model.presentReader()

        var iterations = 0
        while editorModel.conflictDiskContents == nil, iterations < 10_000 {
            await Task.yield()
            iterations += 1
        }
        guard editorModel.conflictDiskContents != nil else {
            Issue.record("flushBeforeLeaving never surfaced the external conflict")
            return
        }

        #expect(model.mainPaneMode == .editor(fileRef))
        #expect(model.activeEditor != nil)
    }

    @Test("ensureComponentEditorLoaded creates the hoisted editor for a component file, and rebuilds for a different file")
    func ensureComponentEditorLifecycle() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)

        await model.ensureComponentEditorLoaded()
        let first = try #require(model.componentEditor)
        #expect(first.file.id == card.id)

        // A same-file, same-baseURL repeat call is deliberately not asserted as idempotent here:
        // this harness has no live MCP client, so `load()` never succeeds and `first` is never
        // healthy — see `ensureComponentEditorLoadedRebuildsAfterUnhealthyLoad` below, which
        // exercises exactly that "unhealthy → rebuild" behavior instead (#714 final review,
        // Important 2).

        let badge = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Badge.astro"),
            group: .components, name: "Badge.astro")
        model.activeEditor = .text(FileEditorModel(file: badge))
        model.mainPaneMode = .editor(badge)
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor !== first)
        #expect(model.componentEditor?.file.id == badge.id)
    }

    @Test("ensureComponentEditorLoaded rebuilds after an unhealthy load instead of wedging the same broken instance forever")
    func ensureComponentEditorLoadedRebuildsAfterUnhealthyLoad() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)

        await model.ensureComponentEditorLoaded()
        let first = try #require(model.componentEditor)
        // No dev server is live in this test harness (`NeverStartedSiteRuntimeFactory` never
        // starts a real runtime), but its `UnavailableSiteRuntime.mcpClient` is still a real,
        // non-nil (just never-`start()`ed) `MCPClient` — so the fetch doesn't fail with
        // `ComponentModelClient.ModelError.notConnected`, it fails when that client's own
        // `callTool` throws `MCPError.notInitialized`, which isn't a `ComponentModelClient
        // .ModelError` at all and so lands in `load()`'s generic `catch` as `.other`. Confirm
        // that's really what happened — and that it left the model unhealthy — before relying on
        // it to exercise the guard below, rather than assuming.
        #expect(first.loadErrorReason == .other)
        #expect(first.loadError != nil)
        #expect(first.model == nil)

        // Same file, same (nil) baseURL — the pre-fix early return kept `first` forever purely on
        // that identity match, regardless of whether its load actually succeeded (#714 final
        // review, Important 2 — a `CancellationError` from a pane toggle mid-load lands in the
        // exact same generic `catch` as `.other`, so this failure mode is a faithful stand-in for
        // that one too). The fix only takes the early return when the existing model is healthy,
        // so this unhealthy `first` must be rebuilt, not returned again.
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor !== first)
        #expect(model.componentEditor?.file.id == card.id)
    }

    @Test("ensureComponentEditorLoaded clears the hoisted editor for a non-component file")
    func ensureComponentEditorClearsForNonComponent() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor != nil)

        let style = FileRef(
            url: package.sourceURL.appendingPathComponent("src/styles/global.css"),
            group: .styles, name: "global.css")
        model.activeEditor = .text(FileEditorModel(file: style))
        model.mainPaneMode = .editor(style)
        await model.ensureComponentEditorLoaded()
        #expect(model.componentEditor == nil)
    }

    @Test("inspectorSelection surfaces the component editor only while its file is the open editor pane")
    func inspectorSelectionComponentGating() async throws {
        let (root, packageURL, package) = try makeSitePackage()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = makeModel()
        model.site = SiteStore.Site(
            id: "site-a", name: "Test", packageURL: packageURL,
            isValid: true, missingSentinels: [], lastSeen: Date(), bookmarkData: nil
        )
        let card = FileRef(
            url: package.sourceURL.appendingPathComponent("src/components/Card.astro"),
            group: .components, name: "Card.astro")
        model.activeEditor = .text(FileEditorModel(file: card))
        model.mainPaneMode = .editor(card)
        await model.ensureComponentEditorLoaded()

        guard case .component = model.inspectorSelection else {
            Issue.record("expected .component while the component file is the open editor")
            return
        }
        // The model survives the Preview toggle (same lifetime as the editor buffer) but stops
        // surfacing as the inspector's subject.
        model.mainPaneMode = .preview
        #expect(model.componentEditor != nil)
        #expect(model.inspectorSelection == nil)
    }
}
