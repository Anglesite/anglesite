/// One offered version-range bump for a single package.
public struct DependencyUpdateOffer: Sendable, Equatable {
    /// The npm package name, exactly as it appears in `package.json`'s dependency maps.
    public let name: String
    /// The version range currently in the site's `package.json` — shown to the user so the
    /// offer reads as a concrete before/after, not just "an update is available".
    public let currentRange: String
    /// The bundled template's newer range that replaces `currentRange` if the offer is accepted.
    public let offeredRange: String

    /// Memberwise initializer — offers are normally produced by ``DependencySync/diff(site:baseline:template:)``;
    /// this exists so tests (and previews) can construct them directly.
    public init(name: String, currentRange: String, offeredRange: String) {
        self.name = name
        self.currentRange = currentRange
        self.offeredRange = offeredRange
    }
}

/// Three-way comparison between a site's dependencies, an optional scaffold-time
/// baseline snapshot, and the app's current bundled template (spec §3). Only ever
/// offers a version bump for a package present in both the site and the template —
/// never adds or removes a package name.
public enum DependencySync {
    /// Computes the offers: for every package present in both `site` and `template` where the
    /// template's range is strictly newer (per `DependencyVersionComparator`), offer the bump —
    /// but when a `baseline` exists, only if the site's range still matches it, i.e. the user
    /// never touched that package since scaffolding; a hand-edited range is theirs to keep.
    /// `baseline == nil` is the legacy fallback for pre-baseline sites: a straight
    /// site-vs-template diff (spec §3). Results are sorted by package name for stable UI order.
    public static func diff(
        site: [String: String],
        baseline: [String: String]?,
        template: [String: String]
    ) -> [DependencyUpdateOffer] {
        var offers: [DependencyUpdateOffer] = []
        for (name, templateRange) in template.sorted(by: { $0.key < $1.key }) {
            guard let siteRange = site[name] else { continue }
            guard DependencyVersionComparator.isNewer(templateRange, than: siteRange) == true else { continue }
            if let baseline {
                // 3-way case: only offer when the site never touched this package
                // since it was scaffolded (its range still matches the baseline).
                guard let baselineRange = baseline[name], baselineRange == siteRange else { continue }
            }
            // else: no baseline at all -> legacy direct-diff fallback (spec §3).
            offers.append(DependencyUpdateOffer(name: name, currentRange: siteRange, offeredRange: templateRange))
        }
        return offers
    }
}
