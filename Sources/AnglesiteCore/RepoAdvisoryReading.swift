import Foundation

/// Read-only access to a GitHub repository's inbound security signal: its open private
/// security advisories and open Dependabot alerts (#975, the inbound half of #843). Mirrors
/// `RepoSecurityReading`'s shape — a narrow, injectable seam so `SecurityReportsModel` is
/// testable without real network.
public protocol RepoAdvisoryReading: Sendable {
    /// `GET /repos/{owner}/{repo}/security-advisories`, filtered to advisories whose `state` is
    /// `triage` or `published` — `draft` (the owner's own unsubmitted advisory) and `closed`
    /// are not inbound reports needing triage.
    func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory]

    /// `GET /repos/{owner}/{repo}/dependabot/alerts?state=open`.
    func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert]
}

/// One open GitHub security advisory (repository-level, not a Dependabot alert) — a report
/// filed against the repo directly, via its private advisory form or by GitHub itself.
public struct SecurityAdvisory: Sendable, Equatable, Identifiable {
    /// GitHub's severity classification. `.unknown` is the decode fallback for any value this
    /// type doesn't yet recognize — GitHub can add severities without this type throwing on them.
    public enum Severity: String, Sendable, Equatable, Decodable {
        // GitHub's REST API (both the security-advisories and Dependabot-alerts endpoints)
        // sends "medium" for this tier, not "moderate" — only the Swift-side case name is
        // "moderate". Every other case's raw value matches the wire value already.
        case critical, high, moderate = "medium", low, unknown

        public init(from decoder: any Decoder) throws {
            var container = try decoder.singleValueContainer()
            // `severity` is documented as nullable on repository security advisories.
            guard !container.decodeNil() else {
                self = .unknown
                return
            }
            let raw = try container.decode(String.self)
            self = Severity(rawValue: raw) ?? .unknown
        }
    }

    /// The advisory's `ghsa_id` (e.g. `"GHSA-xxxx-yyyy-zzzz"`) — stable and unique per advisory.
    public let id: String
    public let summary: String
    public let severity: Severity
    public let htmlURL: URL
    public let publishedAt: Date?

    public init(id: String, summary: String, severity: Severity, htmlURL: URL, publishedAt: Date?) {
        self.id = id
        self.summary = summary
        self.severity = severity
        self.htmlURL = htmlURL
        self.publishedAt = publishedAt
    }
}

/// One open Dependabot alert: a known vulnerability in a dependency the repository declares.
public struct DependabotAlert: Sendable, Equatable, Identifiable {
    /// The alert number, unique within the repository.
    public let id: Int
    public let packageName: String
    public let ecosystem: String
    public let severity: SecurityAdvisory.Severity
    /// The first version that fixes the vulnerability, or `nil` when GitHub doesn't know one yet.
    public let patchedVersion: String?
    public let htmlURL: URL

    public init(id: Int, packageName: String, ecosystem: String, severity: SecurityAdvisory.Severity,
                patchedVersion: String?, htmlURL: URL) {
        self.id = id
        self.packageName = packageName
        self.ecosystem = ecosystem
        self.severity = severity
        self.patchedVersion = patchedVersion
        self.htmlURL = htmlURL
    }
}
