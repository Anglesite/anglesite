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

    /// npm package names known to have a public external conformance suite (micropub.rocks,
    /// webmention.rocks, the ActivityPub test suite) — the packages `areAllSuitesPassing` refuses
    /// to vacuously pass just because `suites` is empty. Packages not in this set have no known
    /// public suite to run, so an empty `suites` dict genuinely means "nothing external applies"
    /// rather than "no evidence reported yet" (#957).
    public static let packagesWithKnownConformanceSuites: Set<String> = [
        "@dwk/micropub",
        "@dwk/webmention",
        "@dwk/activitypub",
    ]

    /// `true` when this package has a known public conformance suite (see
    /// `packagesWithKnownConformanceSuites`) but `status.json` reports no suite results for it —
    /// evidence is missing, not failing.
    public var isMissingRequiredSuite: Bool {
        Self.packagesWithKnownConformanceSuites.contains(name) && suites.isEmpty
    }

    /// `true` when all external suites pass. An empty `suites` dict passes vacuously only for
    /// packages with no known public conformance suite — for a package in
    /// `packagesWithKnownConformanceSuites`, an empty `suites` dict means no evidence was
    /// published, not that nothing needed running, so it reports `false` (#957).
    public var areAllSuitesPassing: Bool {
        guard !suites.isEmpty else { return !isMissingRequiredSuite }
        return suites.values.allSatisfy { $0.status == "passing" }
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
        /// Packages that are missing from the status, or failing their integration tests or an
        /// external suite that actually ran.
        public let blocked: [String]
        /// Packages whose integration tests pass but whose known public conformance suite has
        /// reported no results yet — distinct from `blocked`: this is missing evidence, not a
        /// known failure (#957).
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
            } else if pkg.isIntegrationPassing && pkg.isMissingRequiredSuite {
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
