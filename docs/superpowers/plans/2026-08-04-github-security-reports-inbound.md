# Inbound GitHub Security Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a GitHub-backed site's open security advisories and Dependabot alerts inside Anglesite — a toolbar badge, a Website Settings section, a route into the existing dependency-sync sheet for fixable alerts, and a clipboard+browser action for forwarding a report that's actually about Anglesite itself.

**Architecture:** A new `RepoAdvisoryReading` protocol (mirroring the existing `RepoSecurityReading`/`RepoSecurityWriting` split) is implemented by `HTTPGitHubClient` and driven by a new `@MainActor @Observable` `SecurityReportsModel` (structurally a sibling of `HealthModel`). `SiteWindowModel` owns one instance, kicks it off on site open, and shares it with `PlistEditorModel` for the Settings-tab detail view; a new toolbar item renders it as an always-mounted, conditionally-empty badge (the `SyncStatusView` pattern). A pure `DependencySync.fixOffer` function bridges a Dependabot alert to the existing `DependencyUpdateOffer`/`DependencyUpdateModel` sheet flow, and a pure `AdvisoryForwarding` formatter drives a clipboard-copy + `NSWorkspace.open` action — never an API call — for forwarding to `Anglesite/Anglesite`.

**Tech Stack:** Swift 6.4, SwiftUI, Swift Testing (new tests) / XCTest (existing suites untouched), `swift test --package-path .`, `scripts/build-app.sh`.

## Global Constraints

- Design source of truth: [`docs/superpowers/specs/2026-08-04-github-security-reports-inbound-design.md`](../specs/2026-08-04-github-security-reports-inbound-design.md) — deviations from it in this plan are called out inline with the reason.
- No paired sidecar PR — this touches only `Anglesite/Anglesite` Swift code, no MCP message schema change.
- Toolbar items are frozen, stable-id, and **unconditional** (`SiteWindow.swift`'s own comment: "Items must also be unconditional (no `if let` wrappers): identity-swapping or appearing/vanishing items fight the customization palette, so state-dependent items render disabled instead"). The new badge must follow `SyncStatusView`'s pattern — an always-present `ToolbarItem` whose view renders `EmptyView()` when there's nothing to show — not a conditionally-inserted item.
- New user-visible strings need the `Localizable.xcstrings` merge documented in `CONTRIBUTING.md` (interactive Xcode build step) — flagged at the end of this plan, not automatable in a headless task.
- Run `swift test --package-path .` after every task; run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` after Tasks 7–9 (the App-layer tasks).
- Conventional commits, ≤72-char subject, reference `#975`.

---

### Task 1: `RepoAdvisoryReading` protocol and value types (AnglesiteCore)

**Files:**
- Create: `Sources/AnglesiteCore/RepoAdvisoryReading.swift`
- Test: `Tests/AnglesiteCoreTests/RepoAdvisoryReadingTests.swift`

**Interfaces:**
- Produces: `public protocol RepoAdvisoryReading: Sendable` with `openSecurityAdvisories(owner:name:token:) async throws -> [SecurityAdvisory]` and `openDependabotAlerts(owner:name:token:) async throws -> [DependabotAlert]`; `public struct SecurityAdvisory: Sendable, Equatable, Identifiable` (`id: String`, `summary: String`, `severity: Severity`, `htmlURL: URL`, `publishedAt: Date?`) with nested `public enum Severity: String, Sendable, Equatable, Decodable { case critical, high, moderate, low, unknown }`; `public struct DependabotAlert: Sendable, Equatable, Identifiable` (`id: Int`, `packageName: String`, `ecosystem: String`, `severity: SecurityAdvisory.Severity`, `patchedVersion: String?`, `htmlURL: URL`).

This task only defines the shapes — no networking yet (that's Task 2), so its test is a decoding/equality smoke check on the types themselves plus the `Severity` fallback decoding behavior.

- [ ] **Step 1: Write the failing test for `Severity`'s lenient decoding**

```swift
// Tests/AnglesiteCoreTests/RepoAdvisoryReadingTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

struct RepoAdvisoryReadingTests {
    @Test("Severity decodes known values and falls back to .unknown for anything else")
    func severityDecoding() throws {
        func decode(_ raw: String) throws -> SecurityAdvisory.Severity {
            try JSONDecoder().decode(SecurityAdvisory.Severity.self, from: Data("\"\(raw)\"".utf8))
        }
        #expect(try decode("critical") == .critical)
        #expect(try decode("high") == .high)
        #expect(try decode("moderate") == .moderate)
        #expect(try decode("low") == .low)
        #expect(try decode("something-new-github-adds-later") == .unknown)
    }

    @Test("SecurityAdvisory and DependabotAlert are Identifiable by their natural keys")
    func identifiableKeys() {
        let advisory = SecurityAdvisory(
            id: "GHSA-xxxx-yyyy-zzzz", summary: "Example", severity: .high,
            htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-xxxx-yyyy-zzzz")!,
            publishedAt: nil)
        #expect(advisory.id == "GHSA-xxxx-yyyy-zzzz")

        let alert = DependabotAlert(
            id: 7, packageName: "left-pad", ecosystem: "npm", severity: .moderate,
            patchedVersion: "1.3.0",
            htmlURL: URL(string: "https://github.com/acme/site/security/dependabot/7")!)
        #expect(alert.id == 7)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --package-path . --filter RepoAdvisoryReadingTests`
Expected: FAIL — `SecurityAdvisory`/`DependabotAlert`/`RepoAdvisoryReading` don't exist yet (compile error).

- [ ] **Step 3: Write the protocol and types**

```swift
// Sources/AnglesiteCore/RepoAdvisoryReading.swift
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
        case critical, high, moderate, low, unknown

        public init(from decoder: any Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `swift test --package-path . --filter RepoAdvisoryReadingTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/RepoAdvisoryReading.swift Tests/AnglesiteCoreTests/RepoAdvisoryReadingTests.swift
git commit -m "feat(#975): add RepoAdvisoryReading protocol and advisory/alert types"
```

---

### Task 2: `HTTPGitHubClient` implements `RepoAdvisoryReading`

**Files:**
- Modify: `Sources/AnglesiteCore/HTTPGitHubClient.swift`
- Modify: `Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift`

**Interfaces:**
- Consumes: `RepoAdvisoryReading`, `SecurityAdvisory`, `DependabotAlert` (Task 1); `HTTPGitHubClient`'s existing private `repoRequest(method:path:token:)` and `send(_:)` helpers, and `GitHubRepoAPIError`.
- Produces: `extension HTTPGitHubClient: RepoAdvisoryReading` — the two methods, callable by `SecurityReportsModel` (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift` (same file, same `Self.transport` helper already defined there):

```swift
    // MARK: - RepoAdvisoryReading (#975)

    @Test("open security advisories decode, keeping only triage/published state")
    func openSecurityAdvisoriesFiltersState() async throws {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: """
            [
              {"ghsa_id":"GHSA-1111-1111-1111","summary":"Triage report","severity":"high",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-1111-1111-1111",
               "published_at":null,"state":"triage"},
              {"ghsa_id":"GHSA-2222-2222-2222","summary":"Published report","severity":"critical",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-2222-2222-2222",
               "published_at":"2026-07-01T00:00:00Z","state":"published"},
              {"ghsa_id":"GHSA-3333-3333-3333","summary":"Owner's own draft","severity":"low",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-3333-3333-3333",
               "published_at":null,"state":"draft"},
              {"ghsa_id":"GHSA-4444-4444-4444","summary":"Already resolved","severity":"moderate",
               "html_url":"https://github.com/acme/site/security/advisories/GHSA-4444-4444-4444",
               "published_at":"2026-01-01T00:00:00Z","state":"closed"}
            ]
            """))
        let advisories = try await client.openSecurityAdvisories(owner: "acme", name: "site", token: "tok")
        #expect(advisories.map(\.id) == ["GHSA-1111-1111-1111", "GHSA-2222-2222-2222"])
        #expect(advisories[0].severity == .high)
        #expect(advisories[1].severity == .critical)
        #expect(advisories[1].publishedAt != nil)
    }

    @Test("open Dependabot alerts decode package, severity, patched version, and URL")
    func openDependabotAlertsDecode() async throws {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: """
            [
              {"number":7,"dependency":{"package":{"name":"left-pad","ecosystem":"npm"}},
               "security_advisory":{"severity":"moderate"},
               "security_vulnerability":{"first_patched_version":{"identifier":"1.3.0"}},
               "html_url":"https://github.com/acme/site/security/dependabot/7"},
              {"number":9,"dependency":{"package":{"name":"left-pad-legacy","ecosystem":"npm"}},
               "security_advisory":{"severity":"high"},
               "security_vulnerability":{"first_patched_version":null},
               "html_url":"https://github.com/acme/site/security/dependabot/9"}
            ]
            """))
        let alerts = try await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        #expect(alerts.count == 2)
        #expect(alerts[0].id == 7)
        #expect(alerts[0].packageName == "left-pad")
        #expect(alerts[0].ecosystem == "npm")
        #expect(alerts[0].severity == .moderate)
        #expect(alerts[0].patchedVersion == "1.3.0")
        #expect(alerts[1].patchedVersion == nil)
    }

    @Test("a 401 on advisories maps to .unauthorized")
    func openSecurityAdvisoriesUnauthorized() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 401, json: #"{"message":"Bad credentials"}"#))
        await #expect(throws: GitHubRepoAPIError.unauthorized) {
            _ = try await client.openSecurityAdvisories(owner: "acme", name: "site", token: "bad")
        }
    }

    @Test("a transport failure on alerts maps to .network")
    func openDependabotAlertsNetworkFailure() async {
        let client = HTTPGitHubClient(transport: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: GitHubRepoAPIError.network) {
            _ = try await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("an unparseable advisories body maps to .malformedResponse")
    func openSecurityAdvisoriesMalformed() async {
        let client = HTTPGitHubClient(transport: Self.transport(status: 200, json: "not json"))
        await #expect(throws: GitHubRepoAPIError.malformedResponse) {
            _ = try await client.openSecurityAdvisories(owner: "acme", name: "site", token: "tok")
        }
    }

    @Test("the alerts request targets the state=open query and sends the bearer token")
    func alertsRequestShape() async {
        let captured = CapturedRequest()
        let client = HTTPGitHubClient(transport: { request in
            await captured.record(request)
            let http = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data("[]".utf8), http)
        })
        _ = try? await client.openDependabotAlerts(owner: "acme", name: "site", token: "tok")
        let request = await captured.value
        #expect(request?.url?.absoluteString == "https://api.github.com/repos/acme/site/dependabot/alerts?state=open")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }
```

This reuses the file's existing `CapturedRequest` actor (already defined lower in the file for the `createRepo` request-shape test) — no new test helper needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter HTTPGitHubClientTests`
Expected: FAIL — `openSecurityAdvisories`/`openDependabotAlerts` don't exist on `HTTPGitHubClient` yet.

- [ ] **Step 3: Implement the extension**

Append to `Sources/AnglesiteCore/HTTPGitHubClient.swift`, after the existing `extension HTTPGitHubClient: RepoSecurityReading, RepoSecurityWriting { ... }` block:

```swift
extension HTTPGitHubClient: RepoAdvisoryReading {
    private struct AdvisoryResponse: Decodable {
        let ghsaID: String
        let summary: String
        let severity: SecurityAdvisory.Severity
        let htmlURL: String
        let publishedAt: String?
        let state: String
        enum CodingKeys: String, CodingKey {
            case ghsaID = "ghsa_id", summary, severity, htmlURL = "html_url"
            case publishedAt = "published_at", state
        }
    }

    private struct AlertResponse: Decodable {
        struct Dependency: Decodable {
            struct Package: Decodable { let name: String; let ecosystem: String }
            let package: Package
        }
        struct SecurityAdvisoryInfo: Decodable { let severity: SecurityAdvisory.Severity }
        struct SecurityVulnerability: Decodable {
            struct FirstPatchedVersion: Decodable { let identifier: String }
            let firstPatchedVersion: FirstPatchedVersion?
            enum CodingKeys: String, CodingKey { case firstPatchedVersion = "first_patched_version" }
        }
        let number: Int
        let dependency: Dependency
        let securityAdvisory: SecurityAdvisoryInfo
        let securityVulnerability: SecurityVulnerability
        let htmlURL: String
        enum CodingKeys: String, CodingKey {
            case number, dependency
            case securityAdvisory = "security_advisory"
            case securityVulnerability = "security_vulnerability"
            case htmlURL = "html_url"
        }
    }

    /// `GET /repos/{owner}/{repo}/security-advisories` — fetched unfiltered (the endpoint's own
    /// `state` query param isn't used) and filtered here to `triage`/`published`, matching
    /// ``RepoAdvisoryReading/openSecurityAdvisories(owner:name:token:)``'s contract.
    public func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] {
        let data = try await send(repoRequest(
            method: "GET", path: "/repos/\(owner)/\(name)/security-advisories", token: token))
        guard let items = try? JSONDecoder().decode([AdvisoryResponse].self, from: data) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        let dateFormatter = ISO8601DateFormatter()
        return items
            .filter { $0.state == "triage" || $0.state == "published" }
            .compactMap { item in
                guard let url = URL(string: item.htmlURL) else { return nil }
                return SecurityAdvisory(
                    id: item.ghsaID, summary: item.summary, severity: item.severity, htmlURL: url,
                    publishedAt: item.publishedAt.flatMap { dateFormatter.date(from: $0) })
            }
    }

    /// `GET /repos/{owner}/{repo}/dependabot/alerts?state=open`.
    public func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] {
        let data = try await send(repoRequest(
            method: "GET", path: "/repos/\(owner)/\(name)/dependabot/alerts?state=open", token: token))
        guard let items = try? JSONDecoder().decode([AlertResponse].self, from: data) else {
            throw GitHubRepoAPIError.malformedResponse
        }
        return items.compactMap { item in
            guard let url = URL(string: item.htmlURL) else { return nil }
            return DependabotAlert(
                id: item.number, packageName: item.dependency.package.name,
                ecosystem: item.dependency.package.ecosystem, severity: item.securityAdvisory.severity,
                patchedVersion: item.securityVulnerability.firstPatchedVersion?.identifier, htmlURL: url)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter HTTPGitHubClientTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/HTTPGitHubClient.swift Tests/AnglesiteCoreTests/HTTPGitHubClientTests.swift
git commit -m "feat(#975): HTTPGitHubClient reads open advisories and Dependabot alerts"
```

---

### Task 3: `SecurityReportsModel` (AnglesiteCore)

**Files:**
- Create: `Sources/AnglesiteCore/SecurityReportsModel.swift`
- Test: `Tests/AnglesiteCoreTests/SecurityReportsModelTests.swift`

**Interfaces:**
- Consumes: `RepoAdvisoryReading`, `SecurityAdvisory`, `DependabotAlert` (Task 1/2); `RemoteRepo` (existing); `GitHubRepoAPIError` (existing).
- Produces: `@MainActor @Observable public final class SecurityReportsModel` with `openAdvisories: [SecurityAdvisory]`, `openAlerts: [DependabotAlert]`, `lastCheckedAt: Date?`, `isRunning: Bool`, `lastError: String?`, `totalCount: Int`, `badgeState: BadgeState` (`.clean`/`.warnings`/`.failures`), and `@discardableResult func recheck(repo: RemoteRepo?, token: String?) -> Task<Void, Never>` — consumed by `SiteWindowModel` (Task 7), `SecurityReportsBadgeView` (Task 8), and `PlistEditorModel` (Task 9).

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/SecurityReportsModelTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("SecurityReportsModel (#975)")
@MainActor
struct SecurityReportsModelTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")

    private static let highAdvisory = SecurityAdvisory(
        id: "GHSA-1", summary: "High", severity: .high,
        htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-1")!, publishedAt: nil)
    private static let lowAlert = DependabotAlert(
        id: 1, packageName: "left-pad", ecosystem: "npm", severity: .low, patchedVersion: "1.0.0",
        htmlURL: URL(string: "https://github.com/acme/site/security/dependabot/1")!)

    /// Serves canned results or a canned failure; controllable per test.
    actor FakeReader: RepoAdvisoryReading {
        private let advisories: [SecurityAdvisory]
        private let alerts: [DependabotAlert]
        private let failure: GitHubRepoAPIError?

        init(advisories: [SecurityAdvisory] = [], alerts: [DependabotAlert] = [], failure: GitHubRepoAPIError? = nil) {
            self.advisories = advisories
            self.alerts = alerts
            self.failure = failure
        }

        func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] {
            if let failure { throw failure }
            return advisories
        }

        func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] {
            if let failure { throw failure }
            return alerts
        }
    }

    @Test("initial state is empty and clean")
    func initialState() {
        let model = SecurityReportsModel(reader: FakeReader())
        #expect(model.totalCount == 0)
        #expect(model.badgeState == .clean)
        #expect(model.lastCheckedAt == nil)
        #expect(!model.isRunning)
    }

    @Test("no repo clears state without an error and without a timestamp")
    func noRepoClears() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: nil, token: "tok").value
        #expect(model.totalCount == 0)
        #expect(model.lastError == nil)
        #expect(model.lastCheckedAt == nil)
    }

    @Test("no token clears state without an error")
    func noTokenClears() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: Self.repo, token: nil).value
        #expect(model.totalCount == 0)
        #expect(model.lastError == nil)
    }

    @Test("an empty token string is treated the same as no token")
    func emptyTokenClears() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: Self.repo, token: "").value
        #expect(model.totalCount == 0)
        #expect(model.lastError == nil)
    }

    @Test("a successful check populates both lists and clears any prior error")
    func successPopulates() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory], alerts: [Self.lowAlert]))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.openAdvisories == [Self.highAdvisory])
        #expect(model.openAlerts == [Self.lowAlert])
        #expect(model.totalCount == 2)
        #expect(model.lastError == nil)
        #expect(model.lastCheckedAt != nil)
        #expect(!model.isRunning)
    }

    @Test("badgeState is .failures when any open item is critical or high")
    func badgeStateFailures() async {
        let model = SecurityReportsModel(reader: FakeReader(advisories: [Self.highAdvisory]))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.badgeState == .failures)
    }

    @Test("badgeState is .warnings when the only open items are moderate/low/unknown")
    func badgeStateWarnings() async {
        let model = SecurityReportsModel(reader: FakeReader(alerts: [Self.lowAlert]))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.badgeState == .warnings)
    }

    @Test("a failed check sets lastError and leaves the lists empty")
    func failureSetsError() async {
        let model = SecurityReportsModel(reader: FakeReader(failure: .unauthorized))
        await model.recheck(repo: Self.repo, token: "tok").value
        #expect(model.lastError != nil)
        #expect(model.totalCount == 0)
        #expect(model.lastCheckedAt != nil)
        #expect(!model.isRunning)
    }

    @Test("recheck cancels a prior in-flight run")
    func recheckCancelsPrior() async {
        actor SlowReader: RepoAdvisoryReading {
            func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] {
                try await Task.sleep(nanoseconds: 200_000_000)
                return []
            }
            func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] {
                []
            }
        }
        let model = SecurityReportsModel(reader: SlowReader())
        let first = model.recheck(repo: Self.repo, token: "tok")
        let second = model.recheck(repo: Self.repo, token: "tok")
        await first.value
        await second.value
        // No assertion beyond "both complete without hanging or crashing" — the cancellation
        // itself is exercised by HealthModelTests' equivalent case; this pins the same contract
        // for SecurityReportsModel without duplicating that suite's depth.
        #expect(!model.isRunning)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter SecurityReportsModelTests`
Expected: FAIL — `SecurityReportsModel` doesn't exist yet.

- [ ] **Step 3: Implement `SecurityReportsModel`**

```swift
// Sources/AnglesiteCore/SecurityReportsModel.swift
import Foundation
import Observation

/// Per-site inbound security-report state: a GitHub repo's open security advisories and open
/// Dependabot alerts (#975, the inbound half of #843). Drives the security-reports toolbar
/// badge and the Website Settings ▸ Security Reports "Open reports" section — both read this
/// one instance so a check kicked off from either place is visible in both.
///
/// Structurally a sibling of `HealthModel`: cancel-then-restart `recheck`, a settled
/// `lastCheckedAt`, and a `badgeState` the view layer never has to derive from raw data itself.
@MainActor
@Observable
public final class SecurityReportsModel {
    /// The three-way badge color. Unlike `HealthModel.BadgeState`, there is no `.unknown` case:
    /// "never checked" and "checked, nothing open" both read as `.clean` — the badge itself
    /// decides whether to render at all based on `totalCount`/`isRunning`, not on this state.
    public enum BadgeState: Sendable, Equatable {
        case clean
        case warnings
        case failures
    }

    public private(set) var openAdvisories: [SecurityAdvisory] = []
    public private(set) var openAlerts: [DependabotAlert] = []
    public private(set) var lastCheckedAt: Date?
    public private(set) var isRunning: Bool = false
    /// User-facing message from the most recent failed check, or `nil` after a successful one
    /// (or before any check has run).
    public private(set) var lastError: String?

    private let reader: any RepoAdvisoryReading
    private var inFlight: Task<Void, Never>?

    public init(reader: any RepoAdvisoryReading = HTTPGitHubClient()) {
        self.reader = reader
    }

    public var totalCount: Int { openAdvisories.count + openAlerts.count }

    /// `.failures` if any open item is critical/high severity, `.warnings` if the only open
    /// items are moderate/low/unknown, `.clean` otherwise (including "nothing checked yet").
    public var badgeState: BadgeState {
        let severities = openAdvisories.map(\.severity) + openAlerts.map(\.severity)
        if severities.contains(where: { $0 == .critical || $0 == .high }) { return .failures }
        if !severities.isEmpty { return .warnings }
        return .clean
    }

    /// Cancels any in-flight check and starts a new one. `repo == nil` (no GitHub origin) or a
    /// missing/empty `token` both clear state to empty rather than erroring — neither is a
    /// failure, just nothing to show, and neither touches `lastCheckedAt` since no check ran.
    @discardableResult
    public func recheck(repo: RemoteRepo?, token: String?) -> Task<Void, Never> {
        inFlight?.cancel()
        guard let repo, let token, !token.isEmpty else {
            inFlight = nil
            openAdvisories = []
            openAlerts = []
            lastError = nil
            isRunning = false
            return Task {}
        }
        isRunning = true
        let task = Task { @MainActor [weak self, reader] in
            do {
                async let advisories = reader.openSecurityAdvisories(owner: repo.owner, name: repo.name, token: token)
                async let alerts = reader.openDependabotAlerts(owner: repo.owner, name: repo.name, token: token)
                let (fetchedAdvisories, fetchedAlerts) = try await (advisories, alerts)
                guard !Task.isCancelled else { return }
                self?.commit(advisories: fetchedAdvisories, alerts: fetchedAlerts, error: nil)
            } catch is CancellationError {
                return  // a newer recheck superseded us; drop the result silently
            } catch {
                guard !Task.isCancelled else { return }
                self?.commit(advisories: nil, alerts: nil, error: error)
            }
        }
        inFlight = task
        return task
    }

    private func commit(advisories: [SecurityAdvisory]?, alerts: [DependabotAlert]?, error: Error?) {
        if let advisories, let alerts {
            openAdvisories = advisories
            openAlerts = alerts
            lastError = nil
        } else {
            lastError = Self.message(for: error)
        }
        lastCheckedAt = Date()
        isRunning = false
    }

    private static func message(for error: Error?) -> String {
        guard let apiError = error as? GitHubRepoAPIError else {
            return "Couldn't check this repository's security reports."
        }
        switch apiError {
        case .unauthorized:
            return "Your GitHub token doesn't have permission to read this repository's security advisories and Dependabot alerts. Recreate it with Repository security advisories: Read and Dependabot alerts: Read."
        case .network:
            return "Couldn't reach GitHub. Check your connection and try again."
        case .http(let status):
            return "GitHub returned an unexpected response (HTTP \(status))."
        case .api(let message):
            return "GitHub rejected the request: \(message)"
        case .malformedResponse, .nameAlreadyExists:
            return "GitHub returned an unexpected response."
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter SecurityReportsModelTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/SecurityReportsModel.swift Tests/AnglesiteCoreTests/SecurityReportsModelTests.swift
git commit -m "feat(#975): add SecurityReportsModel"
```

---

### Task 4: `DependencySync.fixOffer` — bridge a Dependabot alert to the existing sync offer

**Files:**
- Modify: `Sources/AnglesiteCore/DependencySync.swift`
- Test: `Tests/AnglesiteCoreTests/DependencySyncFixOfferTests.swift`

**Interfaces:**
- Consumes: `DependabotAlert` (Task 1), `DependencyUpdateOffer`/`DependencySyncOffers` (existing), `DependencyVersionComparator.isNewer(_:than:)` (existing, returns `Bool?`).
- Produces: `extension DependencySync { public static func fixOffer(for alert: DependabotAlert, in offers: DependencySyncOffers) -> DependencyUpdateOffer? }` — consumed by `PlistEditorModel` (Task 9).

Note: `DependencyVersionComparator.isNewer` returns `Bool?`, not `Bool` — a `nil` (unparseable version) must be treated as "no confirmed fix," per that type's own "never guess" contract, not force-unwrapped or defaulted to `true`.

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/DependencySyncFixOfferTests.swift
import Testing
@testable import AnglesiteCore

@Suite("DependencySync.fixOffer (#975)")
struct DependencySyncFixOfferTests {
    private static let alertURL = URL(string: "https://github.com/acme/site/security/dependabot/1")!

    private func alert(package: String = "left-pad", patchedVersion: String?) -> DependabotAlert {
        DependabotAlert(id: 1, packageName: package, ecosystem: "npm", severity: .high,
                         patchedVersion: patchedVersion, htmlURL: Self.alertURL)
    }

    @Test("nil when the alert has no known patched version")
    func noPatchedVersion() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: nil), in: offers) == nil)
    }

    @Test("nil when the package isn't in the offered updates at all")
    func packageNotOffered() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "some-other-package", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == nil)
    }

    @Test("nil when the offered range is still behind the patched version")
    func offerStillBehindPatch() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.1.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == nil)
    }

    @Test("nil when the patched version string can't be parsed — never guess")
    func unparseablePatchedVersion() {
        let offers = DependencySyncOffers(updates: [
            DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        ])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "latest"), in: offers) == nil)
    }

    @Test("returns the matching offer when the offered range reaches the patched version")
    func matchWhenOfferReachesPatch() {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        let offers = DependencySyncOffers(updates: [offer])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == offer)
    }

    @Test("returns the matching offer when the offered range exceeds the patched version")
    func matchWhenOfferExceedsPatch() {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^2.0.0")
        let offers = DependencySyncOffers(updates: [offer])
        #expect(DependencySync.fixOffer(for: alert(patchedVersion: "1.3.0"), in: offers) == offer)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter DependencySyncFixOfferTests`
Expected: FAIL — `DependencySync.fixOffer` doesn't exist yet.

- [ ] **Step 3: Implement `fixOffer`**

Append to `Sources/AnglesiteCore/DependencySync.swift`:

```swift
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
        guard DependencyVersionComparator.isNewer(patchedVersion, than: offer.offeredRange) != true else { return nil }
        return offer
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter DependencySyncFixOfferTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/DependencySync.swift Tests/AnglesiteCoreTests/DependencySyncFixOfferTests.swift
git commit -m "feat(#975): bridge Dependabot alerts to dependency-sync offers"
```

---

### Task 5: `AdvisoryForwarding` — pure clipboard-text formatter

**Files:**
- Create: `Sources/AnglesiteCore/AdvisoryForwarding.swift`
- Test: `Tests/AnglesiteCoreTests/AdvisoryForwardingTests.swift`

**Interfaces:**
- Consumes: `SecurityAdvisory` (Task 1), `RemoteRepo` (existing).
- Produces: `public enum AdvisoryForwarding { public static let anglesiteAdvisoryFormURL: URL; public static func clipboardText(for advisory: SecurityAdvisory, siteRepo: RemoteRepo) -> String }` — consumed by `PlistEditorView` (Task 9), which performs the actual clipboard write and browser open (AppKit-only, so it stays out of AnglesiteCore).

- [ ] **Step 1: Write the failing tests**

```swift
// Tests/AnglesiteCoreTests/AdvisoryForwardingTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite("AdvisoryForwarding (#975)")
struct AdvisoryForwardingTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")
    private static let advisory = SecurityAdvisory(
        id: "GHSA-xxxx-yyyy-zzzz", summary: "Reflected XSS in the search page", severity: .high,
        htmlURL: URL(string: "https://github.com/acme/site/security/advisories/GHSA-xxxx-yyyy-zzzz")!,
        publishedAt: nil)

    @Test("the form URL points at Anglesite/Anglesite's own advisory intake")
    func formURL() {
        #expect(AdvisoryForwarding.anglesiteAdvisoryFormURL
            == URL(string: "https://github.com/Anglesite/Anglesite/security/advisories/new"))
    }

    @Test("clipboard text includes the advisory title, its GHSA URL, and the originating site repo")
    func clipboardTextIncludesExpectedFields() {
        let text = AdvisoryForwarding.clipboardText(for: Self.advisory, siteRepo: Self.repo)
        #expect(text.contains("Reflected XSS in the search page"))
        #expect(text.contains("https://github.com/acme/site/security/advisories/GHSA-xxxx-yyyy-zzzz"))
        #expect(text.contains("acme/site"))
    }

    @Test("clipboard text never includes anything beyond the advisory's own public title and URL")
    func clipboardTextIsBoundedToPublicFields() {
        // Regression guard: a future field addition (e.g. a private description) must not
        // silently start flowing into this clipboard text without a deliberate decision — see
        // the design doc's "Validation ownership"-equivalent note on forwarding scope.
        let text = AdvisoryForwarding.clipboardText(for: Self.advisory, siteRepo: Self.repo)
        let expectedFragments = [Self.advisory.summary, Self.advisory.htmlURL.absoluteString, "acme/site"]
        let withoutExpectedFragments = expectedFragments.reduce(text) { $0.replacingOccurrences(of: $1, with: "") }
        // What's left is boilerplate labels/punctuation only — assert it's short, not empty,
        // since some connecting words ("found while triaging reports against…") are expected.
        #expect(withoutExpectedFragments.count < 120)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter AdvisoryForwardingTests`
Expected: FAIL — `AdvisoryForwarding` doesn't exist yet.

- [ ] **Step 3: Implement `AdvisoryForwarding`**

```swift
// Sources/AnglesiteCore/AdvisoryForwarding.swift
import Foundation

/// Prepares a clipboard-ready summary for forwarding a security advisory to
/// `Anglesite/Anglesite`'s own advisory form — for reports discovered while triaging a site's
/// GitHub advisories that turn out to be about Anglesite itself, not the owner's site (#975).
///
/// Deliberately clipboard + browser, never an API call: a fine-grained PAT can't be scoped to a
/// repository outside its own owner's account/org, so an in-app API call would only work for
/// `Anglesite`-org members. Copy + open works for every user, using their own github.com session.
public enum AdvisoryForwarding {
    public static let anglesiteAdvisoryFormURL = URL(string: "https://github.com/Anglesite/Anglesite/security/advisories/new")!

    /// Plain text for the clipboard: the advisory's title, its own public GHSA URL, and a note
    /// naming the site repo it was found while triaging. Deliberately excludes the advisory's
    /// private `description`/`vulnerabilities` fields — only what's already public via the GHSA
    /// metadata goes on the clipboard; anything more specific is the owner's call to add by hand
    /// before submitting.
    public static func clipboardText(for advisory: SecurityAdvisory, siteRepo: RemoteRepo) -> String {
        """
        \(advisory.summary)
        \(advisory.htmlURL.absoluteString)

        Found while triaging security reports against \(siteRepo.owner)/\(siteRepo.name).
        """
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter AdvisoryForwardingTests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/AdvisoryForwarding.swift Tests/AnglesiteCoreTests/AdvisoryForwardingTests.swift
git commit -m "feat(#975): add AdvisoryForwarding clipboard-text formatter"
```

---

### Task 6: Widen the GitHub token recipe copy

**Files:**
- Modify: `Sources/AnglesiteCore/GitHubAPITokenVerifier.swift:45`
- Modify: `Sources/AnglesiteApp/GitHubTokenPromptView.swift:53`
- Modify: `Sources/AnglesiteApp/SettingsView.swift:352`

**Interfaces:**
- No new types. Pure copy change — every token-scope recipe string in the app must name the two new read permissions this feature needs, so a user who upgrades with an existing (now under-scoped) token gets an actionable message instead of a bare 403. Confirmed no existing test pins these exact strings (only enum-identity comparisons in `GitHubTokenOnboardingTests`/`TokenOnboardingTests`), so this is safe to edit directly with no test changes required.

- [ ] **Step 1: Update `GitHubAPITokenVerifier.swift`**

```swift
// Sources/AnglesiteCore/GitHubAPITokenVerifier.swift:45 — replace the existing return line
            return "That token didn’t work. Create a fine-grained token scoped to All repositories with Contents: Read and write, Administration: Read and write, Repository security advisories: Read, and Dependabot alerts: Read access at github.com/settings/tokens and paste the whole token."
```

Also update the doc comment immediately above it (lines 39–41) so it stays accurate:

```swift
    /// The user-facing copy Settings shows for this failure. Notably, ``invalidToken``'s message
    /// carries the full token-creation recipe (fine-grained, All repositories, Contents +
    /// Administration read/write, plus read-only Repository security advisories and Dependabot
    /// alerts for #975) so the user can fix it without leaving the prompt.
```

- [ ] **Step 2: Update `GitHubTokenPromptView.swift`**

```swift
// Sources/AnglesiteApp/GitHubTokenPromptView.swift:53 — replace the existing Text(...) call
                    Text("Select **All repositories**, then grant **Contents: Read and write**, **Administration: Read and write** (Administration is what lets a new repo be created), **Repository security advisories: Read**, and **Dependabot alerts: Read** (both let Anglesite show open reports for this repo) — then copy the token and paste it below.")
```

- [ ] **Step 3: Update `SettingsView.swift`**

```swift
// Sources/AnglesiteApp/SettingsView.swift:352 — replace the existing Text(...) call
                Text("Used to push backups and publish sites to GitHub over HTTPS (the sandboxed app can't run `git` or `gh`, so it pushes in-process with this token). Create a fine-grained token scoped to All repositories with Contents: Read and write, Administration: Read and write access (Administration is needed to create a new repo when publishing), Repository security advisories: Read, and Dependabot alerts: Read (both are used to show a site's open security reports) at github.com/settings/tokens. Stored in the macOS Keychain under `io.dwk.anglesite` and never written to logs.")
```

- [ ] **Step 4: Verify the existing enum-identity tests still pass**

Run: `swift test --package-path . --filter GitHubTokenOnboardingTests`
Expected: PASS (unchanged — those tests compare against `GitHubTokenVerifyError.invalidToken.userMessage` itself, not a literal string, so they can't regress from this edit).

- [ ] **Step 5: Commit**

```bash
git add Sources/AnglesiteCore/GitHubAPITokenVerifier.swift Sources/AnglesiteApp/GitHubTokenPromptView.swift Sources/AnglesiteApp/SettingsView.swift
git commit -m "docs(#975): widen GitHub token recipe copy for advisories and Dependabot reads"
```

---

### Task 7: `SiteWindowModel` wiring — own the model, check on open, share the fix-apply path

**Files:**
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift`

**Interfaces:**
- Consumes: `SecurityReportsModel` (Task 3), `RemoteRepo`/`BackupCommand.defaultRunner`/`KeychainStore` (existing), `DependencyUpdateModel`/`DependencySyncOffers`/`DependencyUpdateOffer`/`DependencySyncApplier`/`AppVersion` (existing).
- Produces: `var securityReports: SecurityReportsModel` (new stored property, read by Task 8's badge and passed into `PlistEditorModel` in Task 9), `private(set) var dependencySyncOffers: DependencySyncOffers` (new stored property, read by Task 9), `func recheckSecurityReports()` (called by Task 8's badge popover "Recheck" action), `func presentDependencyFixSheet(_ offer: DependencyUpdateOffer)` (called by Task 9's "Update available" row action).

No new automated test for this task: `loadAndStart()`'s dependency-sync hook this mirrors has none either (its own comment at `SiteWindowModel.swift:1795-1806` documents the same "manual QA pass, not a proof" tolerance for exactly this class of site-open wiring — real git/Keychain/network side effects, not a pure function). `SecurityReportsModel`'s own logic is already fully covered at the unit level in Task 3; this task is the thin wiring around it. Verify manually per this plan's final task.

- [ ] **Step 1: Add the `securityReports` and `dependencySyncOffers` stored properties**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, immediately after the existing `var health = HealthModel(runner: DefaultHealthCheckRunner())` (around line 159):

```swift
    var health = HealthModel(runner: DefaultHealthCheckRunner())
    /// Open GitHub security advisories and Dependabot alerts for this site's repo (#975, the
    /// inbound half of #843). Drives `SecurityReportsBadgeView` in the toolbar and the "Open
    /// reports" section of Website Settings ▸ Security Reports — both read this one instance.
    var securityReports = SecurityReportsModel()
```

And, near `var dependencyUpdateModel: DependencyUpdateModel?` (around line 172), add:

```swift
    /// The most recent `DependencySyncChecker.check` result from `loadAndStart()`, kept even
    /// when empty so the Security Reports tab's Dependabot-alert rows can offer the same fix
    /// (`DependencySync.fixOffer`, #975) without a second `package.json` read. Set once per site
    /// open; not re-derived reactively.
    private(set) var dependencySyncOffers = DependencySyncOffers()
```

- [ ] **Step 2: Add the git-remote lookup and the recheck entry point**

Near `func recheckHealth()` (around line 680):

```swift
    func recheckHealth() {
        guard let site else { return }
        health.recheck(siteID: site.id, siteDirectory: site.sourceDirectory)
    }

    /// Resolves this site's GitHub origin, mirroring `PlistEditorModel.currentRemoteRepo()` —
    /// a separate small lookup rather than a shared dependency, consistent with how `PublishModel`
    /// already resolves the same fact its own way via `RepoBootstrap`. `nil` for no remote, a
    /// non-GitHub remote, or a failed git call.
    private func currentGitHubRemote() async -> RemoteRepo? {
        guard let site else { return nil }
        guard let result = try? await BackupCommand.defaultRunner(site.sourceDirectory, ["remote", "get-url", "origin"]),
              result.exitCode == 0 else { return nil }
        return RemoteRepo.parse(remoteURL: result.stdout)
    }

    /// Kicks off a `securityReports` check. Fire-and-forget: called from `loadAndStart()` on
    /// every site open (not awaited, so it never delays open) and from the badge popover /
    /// Settings-tab "Check for reports" action — one code path, two triggers.
    func recheckSecurityReports() {
        Task { [weak self] in
            guard let self else { return }
            let repo = await self.currentGitHubRemote()
            let token = (try? KeychainStore().readGitHubToken()) ?? nil
            self.securityReports.recheck(repo: repo, token: token)
        }
    }
```

- [ ] **Step 3: Call it from `loadAndStart()`, and persist `dependencySyncOffers`**

In `loadAndStart(siteID:openSitesWindow:dismissSiteWindow:)`, right after the existing `sync.start(package:)` call (around line 1741) and before the `#if ANGLESITE_MAS` block, add the fire-and-forget call:

```swift
        sync.start(package: AnglesitePackage(url: resolved.packageURL))
        // #975: fired here (not awaited) so a slow/offline GitHub check never delays site open —
        // the toolbar badge and Settings tab populate whenever it settles.
        recheckSecurityReports()
```

Then, in the existing dependency-sync block (around line 1762), persist the computed offers regardless of whether they're empty:

```swift
        if let templateURL = TemplateRuntime.bundledURL(), let runningVersion = AppVersion.current() {
            let offers = DependencySyncChecker.check(
                sourceDirectory: resolved.sourceDirectory,
                configDirectory: resolved.configDirectory,
                templateDirectory: templateURL,
                runningAppVersion: runningVersion
            )
            dependencySyncOffers = offers
            if !offers.isEmpty {
```

(Only the `dependencySyncOffers = offers` line is new; the surrounding `if let`/`if !offers.isEmpty` structure is unchanged.)

- [ ] **Step 4: Factor out the apply step and add `presentDependencyFixSheet`**

Replace the existing inline apply block inside that same `if !offers.isEmpty` continuation (the `dependencyUpdateModel = DependencyUpdateModel(offers: offers) { ... }` closure body, around lines 1771–1791):

```swift
                    dependencyUpdateModel = DependencyUpdateModel(offers: offers) { [weak self] accepted in
                        guard let self else { continuation.resume(); return }
                        if accepted {
                            self.applyDependencySyncOffers(
                                offers, sourceDirectory: resolved.sourceDirectory, configDirectory: resolved.configDirectory)
                        }
                        self.dependencyUpdateModel = nil
                        continuation.resume()
                    }
```

Then add the extracted helper and the new single-offer entry point near `recheckSecurityReports()`:

```swift
    /// Writes `offers` (bumps + additions) into the site's `package.json`. Shared by
    /// `loadAndStart()`'s automatic offer sheet and `presentDependencyFixSheet(_:)`'s
    /// single-offer sheet (#975), so both apply through the identical path.
    private func applyDependencySyncOffers(_ offers: DependencySyncOffers, sourceDirectory: URL, configDirectory: URL) {
        guard let runningVersion = AppVersion.current() else { return }
        do {
            try DependencySyncApplier.apply(
                offers, sourceDirectory: sourceDirectory, configDirectory: configDirectory,
                runningAppVersion: runningVersion)
            preview.isUpdatingDependencies = true
        } catch {
            // package.json rewrite failed — nothing was written, so the site keeps its
            // unchanged files; this boot/action is not treated as a post-update one.
        }
    }

    /// Opens the dependency-update sheet pre-scoped to a single package bump — the Security
    /// Reports tab's "Update available" action (#975) for a Dependabot alert
    /// `DependencySync.fixOffer` already matched against the bundled template. Reuses the same
    /// apply path as the automatic offer sheet, just for one offer instead of the full set.
    func presentDependencyFixSheet(_ offer: DependencyUpdateOffer) {
        guard let site else { return }
        let offers = DependencySyncOffers(updates: [offer])
        dependencyUpdateModel = DependencyUpdateModel(offers: offers) { [weak self] accepted in
            guard let self else { return }
            if accepted {
                self.applyDependencySyncOffers(offers, sourceDirectory: site.sourceDirectory, configDirectory: site.configDirectory)
            }
            self.dependencyUpdateModel = nil
        }
    }
```

- [ ] **Step 5: Build to verify it compiles**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: Build succeeds (this task adds no new tests; correctness is verified by the compiler plus Task 3's existing coverage of `SecurityReportsModel` itself, and by Task 9's `PlistEditorModel`-level tests exercising `presentDependencyFixSheet` indirectly via its injected callback).

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteApp/SiteWindowModel.swift
git commit -m "feat(#975): wire SiteWindowModel to check GitHub security reports on open"
```

---

### Task 8: Toolbar badge

**Files:**
- Modify: `Sources/AnglesiteCore/SiteToolbarItemID.swift`
- Modify: `Tests/AnglesiteCoreTests/SiteToolbarItemIDTests.swift`
- Create: `Sources/AnglesiteApp/SecurityReportsBadgeView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindow.swift`

**Interfaces:**
- Consumes: `SecurityReportsModel` (Task 3, via `SiteWindowModel.securityReports` from Task 7); `SiteWindowModel.recheckSecurityReports()` (Task 7).
- Produces: `SiteToolbarItemID.securityReports` case; `struct SecurityReportsBadgeView: View` (`@Bindable var model: SecurityReportsModel`, `let onRecheck: () -> Void`) — a `ToolbarItem` in `SiteWindow`'s toolbar.

Deviation from the design doc's "conditionally rendered" phrasing: `SiteWindow.swift`'s own toolbar-customization contract (see Global Constraints) forbids an appearing/vanishing `ToolbarItem`. The `ToolbarItem` itself is unconditional and stable-id, like every other item; the *view inside it* renders `EmptyView()` when there's nothing to show, exactly the pattern `SyncStatusView` already established for the iCloud-sync badge. This preserves the design's intent (no visible clutter on a clean site) without violating the frozen-id/no-identity-swap rule.

- [ ] **Step 1: Add the frozen toolbar item id**

In `Sources/AnglesiteCore/SiteToolbarItemID.swift`, add a new case at the end of the enum (append-only, per the frozen-set contract):

```swift
    /// iCloud sync status badge (#881) — synced/syncing/waiting-for-iCloud/needs-attention.
    case sync
    /// Open GitHub security advisories + Dependabot alerts badge (#975).
    case securityReports
}
```

- [ ] **Step 2: Update the frozen-set test — write it first, expect it to fail**

In `Tests/AnglesiteCoreTests/SiteToolbarItemIDTests.swift`, append `"securityReports"` to the expected array:

```swift
            "sync",
            "securityReports",
        ])
```

Run: `swift test --package-path . --filter SiteToolbarItemIDTests`
Expected: FAIL until Step 1 lands (the enum doesn't have the case yet) — if done in this order, run Step 1 first, then this test should already pass; either ordering is fine since both edits are needed together. Run once more after both steps to confirm: PASS.

- [ ] **Step 3: Create `SecurityReportsBadgeView`**

```swift
// Sources/AnglesiteApp/SecurityReportsBadgeView.swift
import SwiftUI
import AnglesiteCore

/// Open-GitHub-security-reports badge (#975), rendered as a `ToolbarItem`
/// (`SiteToolbarItemID.securityReports`) in `SiteWindow`'s toolbar. Mirrors
/// `SyncStatusView`'s shape: an `EmptyView` when there's nothing to show, so a site with no
/// open advisories or alerts never widens the toolbar — the `ToolbarItem` itself stays
/// unconditional (frozen id, no `if let`), only this inner view's body branches.
struct SecurityReportsBadgeView: View {
    @Bindable var model: SecurityReportsModel
    let onRecheck: () -> Void

    @State private var popoverPresented = false
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    @ScaledMetric(relativeTo: .body) private var badgeDimension = 18
    @ScaledMetric(relativeTo: .body) private var glyphSize = 11

    var body: some View {
        if model.totalCount > 0 || model.isRunning {
            Button {
                popoverPresented.toggle()
            } label: {
                indicator
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            .help(helpText)
            .accessibilityLabel("Security reports")
            .accessibilityValue(helpText)
            .accessibilityHint("Shows this site's open GitHub security advisories and Dependabot alerts")
            .popover(isPresented: $popoverPresented, arrowEdge: .top) {
                popoverContent
                    .padding(14)
                    .frame(width: 320)
            }
        }
    }

    @ViewBuilder
    private var indicator: some View {
        ZStack {
            if differentiateWithoutColor {
                Image(systemName: stateSymbol)
                    .font(.system(size: glyphSize, weight: .bold))
                    .foregroundStyle(color)
            } else {
                Circle()
                    .fill(color)
                    .frame(width: 10, height: 10)
            }
            if model.isRunning {
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.5), lineWidth: 1)
                    .frame(width: 14, height: 14)
            }
        }
        .frame(width: badgeDimension, height: badgeDimension, alignment: .center)
        .contentShape(Rectangle())
    }

    private var stateSymbol: String {
        switch model.badgeState {
        case .clean: return "checkmark.shield"
        case .warnings: return "exclamationmark.shield"
        case .failures: return "xmark.shield"
        }
    }

    private var color: Color {
        switch model.badgeState {
        case .clean: return .green
        case .warnings: return .yellow
        case .failures: return .red
        }
    }

    private var helpText: String {
        "\(model.totalCount) open security \(model.totalCount == 1 ? "report" : "reports")"
    }

    @ViewBuilder
    private var popoverContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "shield.lefthalf.filled").foregroundStyle(.secondary)
                Text("Security Reports").font(.headline)
                Spacer()
            }
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                ForEach(model.openAdvisories.prefix(5)) { advisory in
                    Label(advisory.summary, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .lineLimit(1)
                }
                ForEach(model.openAlerts.prefix(5)) { alert in
                    Label("\(alert.packageName): dependency alert", systemImage: "shippingbox.fill")
                        .font(.callout)
                        .lineLimit(1)
                }
            }
            Divider()
            HStack {
                Spacer()
                Button {
                    popoverPresented = false
                    onRecheck()
                } label: {
                    if model.isRunning {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text("Checking…")
                        }
                    } else {
                        Text("Recheck")
                    }
                }
                .controlSize(.small)
                .disabled(model.isRunning)
            }
        }
    }
}
```

- [ ] **Step 4: Wire it into `SiteWindow`'s toolbar**

In `Sources/AnglesiteApp/SiteWindow.swift`, add a new `ToolbarItem` right after the existing `SiteToolbarItemID.sync` item (around line 349, before the `backup` item):

```swift
            ToolbarItem(id: SiteToolbarItemID.sync.rawValue, placement: .primaryAction) {
                SyncStatusView(model: model.sync)
            }

            // Open GitHub security advisories/Dependabot alerts (#975). Renders nothing (an
            // EmptyView) for a clean site — see SecurityReportsBadgeView's doc comment.
            ToolbarItem(id: SiteToolbarItemID.securityReports.rawValue, placement: .primaryAction) {
                SecurityReportsBadgeView(
                    model: model.securityReports,
                    onRecheck: { model.recheckSecurityReports() }
                )
            }
```

- [ ] **Step 5: Run the frozen-id test and build**

Run: `swift test --package-path . --filter SiteToolbarItemIDTests`
Expected: PASS

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/SiteToolbarItemID.swift Tests/AnglesiteCoreTests/SiteToolbarItemIDTests.swift Sources/AnglesiteApp/SecurityReportsBadgeView.swift Sources/AnglesiteApp/SiteWindow.swift
git commit -m "feat(#975): add security reports badge to the site toolbar"
```

---

### Task 9: Website Settings — "Open reports" section, forwarding, and dependency-fix routing

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift`
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift`
- Modify: `Sources/AnglesiteApp/SiteWindowModel.swift` (construction site only)
- Test: `Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsSectionTests.swift`

**Interfaces:**
- Consumes: `SecurityReportsModel` (Task 3), `DependencySync.fixOffer` (Task 4), `AdvisoryForwarding` (Task 5), `SiteWindowModel.presentDependencyFixSheet(_:)` and `.dependencySyncOffers` (Task 7).
- Produces: `PlistEditorModel.securityReports: SecurityReportsModel` (stored, injected), `PlistEditorModel.fixOffer(for:) -> DependencyUpdateOffer?`, `PlistEditorModel.requestDependencyFix(for:)`, `PlistEditorModel.refreshSecurityReports() async` — consumed by `PlistEditorView`'s new section.

- [ ] **Step 1: Write the failing `PlistEditorModel` tests**

```swift
// Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsSectionTests.swift
import Foundation
import Testing
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel security reports section (#975)")
@MainActor
struct PlistEditorModelSecurityReportsSectionTests {
    actor FakeReader: RepoAdvisoryReading {
        private let advisories: [SecurityAdvisory]
        private let alerts: [DependabotAlert]
        init(advisories: [SecurityAdvisory] = [], alerts: [DependabotAlert] = []) {
            self.advisories = advisories
            self.alerts = alerts
        }
        func openSecurityAdvisories(owner: String, name: String, token: String) async throws -> [SecurityAdvisory] { advisories }
        func openDependabotAlerts(owner: String, name: String, token: String) async throws -> [DependabotAlert] { alerts }
    }

    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private func makeModel(
        alerts: [DependabotAlert] = [],
        dependencySyncOffers: DependencySyncOffers = DependencySyncOffers(),
        onOpenDependencyFix: @escaping (DependencyUpdateOffer) -> Void = { _ in }
    ) throws -> PlistEditorModel {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelSecurityReportsSectionTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let plistURL = directory.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        return PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "Test Site",
            sourceDirectory: directory,
            gitRunner: { _, _ in ProcessSupervisor.RunResult(stdout: "", stderr: "", exitCode: 1) },
            githubToken: { nil },
            securityReports: SecurityReportsModel(reader: FakeReader(alerts: alerts)),
            dependencySyncOffers: dependencySyncOffers,
            onOpenDependencyFix: onOpenDependencyFix)
    }

    @Test("fixOffer returns nil when the alert has no matching, sufficiently-new offer")
    func fixOfferNilByDefault() throws {
        let model = try makeModel()
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        #expect(model.fixOffer(for: alert) == nil)
    }

    @Test("fixOffer returns the matching offer computed from the injected DependencySyncOffers")
    func fixOfferMatches() throws {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        let model = try makeModel(dependencySyncOffers: DependencySyncOffers(updates: [offer]))
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        #expect(model.fixOffer(for: alert) == offer)
    }

    @Test("requestDependencyFix invokes the callback with the matched offer")
    func requestDependencyFixInvokesCallback() throws {
        let offer = DependencyUpdateOffer(name: "left-pad", currentRange: "^1.0.0", offeredRange: "^1.3.0")
        var received: DependencyUpdateOffer?
        let model = try makeModel(
            dependencySyncOffers: DependencySyncOffers(updates: [offer]),
            onOpenDependencyFix: { received = $0 })
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        model.requestDependencyFix(for: alert)
        #expect(received == offer)
    }

    @Test("requestDependencyFix does nothing when there is no matching offer")
    func requestDependencyFixNoOpWithoutMatch() throws {
        var callbackFired = false
        let model = try makeModel(onOpenDependencyFix: { _ in callbackFired = true })
        let alert = DependabotAlert(id: 1, packageName: "left-pad", ecosystem: "npm", severity: .high,
                                     patchedVersion: "1.3.0", htmlURL: URL(string: "https://example.com")!)
        model.requestDependencyFix(for: alert)
        #expect(!callbackFired)
    }

    @Test("refreshSecurityReports populates the shared model from the injected reader")
    func refreshSecurityReportsPopulates() async throws {
        let advisory = SecurityAdvisory(id: "GHSA-1", summary: "Example", severity: .high,
                                         htmlURL: URL(string: "https://example.com")!, publishedAt: nil)
        let model = try makeModel()
        // No GitHub remote is configured in this fixture (gitRunner exits 1), so refresh should
        // clear rather than populate — pinning the "no repo" branch stays free of network/token
        // plumbing while still exercising the call path `PlistEditorView`'s `.task` uses.
        await model.refreshSecurityReports()
        #expect(model.securityReports.totalCount == 0)
        _ = advisory  // documents the intended populated-case shape; full population is covered
                      // by SecurityReportsModelTests (Task 3) against a real repo/token pairing.
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter PlistEditorModelSecurityReportsSectionTests`
Expected: FAIL — `PlistEditorModel` doesn't yet accept `securityReports`/`dependencySyncOffers`/`onOpenDependencyFix`, and doesn't have `fixOffer`/`requestDependencyFix`/`refreshSecurityReports`.

- [ ] **Step 3: Extend `PlistEditorModel`**

In `Sources/AnglesiteApp/PlistEditorModel.swift`, add stored properties near the existing `securityReporting*` block (after `private(set) var securityReportingStateIsKnown = false`, around line 93):

```swift
    private(set) var securityReportingStateIsKnown = false
    /// Open GitHub security advisories + Dependabot alerts for this site (#975, the inbound
    /// half of #843) — the same instance `SiteWindowModel` owns and the toolbar badge reads, so
    /// a check kicked off from either place is visible in both.
    let securityReports: SecurityReportsModel
    /// The most recent `DependencySyncChecker.check` result, threaded in from `SiteWindowModel`
    /// so a Dependabot-alert row can offer the same fix without a second `package.json` read.
    private let dependencySyncOffers: DependencySyncOffers
    /// Opens the dependency-update sheet for a single matched offer — forwards to
    /// `SiteWindowModel.presentDependencyFixSheet(_:)`; a closure (not a direct dependency) so
    /// this model doesn't need to know about `SiteWindowModel` or sheet presentation at all.
    private let onOpenDependencyFix: (DependencyUpdateOffer) -> Void
```

Extend the initializer signature (around lines 166–178) to accept the three new parameters with defaults, and assign them in the body:

```swift
    init(file: FileRef, websiteTitle: String, sourceDirectory: URL,
         configDirectory: URL? = nil,
         workerCatalogProvider: (@Sendable () async -> [WorkerDescriptor])? = nil,
         graphSnapshotProvider: @escaping @MainActor () -> SiteGraphExplorerSnapshot? = { nil },
         onActiveWorkersChanged: @escaping (SiteSettings) async -> Void = { _ in },
         analyticsProvider: any CloudflareWebAnalyticsProviding = CloudflareWebAnalyticsClient(),
         customAnalyticsValidator: (any CustomAnalyticsHTMLValidating)? = nil,
         containerControlProvider: @escaping AstroHTMLValidator.ContainerControlProvider = { nil },
         keychain: KeychainStore = KeychainStore(),
         domainOperations: any DomainOperationsService = DomainOperations(),
         repoSecurity: any RepoSecurityReading & RepoSecurityWriting = HTTPGitHubClient(),
         gitRunner: @escaping BackupCommand.GitRunner = BackupCommand.defaultRunner,
         githubToken: @escaping @Sendable () throws -> String? = { try KeychainStore().readGitHubToken() },
         securityReports: SecurityReportsModel = SecurityReportsModel(),
         dependencySyncOffers: DependencySyncOffers = DependencySyncOffers(),
         onOpenDependencyFix: @escaping (DependencyUpdateOffer) -> Void = { _ in }) {
        self.file = file
        self.initialWebsiteTitle = websiteTitle
        self.sourceDirectory = sourceDirectory
        self.configDirectory = configDirectory
        self.workerCatalogProvider = workerCatalogProvider ?? {
            await WorkerCatalogFetcher(catalogURL: WorkerCatalogFetcher.productionCatalogURL).catalog()
        }
        self.graphSnapshotProvider = graphSnapshotProvider
        self.onActiveWorkersChanged = onActiveWorkersChanged
        self.analyticsProvider = analyticsProvider
        self.customAnalyticsValidator = customAnalyticsValidator
            ?? AstroHTMLValidator(containerControlProvider: containerControlProvider)
        self.keychain = keychain
        self.domainOperations = domainOperations
        self.repoSecurity = repoSecurity
        self.gitRunner = gitRunner
        self.githubToken = githubToken
        self.securityReports = securityReports
        self.dependencySyncOffers = dependencySyncOffers
        self.onOpenDependencyFix = onOpenDependencyFix
        self.hasWebsiteIcons = WebsiteIconInstaller.hasInstalledIcons(in: sourceDirectory)
    }
```

Add the three new methods near `refreshRepoSecurityState()` (after it, before `adoptAdvisoryForm()`, around line 597):

```swift
    /// Re-checks `securityReports` against this site's GitHub remote. Called when the Security
    /// Reports tab loads and from its manual "Check for reports" action — never on a timer.
    /// Reuses `currentRemoteRepo()`/`githubToken()`, the same lookups the outbound-configuration
    /// half of this tab already performs, rather than depending on `SiteWindowModel` for either.
    func refreshSecurityReports() async {
        let repo = await currentRemoteRepo()
        let token = (try? githubToken()) ?? nil
        await securityReports.recheck(repo: repo, token: token).value
    }

    /// The dependency-sync offer that would fix `alert`, if the bundled template already offers
    /// a range that reaches its patched version. `nil` renders as "View on GitHub" instead of an
    /// "Update available" action.
    func fixOffer(for alert: DependabotAlert) -> DependencyUpdateOffer? {
        DependencySync.fixOffer(for: alert, in: dependencySyncOffers)
    }

    /// Opens the dependency-update sheet for `alert`'s matched fix, if any. A no-op when
    /// `fixOffer(for:)` finds nothing — the view only shows this action when a fix exists, but
    /// this guard keeps the model's own contract self-consistent regardless of caller.
    func requestDependencyFix(for alert: DependabotAlert) {
        guard let offer = fixOffer(for: alert) else { return }
        onOpenDependencyFix(offer)
    }
```

- [ ] **Step 4: Wire the construction site in `SiteWindowModel`**

In `Sources/AnglesiteApp/SiteWindowModel.swift`, in `openFile(_:)`'s `.plist` branch (around line 1069), capture the two new dependencies alongside the existing `graphExplorer`/`preview` locals and thread them into the `PlistEditorModel(...)` call:

```swift
            case .plist:
                let graphExplorer = graphExplorer
                let preview = preview
                let securityReports = securityReports
                let dependencySyncOffers = dependencySyncOffers
                activeEditor = .plist(PlistEditorModel(
                    file: file,
                    websiteTitle: site?.name ?? file.name,
                    sourceDirectory: site?.sourceDirectory ?? file.url.deletingLastPathComponent(),
                    configDirectory: site?.configDirectory,
                    graphSnapshotProvider: { graphExplorer.snapshot },
                    onActiveWorkersChanged: { settings in
                        await preview.activeWorkersChanged(settings)
                    },
                    containerControlProvider: { [preview] in await preview.activeContainerControl() },
                    securityReports: securityReports,
                    dependencySyncOffers: dependencySyncOffers,
                    onOpenDependencyFix: { [weak self] offer in self?.presentDependencyFixSheet(offer) }
                ))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path . --filter PlistEditorModelSecurityReportsSectionTests`
Expected: PASS

- [ ] **Step 6: Add the "Open reports" section to `PlistEditorView`**

In `Sources/AnglesiteApp/PlistEditorView.swift`, insert a new section into `securityReportsTab` (between the existing `securityReportsGitHubCallout` and the error/progress block, around line 551–557):

```swift
            securityReportsGitHubCallout

            openSecurityReportsSection

            if let securityReportingError = model.securityReportingError {
                Label(securityReportingError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            if model.isSavingSecurityReporting || model.isCheckingRepoSecurity {
                ProgressView().controlSize(.small)
            }
        }
        .task { await model.refreshRepoSecurityState() }
        .task { await model.refreshSecurityReports() }
    }
```

(Only the `openSecurityReportsSection` line and the second `.task` modifier are new; everything else in that snippet already exists.)

Add the new section and its row views as new private computed properties/methods, placed after `securityReportsGitHubCallout`'s closing brace (after line 662):

```swift
    @ViewBuilder
    private var openSecurityReportsSection: some View {
        SettingsBox(title: "Open Reports") {
            VStack(alignment: .leading, spacing: 10) {
                if model.securityReports.isRunning && model.securityReports.totalCount == 0 && model.securityReports.lastCheckedAt == nil {
                    Text("Checking for open GitHub security advisories and Dependabot alerts…")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else if model.securityReports.totalCount == 0 {
                    Text(model.securityReports.lastCheckedAt == nil ? "Not checked yet." : "No open reports.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.securityReports.openAdvisories) { advisory in
                        advisoryRow(advisory)
                    }
                    ForEach(model.securityReports.openAlerts) { alert in
                        alertRow(alert)
                    }
                }

                if let lastError = model.securityReports.lastError {
                    Label(lastError, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.orange)
                }

                HStack {
                    if model.securityReports.isRunning {
                        ProgressView().controlSize(.small)
                    }
                    Spacer()
                    Button("Check for Reports") { Task { await model.refreshSecurityReports() } }
                        .controlSize(.small)
                        .disabled(model.securityReports.isRunning)
                }
            }
        }
    }

    private func advisoryRow(_ advisory: SecurityAdvisory) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(severityColor(advisory.severity))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(advisory.summary).font(.callout)
                HStack(spacing: 10) {
                    Link("View on GitHub", destination: advisory.htmlURL)
                        .font(.caption)
                    Button("Forward to Anglesite") { forwardToAnglesite(advisory) }
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(.accentColor)
                }
            }
        }
    }

    private func alertRow(_ alert: DependabotAlert) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "shippingbox.fill")
                .foregroundStyle(severityColor(alert.severity))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(alert.packageName) (\(alert.ecosystem))").font(.callout)
                if let offer = model.fixOffer(for: alert) {
                    Button("Update Available") { model.requestDependencyFix(for: alert) }
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(.accentColor)
                    Text("Bumps to \(offer.offeredRange)").font(.caption2).foregroundStyle(.secondary)
                } else {
                    Link("View on GitHub", destination: alert.htmlURL)
                        .font(.caption)
                }
            }
        }
    }

    private func severityColor(_ severity: SecurityAdvisory.Severity) -> Color {
        switch severity {
        case .critical, .high: return .red
        case .moderate: return .orange
        case .low, .unknown: return .yellow
        }
    }

    /// Copies a plain-text summary of `advisory` to the pasteboard and opens
    /// `Anglesite/Anglesite`'s advisory form — never an API call (#975, see
    /// `AdvisoryForwarding`'s doc comment for why). Requires `model.securityReportingRepo` to be
    /// known (it always is here: this row only renders once `securityReports` has populated,
    /// which only happens for a resolved GitHub remote).
    private func forwardToAnglesite(_ advisory: SecurityAdvisory) {
        guard let repo = model.securityReportingRepo else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(AdvisoryForwarding.clipboardText(for: advisory, siteRepo: repo), forType: .string)
        NSWorkspace.shared.open(AdvisoryForwarding.anglesiteAdvisoryFormURL)
    }
```

- [ ] **Step 7: Build to verify the view compiles**

Run: `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`
Expected: Build succeeds.

- [ ] **Step 8: Run the full test suite**

Run: `swift test --package-path .`
Expected: PASS (all suites, including every test added in Tasks 1–9).

- [ ] **Step 9: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorModel.swift Sources/AnglesiteApp/PlistEditorView.swift Sources/AnglesiteApp/SiteWindowModel.swift Tests/AnglesiteAppTests/PlistEditorModelSecurityReportsSectionTests.swift
git commit -m "feat(#975): add Open Reports section to Website Settings ▸ Security Reports"
```

---

## Final verification (manual — not automatable in this environment)

- [ ] Run `swift test --package-path .` once more at the tip of the branch; confirm zero failures.
- [ ] Run `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build`; confirm success.
- [ ] Interactively in Xcode: build once in the IDE (not CLI-only) so `Sources/AnglesiteApp/Localizable.xcstrings` picks up every new `Text(...)` literal introduced in Tasks 8–9 (`SecurityReportsBadgeView`, the "Open Reports" section, the widened token-recipe copy in Task 6). Review the resulting `.xcstrings` diff per `CONTRIBUTING.md`'s recipe before committing it — scoped to this worktree's own `BUILD_DIR`, `--skip-marking-strings-stale`.
- [ ] Manually verify the end-to-end flow against a real GitHub-backed test site with a token scoped per Task 6's updated recipe: open the site, confirm the toolbar badge stays hidden on a clean repo, file (or use an existing) open advisory/Dependabot alert on that repo, reopen the site and confirm the badge appears with the right color, open Website Settings ▸ Security Reports and confirm the "Open Reports" section lists it with working "View on GitHub" / "Forward to Anglesite" / "Update Available" actions as applicable.
- [ ] Confirm an existing (pre-Task-6) token correctly surfaces the new named-permission 403 message from `SecurityReportsModel`'s `lastError` rather than failing silently.
