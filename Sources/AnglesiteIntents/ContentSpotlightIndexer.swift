import AppIntents
import CoreSpotlight
import Foundation
import AnglesiteCore

/// Conforming the content entities to `IndexedEntity` (done in `ContentEntities.swift`) is what
/// lets `CSSearchableIndex.indexAppEntities` accept them and contribute to macOS 27's Spotlight
/// semantic index. This indexer maintains that index off `SiteContentGraph` changes (A.3, #144).

/// Pluggable seam over `CSSearchableIndex` so `ContentSpotlightIndexerTests` can verify the
/// diff/upsert sequencing without hitting the live system index daemon. One method pair per
/// entity type because `deleteAppEntities(identifiedBy:ofType:)` is type-specific.
public protocol ContentSpotlightBackend: Sendable {
    /// Upserts pages into the index. Id-keyed, so re-indexing an unchanged set is harmless.
    func indexPages(_ entities: [PageEntity]) async throws
    /// Upserts posts into the index. Id-keyed, so re-indexing an unchanged set is harmless.
    func indexPosts(_ entities: [PostEntity]) async throws
    /// Upserts images into the index. Id-keyed, so re-indexing an unchanged set is harmless.
    func indexImages(_ entities: [ImageEntity]) async throws
    /// Removes pages by entity id. Idempotent — deleting an absent id is a no-op, which the
    /// indexer's replay-on-failure recovery relies on.
    func deletePages(identifiers: [String]) async throws
    /// Removes posts by entity id. Idempotent, as `deletePages(identifiers:)`.
    func deletePosts(identifiers: [String]) async throws
    /// Removes images by entity id. Idempotent, as `deletePages(identifiers:)`.
    func deleteImages(identifiers: [String]) async throws
}

/// Maintains the Spotlight semantic index for an Anglesite site's pages, posts, and images.
/// Single entry point: `reindex(siteID:)`, driven by `SiteContentGraph.setChangeHandler` (wired
/// in `AnglesiteIntents.bootstrap`).
///
/// Diff-based like `SpotlightIndexer`, but **scoped per site**: the graph's change handler fires
/// for one siteID at a time, and the index is shared across sites, so the last-indexed id sets
/// are tracked per `siteID` per type. Reindexing site B must never delete site A's entities — a
/// global id set would do exactly that, since B's snapshot doesn't contain A's ids.
public actor ContentSpotlightIndexer {
    private let graph: SiteContentGraph
    private let backend: any ContentSpotlightBackend

    /// Last-indexed id sets, per site. Pruned when a site goes empty so the map can't grow
    /// unbounded across the app's lifetime as sites open and close.
    private struct SiteState {
        var pageIDs: Set<String> = []
        var postIDs: Set<String> = []
        var imageIDs: Set<String> = []
        var isEmpty: Bool { pageIDs.isEmpty && postIDs.isEmpty && imageIDs.isEmpty }
    }
    private var lastIndexed: [String: SiteState] = [:]

    /// Per-site serialization. `reindex` reads `lastIndexed[siteID]`, awaits the backend, then
    /// writes back — and actors are reentrant across `await`, so a second graph mutation for the
    /// same site (the change handler re-enters us while a pass is in flight) could split that
    /// read-modify-write and clobber the newer snapshot, leaking stale entries in the system
    /// index. `inFlight` makes the leader own the pass; concurrent calls just mark the site
    /// `dirty` and return, and the leader re-runs once more to fold in whatever changed.
    private var inFlight: Set<String> = []
    private var dirty: Set<String> = []

    /// The backend is injected (rather than hard-wiring `CSSearchableIndex`) so tests can
    /// observe the diff/upsert sequencing without touching the live system index daemon.
    public init(graph: SiteContentGraph, backend: any ContentSpotlightBackend) {
        self.graph = graph
        self.backend = backend
    }

    /// Result returned to callers (today: tests + the bootstrap log) so they can assert/observe
    /// the diff outcome. Counts are summed across all three entity types.
    public struct Outcome: Sendable, Equatable {
        /// Entities upserted this pass — the full current snapshot, not a changed-only delta,
        /// because the backend upsert is id-keyed and cheap to repeat.
        public let indexed: Int
        /// Ids deleted this pass (present in the previous snapshot, absent from the current one).
        public let removed: Int
    }

    /// Snapshot of how many entities are currently published to Spotlight for a site. Reads the
    /// `lastIndexed` set this indexer maintains — the truthful "what we've put in the index" count
    /// without querying the system daemon. Returns zeros for an unknown / never-indexed site.
    public struct IndexedCounts: Sendable, Equatable {
        /// Pages currently published to Spotlight for the site.
        public let pages: Int
        /// Posts currently published to Spotlight for the site.
        public let posts: Int
        /// Images currently published to Spotlight for the site.
        public let images: Int
        /// Sum across all three types — the "N items indexed" number for status UI.
        public var total: Int { pages + posts + images }
        /// Memberwise; public so tests and status UI can build expected values.
        public init(pages: Int, posts: Int, images: Int) {
            self.pages = pages
            self.posts = posts
            self.images = images
        }
    }

    /// The current published-to-Spotlight counts for `siteID` — see ``IndexedCounts`` for what
    /// "published" means here. Zeros for an unknown or never-indexed site.
    public func indexedCounts(for siteID: String) -> IndexedCounts {
        guard let state = lastIndexed[siteID] else { return IndexedCounts(pages: 0, posts: 0, images: 0) }
        return IndexedCounts(pages: state.pageIDs.count, posts: state.postIDs.count, images: state.imageIDs.count)
    }

    /// Fetch the current page/post/image snapshot for `siteID` from the graph, diff each type
    /// against the previously-indexed set for that site, delete anything dropped, then upsert the
    /// current set.
    ///
    /// `lastIndexed[siteID]` only advances on full success: if a backend call throws partway, the
    /// stored state stays at its pre-call value, so the next `reindex` replays the (id-set-
    /// idempotent) deletes and retries the upserts. One extra harmless delete on the daemon beats
    /// drifting into "the indexer thinks it published this but the index is missing entries."
    /// Reindex `siteID`. Serialized per site (see `inFlight`/`dirty`): if a pass is already
    /// running for this site, this call coalesces into it — it marks the site dirty so the
    /// in-flight leader re-runs once more, and returns a no-op `Outcome` immediately.
    @discardableResult
    public func reindex(siteID: String) async throws -> Outcome {
        // Check-and-set is synchronous (no `await` between), so the flag itself can't race.
        if inFlight.contains(siteID) {
            dirty.insert(siteID)
            return Outcome(indexed: 0, removed: 0)
        }
        inFlight.insert(siteID)
        defer { inFlight.remove(siteID) }
        dirty.remove(siteID)

        var outcome = try await performReindex(siteID: siteID)
        // Fold in any mutations that arrived (and coalesced) while we were awaiting the backend.
        while dirty.contains(siteID) {
            dirty.remove(siteID)
            outcome = try await performReindex(siteID: siteID)
        }
        return outcome
    }

    private func performReindex(siteID: String) async throws -> Outcome {
        let pages = await graph.pages(for: siteID).map(PageEntity.init)
        let posts = await graph.posts(for: siteID).map(PostEntity.init)
        let images = await graph.images(for: siteID).map(ImageEntity.init)

        var state = lastIndexed[siteID] ?? SiteState()

        let pageResult = try await sync(pages, last: state.pageIDs, index: backend.indexPages, delete: backend.deletePages)
        let postResult = try await sync(posts, last: state.postIDs, index: backend.indexPosts, delete: backend.deletePosts)
        let imageResult = try await sync(images, last: state.imageIDs, index: backend.indexImages, delete: backend.deleteImages)

        state.pageIDs = pageResult.current
        state.postIDs = postResult.current
        state.imageIDs = imageResult.current
        if state.isEmpty {
            lastIndexed.removeValue(forKey: siteID)
        } else {
            lastIndexed[siteID] = state
        }

        return Outcome(
            indexed: pages.count + posts.count + images.count,
            removed: pageResult.removed + postResult.removed + imageResult.removed
        )
    }

    /// One type's diff: delete ids dropped since `last`, upsert the current set, and return the
    /// new id set plus the removed count. No upsert when the set is empty (avoids daemon traffic).
    private func sync<E: IndexedEntity & Identifiable>(
        _ entities: [E],
        last: Set<String>,
        index: ([E]) async throws -> Void,
        delete: ([String]) async throws -> Void
    ) async throws -> (current: Set<String>, removed: Int) where E.ID == String {
        let currentIDs = Set(entities.map(\.id))
        let removedIDs = last.subtracting(currentIDs)
        if !removedIDs.isEmpty {
            try await delete(Array(removedIDs))
        }
        if !entities.isEmpty {
            try await index(entities)
        }
        return (currentIDs, removedIDs.count)
    }
}

/// Production backend. Routes to `CSSearchableIndex.default()`, the system-wide index used by
/// Spotlight and Siri. macOS 27 routes `IndexedEntity` writes through the semantic index.
struct LiveContentSpotlightBackend: ContentSpotlightBackend {
    func indexPages(_ entities: [PageEntity]) async throws {
        try await CSSearchableIndex.default().indexAppEntities(entities)
    }
    func indexPosts(_ entities: [PostEntity]) async throws {
        try await CSSearchableIndex.default().indexAppEntities(entities)
    }
    func indexImages(_ entities: [ImageEntity]) async throws {
        try await CSSearchableIndex.default().indexAppEntities(entities)
    }
    func deletePages(identifiers: [String]) async throws {
        try await CSSearchableIndex.default().deleteAppEntities(identifiedBy: identifiers, ofType: PageEntity.self)
    }
    func deletePosts(identifiers: [String]) async throws {
        try await CSSearchableIndex.default().deleteAppEntities(identifiedBy: identifiers, ofType: PostEntity.self)
    }
    func deleteImages(identifiers: [String]) async throws {
        try await CSSearchableIndex.default().deleteAppEntities(identifiedBy: identifiers, ofType: ImageEntity.self)
    }
}
