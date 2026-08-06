import Foundation

/// Parse result for one `@dwk/*` package entry from `conformance/status.json`.
public struct WorkersPackageStatus: Sendable, Equatable {
    /// The npm package name, e.g. `@dwk/webmention`.
    public let name: String
    /// Human-readable standard name, e.g. `"Webmention"`.
    public let standard: String?
    /// External conformance suite results keyed by suite name.
    public let suites: [String: SuiteStatus]
    /// The integration test status string, e.g. `"passing"` or `"pending"`.
    public let integrationStatus: String

    /// `true` when the integration test suite reports `"passing"`.
    public var isIntegrationPassing: Bool { integrationStatus == "passing" }

    /// npm package names known to have a public external conformance suite, mapped to the
    /// specific suite key(s) `conformance/status.json` is expected to report for that package —
    /// the packages `areAllSuitesPassing` refuses to vacuously pass just because `suites` is
    /// empty, or because some unrelated suite key happens to be reported as `"passing"`. Packages
    /// not in this map have no known public suite to run, so an empty `suites` dict genuinely
    /// means "nothing external applies" rather than "no evidence reported yet" (#957).
    ///
    /// A value is the empty set for a package whose upstream suite exists but doesn't yet have a
    /// settled `status.json` key convention to check against (`@dwk/activitypub`'s test suite, and
    /// the Solid Protocol Conformance Test Harness before #1275 wired in `"solid-cth"` for
    /// `@dwk/solid-pod`/`@dwk/solid-oidc`) — `areAllSuitesPassing` falls back to "all reported
    /// suites pass" for those, same as before this map had specific keys, rather than guessing a
    /// key name that could turn a real pass into a permanent false negative (#1295). Once
    /// `conformance/status.json` settles on a key for one of these, add it here.
    ///
    /// Known keys today: `indieauth.rocks` for `@dwk/indieauth`; `micropub.rocks` for
    /// `@dwk/micropub`; `webmention.rocks/sender` + `webmention.rocks/receiver` for
    /// `@dwk/webmention`; `litmus` for `@dwk/webdav`; `solid-cth` for `@dwk/solid-pod` and
    /// `@dwk/solid-oidc` (the same Solid Protocol Conformance Test Harness run covers both).
    ///
    /// Every package `WorkersConformanceStatus.phaseRequirements` gates a phase on must land in
    /// either this map's keys or `packagesWithNoKnownConformanceSuite` — `WorkersConformanceTests`
    /// asserts that exhaustively, so a package added to a future phase's requirements without
    /// being classified here fails CI instead of silently reintroducing #957's fail-open bug.
    public static let packagesWithKnownConformanceSuites: [String: Set<String>] = [
        "@dwk/indieauth": ["indieauth.rocks"],
        "@dwk/micropub": ["micropub.rocks"],
        "@dwk/webmention": ["webmention.rocks/sender", "webmention.rocks/receiver"],
        "@dwk/activitypub": [],
        "@dwk/webdav": ["litmus"],
        "@dwk/solid-pod": ["solid-cth"],
        "@dwk/solid-oidc": ["solid-cth"],
    ]

    /// npm package names in `WorkersConformanceStatus.phaseRequirements` confirmed to have **no**
    /// known public conformance suite today — `@dwk/websub`, `@dwk/microsub`, and `@dwk/webfinger`
    /// have no widely-adopted public IndieWeb/Fediverse test suite the way webmention.rocks or
    /// micropub.rocks do. Listed explicitly — not just omitted from
    /// `packagesWithKnownConformanceSuites` — so the omission reads as a documented fact rather
    /// than something to notice by diffing two lists; see the exhaustiveness test in
    /// `WorkersConformanceTests`.
    public static let packagesWithNoKnownConformanceSuite: Set<String> = [
        "@dwk/websub",
        "@dwk/microsub",
        "@dwk/webfinger",
    ]

    /// `true` when this package has a known public conformance suite (see
    /// `packagesWithKnownConformanceSuites`) but `status.json` doesn't report results for at
    /// least one of its expected suite keys — evidence is missing (fully, if `suites` is empty,
    /// or partially, if only some expected keys are present), not failing. Review feedback on
    /// #1295: a *partial* report (e.g. `webmention.rocks/sender` present, `.../receiver` absent)
    /// is the same "hasn't run yet" gap as a fully-empty `suites` dict, one key at a time — it
    /// must classify the same way in `gateStatus`, not fall through to `blocked` just because
    /// `suites` happens to be non-empty.
    public var isMissingRequiredSuite: Bool {
        guard let expectedKeys = Self.packagesWithKnownConformanceSuites[name] else { return false }
        guard !suites.isEmpty else { return true }
        return !expectedKeys.isSubset(of: Set(suites.keys))
    }

    /// `true` when this package has at least one reported suite result that isn't `"passing"` —
    /// a genuine failure, as distinct from `isMissingRequiredSuite`'s "hasn't reported at all"
    /// (#1295). `gateStatus` checks this so a real failure alongside a missing key (e.g. sender
    /// failing, receiver never reported) still classifies as `blocked`, not `unverified`.
    public var hasFailingReportedSuite: Bool {
        suites.values.contains { $0.status != "passing" }
    }

    /// `true` when all external suites pass. An empty `suites` dict passes vacuously only for
    /// packages with no known public conformance suite — for a package in
    /// `packagesWithKnownConformanceSuites`, an empty `suites` dict means no evidence was
    /// published, not that nothing needed running, so it reports `false` (#957). For a non-empty
    /// `suites` dict, this also requires every suite key `packagesWithKnownConformanceSuites`
    /// names for this package to actually be present — a package reporting only an unrelated or
    /// misnamed suite key as `"passing"` no longer vacuously satisfies this just because whatever
    /// *is* reported happens to say `"passing"` (#1295).
    public var areAllSuitesPassing: Bool {
        guard !suites.isEmpty else { return !isMissingRequiredSuite }
        return suites.values.allSatisfy { $0.status == "passing" } && !isMissingRequiredSuite
    }

    /// `true` when both the integration tests and all external suites are passing.
    public var isReleaseReady: Bool { isIntegrationPassing && areAllSuitesPassing }
}

/// Status of a single external conformance suite run.
public struct SuiteStatus: Sendable, Equatable, Decodable {
    /// The run outcome, e.g. `"passing"` or `"pending"`.
    public let status: String
}

/// The full conformance snapshot parsed from `conformance/status.json`.
public struct WorkersConformanceStatus: Sendable, Equatable {
    /// All packages keyed by npm package name.
    public let packages: [String: WorkersPackageStatus]

    /// A social-feature phase whose activation is gated on a set of `@dwk/*` packages.
    public enum Phase: Sendable, Equatable {
        /// V-2: send webmentions, IndieAuth login.
        case v2
        /// V-3: Micropub, receive webmentions, WebSub.
        case v3
        /// V-4: ActivityPub, Microsub, WebFinger.
        case v4
        /// Storage: Solid Pod + its WebDAV façade (not part of the V-2/V-3/V-4 social-phase
        /// numbering — a separate "storage" vertical, gated the same way).
        case storage
    }

    /// The `@dwk/*` packages each phase's activation is gated on — the app-side mirror of the
    /// release plan, kept as data (not logic) so ``gateStatus(for:)`` stays a pure lookup.
    public static let phaseRequirements: [Phase: [String]] = [
        .v2: ["@dwk/webmention", "@dwk/indieauth"],
        .v3: ["@dwk/micropub", "@dwk/webmention", "@dwk/websub"],
        .v4: ["@dwk/activitypub", "@dwk/microsub", "@dwk/webfinger"],
        .storage: ["@dwk/solid-pod", "@dwk/webdav", "@dwk/solid-oidc"],
    ]

    /// Result of evaluating whether a phase's required packages are all release-ready.
    public struct GateResult: Sendable, Equatable {
        /// The phase this result describes.
        public let phase: Phase
        /// Packages that are release-ready.
        public let ready: [String]
        /// Packages that are missing from the status, or failing their integration tests or a
        /// reported suite (a suite result that isn't `"passing"` always lands here, even
        /// alongside a missing expected key elsewhere on the same package — #1295).
        public let blocked: [String]
        /// Packages whose integration tests pass but whose known public conformance suite is
        /// missing evidence for at least one expected suite key — fully (an empty `suites` dict)
        /// or partially (some expected keys reported, at least one absent) — with no genuine
        /// failure reported elsewhere. Distinct from `blocked`: this is missing evidence, not a
        /// known failure (#957, refined for partial reports by #1295).
        public let unverified: [String]
        /// `true` when no packages are blocked or unverified — the phase may be activated.
        public var isUnblocked: Bool { blocked.isEmpty && unverified.isEmpty }
    }

    /// Returns the gate status for `phase`, reporting which required packages are ready,
    /// which are blocked, and which are unverified (see `GateResult`).
    public func gateStatus(for phase: Phase) -> GateResult {
        let required = Self.phaseRequirements[phase] ?? []
        var ready: [String] = []
        var blocked: [String] = []
        var unverified: [String] = []
        for name in required {
            guard let pkg = packages[name] else {
                blocked.append(name)
                continue
            }
            if pkg.isReleaseReady {
                ready.append(name)
            } else if pkg.isIntegrationPassing && pkg.isMissingRequiredSuite && !pkg.hasFailingReportedSuite {
                unverified.append(name)
            } else {
                blocked.append(name)
            }
        }
        return GateResult(phase: phase, ready: ready, blocked: blocked, unverified: unverified)
    }
}

/// Parses `conformance/status.json` from the `@dwk/workers` monorepo into a
/// `WorkersConformanceStatus` value. Stateless — call `parse(_:)` directly.
public enum WorkersConformanceReader {
    /// Decodes `data` (UTF-8 JSON matching the `conformance/status.json` schema) and returns
    /// a `WorkersConformanceStatus`. Throws a `DecodingError` if the JSON is malformed.
    public static func parse(_ data: Data) throws -> WorkersConformanceStatus {
        struct Root: Decodable {
            let packages: [String: PackageEntry]
        }
        struct PackageEntry: Decodable {
            let standard: String?
            let suites: [String: SuiteStatus]?
            let integration: IntegrationEntry?
        }
        struct IntegrationEntry: Decodable {
            let status: String
        }

        let root = try JSONDecoder().decode(Root.self, from: data)
        var packages: [String: WorkersPackageStatus] = [:]
        for (name, entry) in root.packages {
            packages[name] = WorkersPackageStatus(
                name: name,
                standard: entry.standard,
                suites: entry.suites ?? [:],
                integrationStatus: entry.integration?.status ?? "pending"
            )
        }
        return WorkersConformanceStatus(packages: packages)
    }
}
