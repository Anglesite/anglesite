/// One offered version-range bump for a single package.
public struct DependencyUpdateOffer: Sendable, Equatable {
    public let name: String
    public let currentRange: String
    public let offeredRange: String

    public init(name: String, currentRange: String, offeredRange: String) {
        self.name = name
        self.currentRange = currentRange
        self.offeredRange = offeredRange
    }
}

/// Which `package.json` section a dependency belongs (or would be added) to.
public enum DependencySection: Sendable, Equatable {
    case dependencies
    case devDependencies
}

/// One offered new package the template has that the site does not.
public struct DependencyAdditionOffer: Sendable, Equatable {
    public let name: String
    public let offeredRange: String
    public let section: DependencySection

    public init(name: String, offeredRange: String, section: DependencySection) {
        self.name = name
        self.offeredRange = offeredRange
        self.section = section
    }
}

/// The full result of a `DependencySync.diff` call: version bumps for packages
/// the site already has, and new packages the template has that the site
/// doesn't. `diff` itself doesn't return this yet (see #1108 Task 2) — this
/// type exists now so `PackageJSONDependencies.applyAdditions` can consume
/// `DependencyAdditionOffer` independently.
public struct DependencySyncOffers: Sendable, Equatable {
    public let updates: [DependencyUpdateOffer]
    public let additions: [DependencyAdditionOffer]

    public init(updates: [DependencyUpdateOffer] = [], additions: [DependencyAdditionOffer] = []) {
        self.updates = updates
        self.additions = additions
    }

    public var isEmpty: Bool { updates.isEmpty && additions.isEmpty }
}

/// Three-way comparison between a site's dependencies, an optional scaffold-time
/// baseline snapshot, and the app's current bundled template (spec §3). Only ever
/// offers a version bump for a package present in both the site and the template —
/// never adds or removes a package name.
public enum DependencySync {
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
