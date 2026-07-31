import AnglesiteCore
import CoreSpotlight

/// Thin counting seam over the indexer, so the probe can take a flat fake in tests instead of
/// standing up a full `ContentSpotlightIndexer` + backend just to vary a count. The production
/// indexer conforms below.
public protocol SpotlightIndexCounting: Sendable {
    /// Per-type counts of what the indexer last published for `siteID`. Reads the indexer's own
    /// bookkeeping, not the live Spotlight daemon — cheap, and sufficient for a readiness signal.
    func indexedCounts(for siteID: String) async -> ContentSpotlightIndexer.IndexedCounts
}

extension ContentSpotlightIndexer: SpotlightIndexCounting {}

/// Reports how many of a site's items are published to the Spotlight semantic index Siri reads.
/// `indexingAvailable` is injected; the default reads `CSSearchableIndex.isIndexingAvailable()`.
public struct SpotlightIndexProbe: ReadinessProbe {
    /// Stable finding id (`ReadinessProbe` requirement).
    public let id = "site.spotlight"
    /// Human-facing row title shown in the readiness report.
    public let title = "Spotlight index"
    private let siteID: String
    private let counter: any SpotlightIndexCounting
    private let indexingAvailable: Bool

    /// Creates a probe for one site. `indexingAvailable` is captured at construction (not read
    /// inside `check()`) so tests can exercise the Spotlight-disabled branch without touching
    /// the real `CSSearchableIndex` availability state.
    public init(
        siteID: String,
        counter: any SpotlightIndexCounting,
        indexingAvailable: Bool = CSSearchableIndex.isIndexingAvailable()
    ) {
        self.siteID = siteID
        self.counter = counter
        self.indexingAvailable = indexingAvailable
    }

    /// Warns (with remediation) when Spotlight is off or nothing is indexed yet; `.ok` with the
    /// item count otherwise. Both failure modes are `.warning`, not errors — the site still
    /// works, Siri just can't see into it.
    public func check() async -> ReadinessFinding {
        guard indexingAvailable else {
            return ReadinessFinding(id: id, title: title, level: .warning,
                detail: "Spotlight indexing is unavailable on this Mac.",
                remediation: "Make sure Spotlight is enabled in System Settings ▸ Siri & Spotlight.")
        }
        let counts = await counter.indexedCounts(for: siteID)
        if counts.total > 0 {
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "\(counts.total) items are indexed in Spotlight for this site.")
        }
        return ReadinessFinding(id: id, title: title, level: .warning,
            detail: "Nothing is indexed in Spotlight for this site yet.",
            remediation: "Open this site's window so its content is indexed.")
    }
}
