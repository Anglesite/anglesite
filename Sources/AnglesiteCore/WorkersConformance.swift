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

    /// `true` when all external suites pass, or when there are no external suites to run.
    public var areAllSuitesPassing: Bool {
        suites.isEmpty || suites.values.allSatisfy { $0.status == "passing" }
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

    public static let phaseRequirements: [Phase: [String]] = [
        .v2: ["@dwk/webmention", "@dwk/indieauth"],
        .v3: ["@dwk/micropub", "@dwk/webmention", "@dwk/websub"],
        .v4: ["@dwk/activitypub", "@dwk/microsub", "@dwk/webfinger"],
        .storage: ["@dwk/solid-pod", "@dwk/webdav"],
    ]

    /// Result of evaluating whether a phase's required packages are all release-ready.
    public struct GateResult: Sendable, Equatable {
        /// The phase this result describes.
        public let phase: Phase
        /// Packages that are release-ready.
        public let ready: [String]
        /// Packages that are not yet release-ready (missing from the status or failing).
        public let blocked: [String]
        /// `true` when no packages are blocked — the phase may be activated.
        public var isUnblocked: Bool { blocked.isEmpty }
    }

    /// Returns the gate status for `phase`, reporting which required packages are ready
    /// and which are still blocked.
    public func gateStatus(for phase: Phase) -> GateResult {
        let required = Self.phaseRequirements[phase] ?? []
        var ready: [String] = []
        var blocked: [String] = []
        for name in required {
            if let pkg = packages[name], pkg.isReleaseReady {
                ready.append(name)
            } else {
                blocked.append(name)
            }
        }
        return GateResult(phase: phase, ready: ready, blocked: blocked)
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
