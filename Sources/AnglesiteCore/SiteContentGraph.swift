import Foundation

/// In-memory projection of an Anglesite site's content (pages, posts, images), populated
/// by the MCP server's `list_content` response and kept in sync via file-watch events.
///
/// The filesystem is the source of truth — this is a read cache, not a database. The graph
/// holds no I/O surface, so it has no persistence: cold start is empty, and the active runtime
/// (#142, A.8) repopulates per site open.
///
/// **Change handler.** Single-subscriber by design. Fires on real mutations only:
/// `upsert*` with an `Equatable`-equal existing entry does not emit. The signature passes the
/// siteID only — the subscriber (A.3 `ContentSpotlightIndexer`) reads pages/posts/images back
/// from the graph for diff computation. This keeps emit cheap and matches the existing
/// `SpotlightIndexer.reindex(_:)` "trust whatever the source publishes at moment of read"
/// pattern.
public actor SiteContentGraph {
    /// One routed page entry (an Astro page file), keyed by route.
    public struct Page: Sendable, Equatable, Identifiable {
        /// `"{siteID}:page:{route}"` — site-qualified so multiple open sites coexist in one graph.
        public let id: String
        /// The owning site's stable UUID string.
        public let siteID: String
        /// The public route the page renders at (e.g. `/about`).
        public let route: String
        /// Project-relative source path within `Source/`.
        public let filePath: String
        /// Frontmatter-derived title, when the scanner found one.
        public let title: String?
        /// The source file's modification date at scan time — the staleness signal indexers
        /// diff against.
        public let lastModified: Date

        /// Memberwise creation; callers (the content scanner) compose `id` themselves.
        public init(
            id: String,
            siteID: String,
            route: String,
            filePath: String,
            title: String?,
            lastModified: Date
        ) {
            self.id = id
            self.siteID = siteID
            self.route = route
            self.filePath = filePath
            self.title = title
            self.lastModified = lastModified
        }
    }

    /// One content-collection post entry, carrying the frontmatter facets (draft state,
    /// publish date, tags) the navigator and search filter on.
    public struct Post: Sendable, Equatable, Identifiable {
        /// `"{siteID}:post:{slug}"` — site-qualified so multiple open sites coexist in one graph.
        public let id: String
        /// The owning site's stable UUID string.
        public let siteID: String
        /// The content collection the post belongs to (e.g. `posts`).
        public let collection: String
        /// Filename-derived slug, unique within its collection.
        public let slug: String
        /// The post's frontmatter title.
        public let title: String
        /// Whether the post is marked draft in frontmatter (excluded from published builds).
        public let draft: Bool
        /// Frontmatter publish date, when set.
        public let publishDate: Date?
        /// Frontmatter tags; empty when none.
        public let tags: [String]
        /// Project-relative source path within `Source/`.
        public let filePath: String
        /// The source file's modification date at scan time — the staleness signal indexers
        /// diff against.
        public let lastModified: Date

        /// Memberwise creation; callers (the content scanner) compose `id` themselves.
        public init(
            id: String,
            siteID: String,
            collection: String,
            slug: String,
            title: String,
            draft: Bool,
            publishDate: Date?,
            tags: [String],
            filePath: String,
            lastModified: Date
        ) {
            self.id = id
            self.siteID = siteID
            self.collection = collection
            self.slug = slug
            self.title = title
            self.draft = draft
            self.publishDate = publishDate
            self.tags = tags
            self.filePath = filePath
            self.lastModified = lastModified
        }
    }

    /// One image asset entry, including reverse usage references (``usedOnPages``) so callers
    /// can tell an in-use image from a dead asset.
    public struct Image: Sendable, Equatable, Identifiable {
        /// `"{siteID}:image:{relativePath}"` — site-qualified so multiple open sites coexist
        /// in one graph.
        public let id: String
        /// The owning site's stable UUID string.
        public let siteID: String
        /// Path relative to the project root.
        public let relativePath: String
        /// Base file name, for display and search.
        public let fileName: String
        /// Size in bytes, when the scanner could stat the file.
        public let byteSize: Int64?
        /// Project-relative source paths that reference this image, sorted. Populated by
        /// `ContentScanner.scanImages` from `DeadAssetScanner.referencedPaths(projectRoot:)`
        /// (#140/#553) — `DeadAssetScanner` is the canonical usage authority for this field.
        public let usedOnPages: [String]
        /// The asset file's modification date at scan time — the staleness signal indexers
        /// diff against.
        public let lastModified: Date

        /// Memberwise creation; callers (the content scanner) compose `id` themselves.
        public init(
            id: String,
            siteID: String,
            relativePath: String,
            fileName: String,
            byteSize: Int64?,
            usedOnPages: [String],
            lastModified: Date
        ) {
            self.id = id
            self.siteID = siteID
            self.relativePath = relativePath
            self.fileName = fileName
            self.byteSize = byteSize
            self.usedOnPages = usedOnPages
            self.lastModified = lastModified
        }
    }

    /// The single awaited change hook (see the type-level "Change handler" note). Receives only
    /// the affected siteID — the subscriber reads pages/posts/images back from the graph itself,
    /// keeping emits cheap.
    public typealias ChangeHandler = @Sendable (String) async -> Void

    private var pages: [String: Page] = [:]
    private var posts: [String: Post] = [:]
    private var images: [String: Image] = [:]
    private var changeHandler: ChangeHandler?

    /// siteIDs that have received at least one full `load(siteID:...)` since cold start (or
    /// since their last `unload`). Lets a caller distinguish "this site's index is genuinely
    /// empty" from "this site was never scanned" (#658) — the latter is not evidence content is
    /// missing, just that nothing has populated the graph yet.
    ///
    /// Deliberately **not** set by `upsertPage`/`upsertPost`/`upsertImage` — an incremental
    /// upsert (e.g. the navigator's rename path) proves one entry exists, not that the whole
    /// site has been enumerated, so it can't license "a search miss is reliable."
    ///
    /// Populated both by a post-mutation rescan (`ContentCreationWorkflow.refreshContentGraph`)
    /// and by `SiteWindowModel.refreshContentGraph` at site-open (#660), so this flag is normally
    /// `true` shortly after a site finishes opening, well before the first chat turn.
    private var populatedSiteIDs: Set<String> = []

    /// Additive multi-subscriber broadcast for UI observers (the Site Navigator), keyed by a
    /// per-subscription `UUID`. Distinct from `changeHandler` (the indexer's single awaited hook):
    /// these are fire-and-forget siteID feeds. Pruned via the stream's `onTermination`.
    private var changeStreamContinuations: [UUID: AsyncStream<String>.Continuation] = [:]

    /// Per-siteID monotonic counter guarding `load` against a slower, earlier-started scan
    /// landing after (and clobbering) a faster, newer one (#666). Keyed per siteID so two
    /// sites' scans never interfere with each other's fencing.
    private var scanGenerations: [String: Int] = [:]

    /// Creates an empty graph — per the type-level contract, cold start holds nothing until the
    /// first ``load(siteID:pages:posts:images:generation:)``.
    public init() {}

    /// Claims a new scan generation for `siteID`. Call this *before* starting a filesystem
    /// walk, then pass the returned token to `load(siteID:pages:posts:images:generation:)`
    /// when the scan completes.
    ///
    /// First-started, not first-finished, wins: if another `beginScan` call claims a newer
    /// generation for the same siteID before this scan's `load` lands, that `load` call is
    /// silently discarded — a later-started scan reflects a filesystem state that already
    /// accounts for whatever mutation triggered it, so an earlier-started scan's result is
    /// stale by definition, however long it takes to complete (#666).
    public func beginScan(siteID: String) -> Int {
        let next = (scanGenerations[siteID] ?? 0) + 1
        scanGenerations[siteID] = next
        return next
    }

    /// Installs (or clears, with `nil`) the single awaited change hook, replacing any previous
    /// one — single-subscriber by design; UI observers use ``changeStream()`` instead.
    public func setChangeHandler(_ handler: ChangeHandler?) {
        changeHandler = handler
    }

    /// A multi-subscriber stream of affected siteIDs, one per real mutation. Actor-isolated so the
    /// continuation registers synchronously before this returns: there is no subscribe-time snapshot
    /// to mask a registration race, so a caller that subscribes then mutates must not miss the emit.
    /// (A content change is an event — the navigator reads the graph back itself on first load.)
    /// Callers `await` it.
    public func changeStream() -> AsyncStream<String> {
        let (stream, continuation) = AsyncStream.makeStream(
            of: String.self, bufferingPolicy: .bufferingNewest(8))
        let id = UUID()
        changeStreamContinuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            // onTermination runs off-actor at an arbitrary time; hop back to prune.
            Task { await self?.removeContinuation(id) }
        }
        return stream
    }

    private func removeContinuation(_ id: UUID) {
        changeStreamContinuations[id] = nil
    }

    private func emitChange(_ siteID: String) async {
        if let handler = changeHandler { await handler(siteID) }
        for continuation in changeStreamContinuations.values {
            continuation.yield(siteID)
        }
    }

    // MARK: - Bulk load

    /// Replaces all entries for `siteID` with the supplied payload. Existing entries for
    /// other siteIDs are untouched. Always emits a change for `siteID`, unless discarded by
    /// the `generation` guard below.
    ///
    /// - Parameters:
    ///   - siteID: The site whose entries are being replaced.
    ///   - pages: The site's full new page payload.
    ///   - posts: The site's full new post payload.
    ///   - images: The site's full new image payload.
    ///   - generation: A token from `beginScan(siteID:)`. When provided, this call is
    ///     silently discarded (no state change, no emit) if a newer scan has since claimed a
    ///     later generation for `siteID` — see `beginScan` (#666). `nil` (the default) skips the
    ///     guard entirely, applying unconditionally; used by incremental/test callers that don't
    ///     participate in the scan-race fence.
    public func load(
        siteID: String,
        pages: [Page],
        posts: [Post],
        images: [Image],
        generation: Int? = nil
    ) async {
        if let generation, scanGenerations[siteID] != generation {
            return
        }
        for key in self.pages.compactMap({ $0.value.siteID == siteID ? $0.key : nil }) {
            self.pages.removeValue(forKey: key)
        }
        for key in self.posts.compactMap({ $0.value.siteID == siteID ? $0.key : nil }) {
            self.posts.removeValue(forKey: key)
        }
        for key in self.images.compactMap({ $0.value.siteID == siteID ? $0.key : nil }) {
            self.images.removeValue(forKey: key)
        }
        for page in pages { self.pages[page.id] = page }
        for post in posts { self.posts[post.id] = post }
        for image in images { self.images[image.id] = image }
        populatedSiteIDs.insert(siteID)
        await emitChange(siteID)
    }

    // MARK: - Queries (per-site)

    /// Whether `siteID` has received at least one `load(siteID:...)` since cold start (or since
    /// its last `unload`). `false` means the index hasn't been scanned yet — an empty search
    /// result for such a siteID is not evidence the content doesn't exist (#658).
    public func isPopulated(siteID: String) -> Bool {
        populatedSiteIDs.contains(siteID)
    }

    /// All page entries for `siteID`, in no guaranteed order — callers sort for display.
    public func pages(for siteID: String) -> [Page] {
        pages.values.filter { $0.siteID == siteID }
    }

    /// All post entries for `siteID`, in no guaranteed order — callers sort for display.
    public func posts(for siteID: String) -> [Post] {
        posts.values.filter { $0.siteID == siteID }
    }

    /// All image entries for `siteID`, in no guaranteed order — callers sort for display.
    public func images(for siteID: String) -> [Image] {
        images.values.filter { $0.siteID == siteID }
    }

    // MARK: - Incremental upsert

    /// Inserts or replaces one page entry. Emits a change only when the value actually differs
    /// — the `Equatable` suppression that keeps file-watch echo events from re-triggering
    /// subscribers for nothing.
    public func upsertPage(_ page: Page) async {
        if pages[page.id] == page { return }
        pages[page.id] = page
        await emitChange(page.siteID)
    }

    /// Inserts or replaces one post entry; same equal-value emit suppression as
    /// ``upsertPage(_:)``.
    public func upsertPost(_ post: Post) async {
        if posts[post.id] == post { return }
        posts[post.id] = post
        await emitChange(post.siteID)
    }

    /// Inserts or replaces one image entry; same equal-value emit suppression as
    /// ``upsertPage(_:)``.
    public func upsertImage(_ image: Image) async {
        if images[image.id] == image { return }
        images[image.id] = image
        await emitChange(image.siteID)
    }

    // MARK: - Incremental remove

    /// Removes the page with the given id. Silently no-ops (no emit) if the id is unknown —
    /// reflects the file-watch reality where the plugin may report removals for files the
    /// graph never received via `upsert*` (out-of-order events on startup, etc).
    public func removePage(id: String) async {
        guard let removed = pages.removeValue(forKey: id) else { return }
        await emitChange(removed.siteID)
    }

    /// Removes the post with the given id; same silent no-op-on-unknown contract (and
    /// rationale) as ``removePage(id:)``.
    public func removePost(id: String) async {
        guard let removed = posts.removeValue(forKey: id) else { return }
        await emitChange(removed.siteID)
    }

    /// Removes the image with the given id; same silent no-op-on-unknown contract (and
    /// rationale) as ``removePage(id:)``.
    public func removeImage(id: String) async {
        guard let removed = images.removeValue(forKey: id) else { return }
        await emitChange(removed.siteID)
    }

    // MARK: - Teardown

    /// Drops all entries (pages, posts, images) for `siteID` and emits a change. Always
    /// emits — even if the site had no entries, subscribers may want the "site empty now"
    /// signal to prune internal tracking (e.g., A.3 Spotlight indexer's last-indexed set).
    public func unload(siteID: String) async {
        for id in pages.compactMap({ $0.value.siteID == siteID ? $0.key : nil }) {
            pages.removeValue(forKey: id)
        }
        for id in posts.compactMap({ $0.value.siteID == siteID ? $0.key : nil }) {
            posts.removeValue(forKey: id)
        }
        for id in images.compactMap({ $0.value.siteID == siteID ? $0.key : nil }) {
            images.removeValue(forKey: id)
        }
        populatedSiteIDs.remove(siteID)
        await emitChange(siteID)
    }

    // MARK: - Queries (single)

    /// The page with this exact id, or `nil` if the graph doesn't hold it.
    public func page(id: String) -> Page? { pages[id] }
    /// The post with this exact id, or `nil` if the graph doesn't hold it.
    public func post(id: String) -> Post? { posts[id] }
    /// The image with this exact id, or `nil` if the graph doesn't hold it.
    public func image(id: String) -> Image? { images[id] }

    // MARK: - Batched id lookup

    /// Resolve many ids in a single actor hop (#170). Returns matches in the input order, skipping
    /// unknown ids — same semantics as a serial `page(id:)` loop, but one hop instead of N. Used by
    /// `PageEntityQuery.entities(for:)` etc., which Shortcuts re-resolution can call with dozens of
    /// ids after a multi-pick. Takes an ordered `[String]` (not a `Set`) to preserve the
    /// input-order contract the entity queries' tests assert.
    public func pages(ids: [String]) -> [Page] { ids.compactMap { pages[$0] } }
    /// Same single-hop, input-order, skip-unknown contract as ``pages(ids:)``.
    public func posts(ids: [String]) -> [Post] { ids.compactMap { posts[$0] } }
    /// Same single-hop, input-order, skip-unknown contract as ``pages(ids:)``.
    public func images(ids: [String]) -> [Image] { ids.compactMap { images[$0] } }

    // MARK: - Search

    /// Case-insensitive substring search on a page's `title` and `route`. Empty `query`
    /// returns all pages for the siteID (no filtering).
    public func searchPages(siteID: String, matching query: String) -> [Page] {
        let scoped = pages.values.filter { $0.siteID == siteID }
        guard !query.isEmpty else { return Array(scoped) }
        let needle = query.lowercased()
        return scoped.filter { page in
            if page.route.lowercased().contains(needle) { return true }
            if let title = page.title?.lowercased(), title.contains(needle) { return true }
            return false
        }
    }

    /// Case-insensitive substring search on a post's `title`, `slug`, `tags`, and
    /// `collection`. Empty `query` returns all posts for the siteID (no filtering).
    public func searchPosts(siteID: String, matching query: String) -> [Post] {
        let scoped = posts.values.filter { $0.siteID == siteID }
        guard !query.isEmpty else { return Array(scoped) }
        let needle = query.lowercased()
        return scoped.filter { post in
            if post.title.lowercased().contains(needle) { return true }
            if post.slug.lowercased().contains(needle) { return true }
            if post.collection.lowercased().contains(needle) { return true }
            if post.tags.contains(where: { $0.lowercased().contains(needle) }) { return true }
            return false
        }
    }

    /// Case-insensitive substring search on an image's `fileName` and `relativePath`. Empty
    /// `query` returns all images for the siteID (no filtering). Matches the empty-query
    /// convention of `searchPages` / `searchPosts`.
    public func searchImages(siteID: String, matching query: String) -> [Image] {
        let scoped = images.values.filter { $0.siteID == siteID }
        guard !query.isEmpty else { return Array(scoped) }
        let needle = query.lowercased()
        return scoped.filter { image in
            if image.fileName.lowercased().contains(needle) { return true }
            if image.relativePath.lowercased().contains(needle) { return true }
            return false
        }
    }

    // MARK: - Enumeration

    /// The set of siteIDs that currently have any pages, posts, or images. Used by A.3
    /// `ContentSpotlightIndexer` to know which sites it has live state for.
    public func knownSiteIDs() -> Set<String> {
        var ids: Set<String> = []
        ids.formUnion(pages.values.map(\.siteID))
        ids.formUnion(posts.values.map(\.siteID))
        ids.formUnion(images.values.map(\.siteID))
        return ids
    }
}
