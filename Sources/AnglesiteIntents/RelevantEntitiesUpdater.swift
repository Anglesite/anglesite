import AppIntents
import Foundation
import AnglesiteCore

/// Pluggable seam over the system `RelevantEntities` suggestion surface, so
/// `RelevantEntitiesUpdaterTests` can verify the top-N/dedup behavior without touching the
/// live App Intents relevance API. Mirrors `SpotlightIndexBackend`.
public protocol RelevantEntitiesBackend: Sendable {
    /// Replace the published relevant-entity set with `entities`. Each call is a full snapshot,
    /// not a delta — the updater already diffed, so a backend that gets called should publish
    /// everything it's given.
    func update(_ entities: [SiteEntity]) async throws
}

/// Publishes the top-N most-recently-used sites to macOS 27's "relevant entities" suggestion
/// surface (distinct from the searchable index `SpotlightIndexer` maintains). Single entry
/// point: `refresh(_:)`, driven by `SiteStore.changeStream()` (see `AnglesiteIntents.bootstrap`).
///
/// `refresh` is diff-based on an **ordered** id list: it records the top-N ids published on the
/// last successful call and skips the backend when the new top-N ids match in the same order — so
/// a reorder of the lead sites re-publishes, while churn below the top-N (or an identical
/// snapshot) is a no-op. `lastPushedIDs` advances only on success, so a thrown backend error
/// replays on the next snapshot.
public actor RelevantEntitiesUpdater {
    /// The production instance, wired to the live (currently no-op, see `LiveRelevantEntitiesBackend`)
    /// relevance backend. A singleton so `bootstrap`'s change-stream consumer and any future
    /// callers share one `lastPushedIDs` diff state.
    public static let shared = RelevantEntitiesUpdater(backend: LiveRelevantEntitiesBackend())

    /// Result returned to callers (today: tests only) so they can assert the diff outcome.
    public struct Outcome: Sendable, Equatable {
        /// Size of the top-N candidate window this refresh considered — NOT necessarily the
        /// number sent to the backend. When `skipped` is true the backend was not called at all.
        public let count: Int
        /// `true` when the top-N ids matched the last successful push (in order) and the
        /// backend was not called.
        public let skipped: Bool

        /// Memberwise initializer — public so test assertions can build expected outcomes.
        public init(count: Int, skipped: Bool) {
            self.count = count
            self.skipped = skipped
        }
    }

    private let backend: any RelevantEntitiesBackend
    private let maxCount: Int
    private var lastPushedIDs: [String] = []

    /// Creates an updater over `backend`. `maxCount` defaults to 3 — the relevance surface is a
    /// suggestion strip, not a browser, so publishing more than the lead few MRU sites just
    /// dilutes it; tests shrink it to exercise the window edge.
    public init(backend: any RelevantEntitiesBackend, maxCount: Int = 3) {
        self.backend = backend
        self.maxCount = maxCount
    }

    /// Publish the top-N of `sites` (already MRU-ordered by the caller) if they differ from the
    /// last successful push — see the type doc for the ordered-diff semantics. Rethrows backend
    /// errors without advancing the diff state, so the next snapshot retries.
    @discardableResult
    public func refresh(_ sites: [SiteStore.Site]) async throws -> Outcome {
        let top = Array(sites.prefix(maxCount))
        let ids = top.map(\.id)
        guard ids != lastPushedIDs else {
            return Outcome(count: top.count, skipped: true)
        }
        try await backend.update(top.map(SiteEntity.init))
        lastPushedIDs = ids
        return Outcome(count: top.count, skipped: false)
    }
}

/// Production backend for the macOS 27 App Intents relevance surface.
///
/// Deferred: `RelevantEntities.shared.updateEntities(_:for:)` requires an `AppEntityContext`,
/// which has no public initializer in macOS 27 beta 1 — the only public factory is `.audio(_:)`,
/// which is semantically wrong for site entities. Rather than bind the private initializer, this
/// stays a no-op until Apple exposes a general/document `AppEntityContext` factory; re-enabling is
/// then a one-line change here. The rest of the pipeline (top-N MRU diff in `RelevantEntitiesUpdater`,
/// the `changeStream()` consumer in `bootstrap`) is live and exercised. Track at #124.
struct LiveRelevantEntitiesBackend: RelevantEntitiesBackend {
    func update(_ entities: [SiteEntity]) async throws {
        // No-op until a public AppEntityContext factory exists (see type doc). Track: #124.
        //
        // Intended call once a non-audio context can be constructed (signature confirmed against
        // the Xcode 27 AppIntents.swiftinterface — `updateEntities(_:for:)` takes `[any AppEntity]`
        // and an `AppEntityContext`):
        //
        //     try await RelevantEntities.shared.updateEntities(entities, for: <AppEntityContext>)
        //
        // The blocker is solely the `for:` argument: macOS 27 beta 1 exposes only
        // `AppEntityContext.audio(_:)`. Re-enable when a general/document factory ships.
    }
}
