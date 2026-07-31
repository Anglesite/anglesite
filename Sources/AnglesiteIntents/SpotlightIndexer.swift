import AppIntents
import CoreSpotlight
import Foundation
import AnglesiteCore

/// Conforming `SiteEntity` to `IndexedEntity` is what lets `CSSearchableIndex.indexAppEntities`
/// accept it and contribute to macOS 27's Spotlight semantic index. The default `attributeSet`
/// synthesized from the entity's `displayRepresentation` (title + subtitle) is sufficient for v0
/// — override only if Spotlight result formatting needs more (kind, contentURL, thumbnail).
extension SiteEntity: IndexedEntity {}

/// Pluggable seam over `CSSearchableIndex` so `SpotlightIndexerTests` can verify the diff/upsert
/// sequencing without hitting the live system index daemon.
public protocol SpotlightIndexBackend: Sendable {
    /// Upsert `entities` into the index. Id-keyed, so re-indexing an unchanged entity is a
    /// harmless overwrite — the indexer relies on that rather than diffing entity contents.
    func index(_ entities: [SiteEntity]) async throws
    /// Remove the entries with these ids. Must be idempotent: the indexer's retry posture
    /// replays deletes after a failed upsert (see ``SpotlightIndexer/reindex(_:)``).
    func deleteEntities(identifiers: [String]) async throws
}

/// Maintains the Spotlight semantic index for `SiteEntity`. Single-entry point: `reindex(_:)`.
///
/// `reindex` is diff-based — it tracks the id set published on the last call and deletes any
/// id absent from the new snapshot before upserting the current set. This mirrors the
/// "fold a stream of `SiteStore` mutations into the index" use case driven by
/// `SiteStore.setChangeHandler` (see `AnglesiteIntents.bootstrap`).
public actor SpotlightIndexer {
    /// The production instance, bound to the system index. A singleton so every `SiteStore`
    /// mutation folds into one `lastIndexedIDs` diff state — two indexers would fight over
    /// deletes.
    public static let shared = SpotlightIndexer(backend: LiveSpotlightBackend())

    private let backend: any SpotlightIndexBackend
    private var lastIndexedIDs: Set<String> = []

    /// Creates an indexer over `backend` with an empty diff baseline — the first `reindex`
    /// therefore upserts everything and deletes nothing, which is the right cold-start behavior.
    public init(backend: any SpotlightIndexBackend) {
        self.backend = backend
    }

    /// Result returned to callers (today: tests only) so they can assert the diff outcome.
    public struct Outcome: Sendable, Equatable {
        /// How many entities were (re-)upserted this call — the full snapshot size, not a delta.
        public let indexed: Int
        /// How many previously-indexed ids were deleted because they left the snapshot.
        public let removed: Int
    }

    /// Compute the diff against the previously-indexed set, delete anything dropped, then
    /// upsert the current set. `lastIndexedIDs` only advances on full success — if
    /// `backend.index` throws after a successful delete, the tracked set stays at its
    /// pre-call value, so the next `reindex` replays the (id-set-idempotent) delete and
    /// retries the upsert. That's the intended retry posture; it costs one extra harmless
    /// delete on the daemon but avoids drifting into "the indexer thinks it published this
    /// but the index is missing entries" state.
    @discardableResult
    public func reindex(_ sites: [SiteStore.Site]) async throws -> Outcome {
        let entities = sites.map(SiteEntity.init)
        let currentIDs = Set(entities.map(\.id))
        let removedIDs = lastIndexedIDs.subtracting(currentIDs)

        if !removedIDs.isEmpty {
            try await backend.deleteEntities(identifiers: Array(removedIDs))
        }
        if !entities.isEmpty {
            try await backend.index(entities)
        }
        lastIndexedIDs = currentIDs
        return Outcome(indexed: entities.count, removed: removedIDs.count)
    }
}

/// Production backend. Routes to `CSSearchableIndex.default()`, the system-wide index used by
/// Spotlight and Siri. macOS 27 routes `IndexedEntity` writes through the semantic index.
struct LiveSpotlightBackend: SpotlightIndexBackend {
    func index(_ entities: [SiteEntity]) async throws {
        try await CSSearchableIndex.default().indexAppEntities(entities)
    }

    func deleteEntities(identifiers: [String]) async throws {
        try await CSSearchableIndex.default().deleteAppEntities(
            identifiedBy: identifiers,
            ofType: SiteEntity.self
        )
    }
}
