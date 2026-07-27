import Foundation
import Observation
import AnglesiteCore

/// Drives the Site Navigator sidebar for one window: the visitor-facing URL tree (#714). Reads
/// pages/posts from the shared `SiteContentGraph` and the feed-collection probe from
/// `SiteFileTree`, then builds the tree via `buildSiteURLTree`. Refreshes when the content graph
/// emits for this site. App glue only — all logic under test lives in AnglesiteCore.
@MainActor
@Observable
final class SiteNavigatorModel {
    private(set) var nodes: [URLTreeNode] = []
    /// Flattened id → node lookup, rebuilt with `nodes` (selection, targets, titles).
    private var nodesByID: [String: URLTreeNode] = [:]
    /// Route → node id for the rows actually on screen, rebuilt with `nodes`. Lets site search
    /// (#520) resolve a hit's computed route to a real sidebar row — and only to a row that
    /// exists, since `ContentRouteResolver`'s route is a convention-based guess.
    private(set) var routeIDs: [String: String] = [:]
    var selection: String?

    // Inline re-titling (Finder-style). `editingItemID` non-nil → that row shows a TextField.
    var editingItemID: String?
    var draftTitle: String = ""
    var renameError: String?
    /// Error surface for `saveRedirect` (#530) — distinct from `renameError` since it's a
    /// different action, not a rename failure.
    var redirectSaveError: String?

    private var sourceDirectory: URL?
    private var websiteTitle: String?
    private var siteID: String?
    private var siteRoot: URL?
    private let renameService = NavigatorRenameService()
    /// Set by `SiteWindowModel` when it builds this model: hands a completed rename to the
    /// window's `ContentUndoCoordinator` so ⌘Z reverses it (#675). Rename is the one structural
    /// operation `SiteWindowModel` doesn't own, so it comes back out through this hook instead of
    /// this model holding a coordinator of its own. `nil` in tests/previews — rename still works,
    /// it just isn't undoable.
    var registerUndo: ((ContentUndoCoordinator.Mutation) -> Void)?
    /// Post ids seen in the last `refresh()`, so `canRepurpose` can distinguish post rows from
    /// page rows without an extra actor hop — both are `.route` targets and `isContentRow` alone
    /// can't tell them apart (Task 16, #465).
    private var postIDs: Set<String> = []
    /// Full post records from the last `refresh()`, so `canPublish`/`canUnpublish` (#798) can read
    /// a row's collection and current draft state without an extra actor hop.
    private var postsByID: [String: SiteContentGraph.Post] = [:]
    private let contentTypeRegistry = ContentTypeRegistry()

    private let graph: SiteContentGraph
    private var observeTask: Task<Void, Never>?

    init(graph: SiteContentGraph) {
        self.graph = graph
    }

    func start(site: CurrentSite, websiteTitle: String) {
        let siteID = site.id
        let siteRoot = site.packageURL
        self.sourceDirectory = site.sourceDirectory
        self.websiteTitle = websiteTitle
        self.siteID = siteID
        self.siteRoot = siteRoot
        // Cancel any prior observer (window reuse: SwiftUI can replay a different site into the
        // same window) BEFORE starting the new one, so a stale refresh can't overwrite the new
        // site's tree. The initial load runs as the new task's first step, so it is tracked
        // and cancellable too. `[weak self]` so the long-lived stream loop doesn't retain the model.
        observeTask?.cancel()
        observeTask = Task { [weak self, graph, siteID, siteRoot] in
            // Subscribe BEFORE the initial refresh so a mutation that lands between the snapshot and
            // the subscription isn't missed — the stream buffers it until the loop drains it.
            let stream = await graph.changeStream()
            await self?.refresh(siteID: siteID, siteRoot: siteRoot)
            for await changedSiteID in stream {
                if Task.isCancelled { break }
                if changedSiteID == siteID { await self?.refresh(siteID: siteID, siteRoot: siteRoot) }
            }
        }
    }

    func stop() {
        observeTask?.cancel()
        observeTask = nil
    }

    /// Forces an immediate re-scan using the already-stored `siteID`/`siteRoot` from the last
    /// `start(...)`, without touching the observe-task subscription. Used after a mutation this
    /// model has no other way to learn about — e.g. a Cleanup delete, which doesn't touch
    /// `SiteContentGraph` for component/layout candidates, so nothing would otherwise trigger a
    /// refresh and a deleted file would stay selectable/openable (and, if edited and saved,
    /// resurrect the file via a raw non-git write).
    func refreshNow() async {
        guard let siteID, let siteRoot else { return }
        await refresh(siteID: siteID, siteRoot: siteRoot)
    }

    func target(for id: String) -> NavigatorTarget? { nodesByID[id]?.target }

    /// Bridge for callbacks that still traffic in `NavigatorItem` (delete/duplicate/repurpose
    /// plumbing in SiteWindow/SiteWindowModel predates the tree).
    func item(for id: String) -> NavigatorItem? {
        guard let node = nodesByID[id] else { return nil }
        return NavigatorItem(id: node.id, title: node.title, target: node.target)
    }

    func updateWebsiteTitle(_ title: String) {
        websiteTitle = title
        guard let first = nodes.first, first.kind == .website else { return }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let updated = URLTreeNode(id: first.id, title: trimmed.isEmpty ? "Website" : trimmed,
                                  route: first.route, kind: .website, children: nil)
        nodes[0] = updated
        nodesByID[updated.id] = updated
    }

    /// A row is renamable/deletable/duplicable iff it is a page or post (route target) — directory
    /// and website-settings rows are out of scope. The astro-without-title case is caught at
    /// commit, not pre-disabled (pre-checking would read every page file per refresh).
    private func isContentRow(_ id: String) -> Bool {
        guard let target = target(for: id) else { return false }
        if case .route = target { return true }
        return false
    }

    func canRename(_ id: String) -> Bool { isContentRow(id) }

    /// Delete/Duplicate (#516) share Rename's gating exactly — pages and posts only.
    func canDelete(_ id: String) -> Bool { isContentRow(id) }
    func canDuplicate(_ id: String) -> Bool { isContentRow(id) }

    /// Repurpose (#465, Task 16) is post-only — unlike Rename/Delete/Duplicate, which apply to
    /// pages too — so it checks `postIDs` rather than the page-or-post `isContentRow`.
    func canRepurpose(_ id: String) -> Bool { postIDs.contains(id) }

    /// Publish/Unpublish (#798) apply only to registry-backed typed post-family entries that
    /// actually declare a `draft` field — `blog` posts have no `ContentTypeDescriptor` at all, and
    /// business types (event/review/announcement/member) are registered but draftless (out of this
    /// feature's scope per the plan). Both keep their existing verb-less draft workflow. Mirrors the
    /// same `draft`-field guard `NativeContentOperations.publish`/`.unpublish` already enforce, so a
    /// gating bug here can't surface as a confusing "not configured" failure toast instead of simply
    /// not offering the verb.
    private func publishableDescriptor(_ id: String) -> ContentTypeDescriptor? {
        guard let post = postsByID[id],
              let descriptor = contentTypeRegistry.descriptor(forCollection: post.collection),
              descriptor.fields.contains(where: { $0.name == "draft" }) else { return nil }
        return descriptor
    }

    func canPublish(_ id: String) -> Bool {
        guard let post = postsByID[id], publishableDescriptor(id) != nil else { return false }
        return post.draft
    }

    func canUnpublish(_ id: String) -> Bool {
        guard let post = postsByID[id], publishableDescriptor(id) != nil else { return false }
        return !post.draft
    }

    /// The item the bare Delete key (`.onDeleteCommand`, #674) should act on right now, or nil
    /// when there's no selection, the selection isn't deletable, or inline-rename is in progress
    /// (Delete should edit the text field, not delete the row, while `editingItemID` is set).
    func deletableSelection() -> NavigatorItem? {
        guard editingItemID == nil, let id = selection, canDelete(id) else { return nil }
        return item(for: id)
    }

    func beginEditing(_ id: String) {
        guard canRename(id) else { return }
        let current = nodesByID[id]?.title ?? ""
        draftTitle = current
        editingItemID = id
    }

    func cancelEditing() {
        draftTitle = ""
        editingItemID = nil
    }

    /// Resolve the editing row → page/post → file, run the rename service, then reflect the new
    /// title into the graph (which re-emits and rebuilds the sidebar). Always clears edit state.
    func commitEditing() async {
        guard let id = editingItemID, let sourceDirectory else { editingItemID = nil; draftTitle = ""; return }
        // Capture the title before any await: the focus-loss path also calls commitEditing and a
        // concurrent cancel/begin on the main actor could mutate `draftTitle` across a suspension.
        let title = draftTitle
        editingItemID = nil
        draftTitle = ""

        if let page = await graph.page(id: id) {
            let url = sourceDirectory.appendingPathComponent(page.filePath)
            let result = await renameService.rename(
                fileURL: url,
                fileExtension: (page.filePath as NSString).pathExtension,
                projectRoot: sourceDirectory,
                relativePath: page.filePath,
                newTitle: title)
            switch result {
            case .success(let outcome):
                registerRenameUndo(outcome, relativePath: page.filePath)
                await graph.upsertPage(SiteContentGraph.Page(
                    id: page.id, siteID: page.siteID, route: page.route,
                    filePath: page.filePath, title: outcome.title, lastModified: page.lastModified))
            case .failure(.emptyTitle):
                break  // no write happened; keep the old title silently
            case .failure(.noEditableLocation):
                renameError = "This page has no editable title to rename."
            case .failure(.io(let msg)):
                renameError = "Couldn't rename: \(msg)"
            }
        } else if let post = await graph.post(id: id) {
            let url = sourceDirectory.appendingPathComponent(post.filePath)
            let result = await renameService.rename(
                fileURL: url,
                fileExtension: (post.filePath as NSString).pathExtension,
                projectRoot: sourceDirectory,
                relativePath: post.filePath,
                newTitle: title)
            switch result {
            case .success(let outcome):
                registerRenameUndo(outcome, relativePath: post.filePath)
                await graph.upsertPost(SiteContentGraph.Post(
                    id: post.id, siteID: post.siteID, collection: post.collection, slug: post.slug,
                    title: outcome.title, draft: post.draft, publishDate: post.publishDate, tags: post.tags,
                    filePath: post.filePath, lastModified: post.lastModified))
            case .failure(.emptyTitle):
                break
            case .failure(.noEditableLocation):
                renameError = "This post has no editable title to rename."
            case .failure(.io(let msg)):
                renameError = "Couldn't rename: \(msg)"
            }
        }
    }

    /// Hands a completed rename to `registerUndo` as a before/after content snapshot (#675). A
    /// rename that changed nothing (same title re-committed) registers no record, so ⌘Z doesn't
    /// collect no-op steps the user has to press through.
    private func registerRenameUndo(
        _ outcome: NavigatorRenameService.RenameOutcome, relativePath: String
    ) {
        guard outcome.previousContents != outcome.newContents else { return }
        registerUndo?(ContentUndoCoordinator.Mutation(
            relativePath: relativePath,
            before: outcome.previousContents,
            after: outcome.newContents,
            actionName: ContentUndoCoordinator.renameActionName()))
    }

    /// Rebuilds `nodes` for the given site. Takes `siteID`/`siteRoot` as parameters (the values
    /// captured by `observeTask`) rather than reading mutable state, so a refresh in flight from a
    /// prior `start()` can't populate the tree with data tagged to a newer site. Checks cancellation
    /// at each suspension point so a `stop()` mid-flight doesn't write stale content after teardown.
    private func refresh(siteID: String, siteRoot: URL) async {
        let pages = await graph.pages(for: siteID)
        if Task.isCancelled { return }
        let posts = await graph.posts(for: siteID)
        if Task.isCancelled { return }
        // Run the feed-collection probe off the main actor (it touches the filesystem). Detached
        // doesn't inherit cancellation and the probe isn't internally cancellable, so we guard the
        // write below rather than trying to interrupt it; `.userInitiated` keeps the interactive
        // sidebar population from being deprioritized behind background work.
        let feeds = await Task.detached(priority: .userInitiated) {
            SiteFileTree.feedCollections(siteRoot: siteRoot)
        }.value
        if Task.isCancelled { return }
        // Assigned together with `nodes` below so `canRepurpose`/`canPublish`/`canUnpublish` never
        // gate against a post set that's out of sync with what's actually shown in the sidebar.
        postIDs = Set(posts.map(\.id))
        postsByID = Dictionary(uniqueKeysWithValues: posts.map { ($0.id, $0) })
        let tree = buildSiteURLTree(
            websiteTitle: websiteTitle, pages: pages, posts: posts, feedCollections: feeds)
        nodes = tree
        nodesByID = Self.index(tree)
        routeIDs = Self.indexRoutes(nodesByID)
    }

    private static func index(_ nodes: [URLTreeNode]) -> [String: URLTreeNode] {
        var map: [String: URLTreeNode] = [:]
        func walk(_ node: URLTreeNode) {
            map[node.id] = node
            node.children?.forEach(walk)
        }
        nodes.forEach(walk)
        return map
    }

    /// Only `.route` targets: a directory row previews its index page rather than the document a
    /// search hit names, and the website-settings row opens `Info.plist` — neither is where
    /// activating a content hit should land.
    private static func indexRoutes(_ nodesByID: [String: URLTreeNode]) -> [String: String] {
        var map: [String: String] = [:]
        for node in nodesByID.values {
            guard case .route(let route) = node.target else { continue }
            map[route] = node.id
        }
        return map
    }

    /// Appends a redirect for `source` → `destination` to `Source/redirects.json` (#530). Used by
    /// the "Add Redirect?" prompt `SiteWindow` shows after `SiteWindowModel.confirmDelete()`
    /// successfully deletes a page or post (#584) — that method captures the deleted item's route
    /// before the delete call and, on success, offers this via a sheet hosted in `SiteWindow` (not
    /// here: delete itself is owned by `SiteWindowModel`/`NativeContentOperations` since #516, not
    /// this model). Returns whether the save succeeded; on failure sets `redirectSaveError`.
    @discardableResult
    func saveRedirect(source: String, destination: String, code: RedirectsStore.RedirectEntry.Code) async -> Bool {
        guard let sourceDirectory else { return false }
        let store = RedirectsStore(sourceDirectory: sourceDirectory)
        do {
            var entries = try store.load()
            entries.append(RedirectsStore.RedirectEntry(source: source, destination: destination, code: code))
            try store.save(entries)
            return true
        } catch {
            redirectSaveError = "Couldn't save the redirect: \(error.localizedDescription)"
            return false
        }
    }
}
