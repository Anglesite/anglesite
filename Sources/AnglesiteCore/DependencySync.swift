/// One offered version-range bump for a single package.
public struct DependencyUpdateOffer: Sendable, Equatable {
    /// The npm package name, exactly as it appears in `package.json`'s dependency maps.
    public let name: String
    /// The version range currently in the site's `package.json` — shown to the user so the
    /// offer reads as a concrete before/after, not just "an update is available".
    public let currentRange: String
    /// The bundled template's newer range that replaces `currentRange` if the offer is accepted.
    public let offeredRange: String

    /// Memberwise initializer — offers are normally produced by
    /// ``DependencySync/diff(site:baseline:template:templateDevDependencyNames:)``;
    /// this exists so tests (and previews) can construct them directly.
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
/// doesn't.
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
/// baseline snapshot, and the app's current bundled template (spec §3, #1108).
/// Offers a version bump for a package present in both the site and the
/// template, and offers to add a package the template has that the site is
/// missing (unless the baseline shows the site is known to have had — and so
/// deliberately removed — that package before). Never offers to remove a
/// package the template no longer has.
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
        template: [String: String],
        templateDevDependencyNames: Set<String> = []
    ) -> DependencySyncOffers {
        var updates: [DependencyUpdateOffer] = []
        var additions: [DependencyAdditionOffer] = []
        for (name, templateRange) in template.sorted(by: { $0.key < $1.key }) {
            guard let siteRange = site[name] else {
                // Not in the site at all: a candidate for an addition offer,
                // gated by whether the site is known to have deliberately
                // removed it before (#1108).
                if let baseline {
                    guard baseline[name] == nil else { continue }
                }
                // else: no baseline at all -> legacy direct-diff fallback, same
                // risk tolerance as the bump path below.
                let section: DependencySection = templateDevDependencyNames.contains(name) ? .devDependencies : .dependencies
                additions.append(DependencyAdditionOffer(name: name, offeredRange: templateRange, section: section))
                continue
            }
            guard DependencyVersionComparator.isNewer(templateRange, than: siteRange) == true else { continue }
            if let baseline {
                // 3-way case: only offer when the site never touched this package
                // since it was scaffolded (its range still matches the baseline).
                guard let baselineRange = baseline[name], baselineRange == siteRange else { continue }
            }
            // else: no baseline at all -> legacy direct-diff fallback (spec §3).
            updates.append(DependencyUpdateOffer(name: name, currentRange: siteRange, offeredRange: templateRange))
        }
        return DependencySyncOffers(updates: updates, additions: additions)
    }
}

extension DependencySync {
    /// Bridges a Dependabot alert to an already-computed `DependencySyncOffers`, for the
    /// Security Reports tab's "Update available" action (#975). `nil` when no fix is known
    /// (`alert.patchedVersion == nil`), the package isn't in the current sync offers, or the
    /// offered range doesn't reach the patched version — including when the version comparison
    /// itself can't be parsed, per `DependencyVersionComparator`'s own "never guess" contract.
    public static func fixOffer(for alert: DependabotAlert, in offers: DependencySyncOffers) -> DependencyUpdateOffer? {
        guard let patchedVersion = alert.patchedVersion else { return nil }
        guard let offer = offers.updates.first(where: { $0.name == alert.packageName }) else { return nil }
        // The offered range must not be *older* than the patch — i.e. it's newer or equal.
        // If the comparison returns nil (unparseable), treat it as "never guess" — no confirmed fix.
        guard let isNewer = DependencyVersionComparator.isNewer(patchedVersion, than: offer.offeredRange), !isNewer else { return nil }
        return offer
    }
}
