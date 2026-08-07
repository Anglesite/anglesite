# In-app analytics data viewing (Web Analytics / RUM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a 7-day Cloudflare Web Analytics (RUM) summary — total pageviews, total visits, and a daily trend — in Site Settings ▸ Analytics, for sites with Cloudflare Analytics enabled.

**Architecture:** A new `CloudflareRUMAnalyticsClient`/`CloudflareRUMAnalyticsProviding` pair in AnglesiteCore queries Cloudflare's GraphQL Analytics API (`rumPageloadEventsAdaptiveGroups`), independent of the existing `CloudflareWebAnalyticsClient` (which only resolves the `siteTag`). `PlistEditorModel` gets a `loadRUMSummary()` method wired to a new provider-injection point, fetching once when the Analytics tab appears. `PlistEditorView` renders the result as a small Swift Charts sparkline below the existing Cloudflare toggle.

**Tech Stack:** Swift 6.4, SwiftUI, Swift Charts (system framework, no new dependency), Swift Testing.

**Spec:** [`docs/superpowers/specs/2026-08-07-in-app-analytics-design.md`](../specs/2026-08-07-in-app-analytics-design.md)

## Global Constraints

- Swift/SwiftUI with Apple frameworks only — no third-party dependencies (spec §3, CONTRIBUTING.md).
- Fixed 7-day window, totals + daily trend only — no selectable ranges, no breakdowns, no polling (spec §2).
- Fetch on Analytics-tab appearance only — no manual refresh control (spec §4).
- New user-visible strings must go through CONTRIBUTING.md's String Catalog CLI-sync step.
- Errors must suppress the summary entirely (never a stale/zero-filled chart); an empty-but-successful response is a distinct "No traffic recorded" state, never conflated with an error (spec §4).
- Verify `app target builds` via `scripts/build-app.sh` before considering UI work done — `swift test` alone doesn't prove the app links (CONTRIBUTING.md, CLAUDE.md).

---

### Task 1: `CloudflareRUMAnalyticsClient` (AnglesiteCore)

**Files:**
- Create: `Sources/AnglesiteCore/CloudflareRUMAnalyticsClient.swift`
- Test: `Tests/AnglesiteCoreTests/CloudflareRUMAnalyticsClientTests.swift`

**Interfaces:**
- Produces (used by Task 2):
  ```swift
  public struct DailyCount: Sendable, Equatable {
      public let date: Date
      public let pageviews: Int
      public init(date: Date, pageviews: Int)
  }
  public struct RUMAnalyticsSummary: Sendable, Equatable {
      public let totalPageviews: Int
      public let totalVisits: Int
      public let dailyPageviews: [DailyCount]  // ascending by date
      public init(totalPageviews: Int, totalVisits: Int, dailyPageviews: [DailyCount])
  }
  public protocol CloudflareRUMAnalyticsProviding: Sendable {
      func summary(siteTag: String, apiToken: String, days: Int) async throws -> RUMAnalyticsSummary
  }
  public struct CloudflareRUMAnalyticsClient: CloudflareRUMAnalyticsProviding {
      public init(baseURL: URL = URL(string: "https://api.cloudflare.com/client/v4")!, urlSession: URLSession = .shared)
  }
  ```
- Consumes: `CloudflareWebAnalyticsError` (existing, `Sources/AnglesiteCore/CloudflareWebAnalyticsClient.swift`) for its `.noAccount`, `.invalidResponse`, `.api(String)` cases — this client throws those same cases rather than defining a parallel error type.

**Verify-before-build note (spec §3):** the exact GraphQL dimension field name for day-level grouping in `rumPageloadEventsAdaptiveGroups` was not confirmed against Cloudflare's live schema — only against the sibling `httpRequestsAdaptiveGroups` dataset's documented shape, which follows the same "Adaptive Groups" filter/aggregate conventions. The implementation below assumes a `dimensions { date }` field returning either a bare day (`"2026-08-01"`) or a full timestamp (`"2026-08-01T00:00:00Z"`), and decodes defensively for both. Step 3 below includes verifying this against Cloudflare's GraphiQL explorer (linked from `developers.cloudflare.com/analytics/graphql-api/getting-started/compose-graphql-query/`) with a real account token as part of finishing this task — adjust the `GraphQLResponse` nested types and `query` string if the live schema differs.

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteCoreTests/CloudflareRUMAnalyticsClientTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteCore

/// Routes each request to a canned status/body keyed by exact URL string — mirrors
/// `RDAPStubURLProtocol` (`RDAPClientTests.swift`): one fixed response per endpoint, since this
/// client always hits the same two URLs (`/accounts`, `/graphql`) rather than URLs that vary per
/// call.
private final class RUMAnalyticsStubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Stub { let statusCode: Int; let body: String }
    nonisolated(unsafe) static var responses: [String: Stub] = [:]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let key = request.url?.absoluteString ?? ""
        guard let stub = Self.responses[key] else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: stub.statusCode, httpVersion: "HTTP/1.1", headerFields: nil
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(stub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() { responses = [:] }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RUMAnalyticsStubURLProtocol.self]
        return URLSession(configuration: config)
    }
}

// .serialized: tests share RUMAnalyticsStubURLProtocol's mutable static response table, which
// would race under Swift Testing's default parallel execution.
@Suite(.serialized) struct CloudflareRUMAnalyticsClientTests {
    private let baseURL = URL(string: "https://example.invalid/client/v4")!
    private var accountsURL: String { "\(baseURL.absoluteString)/accounts" }
    private var graphqlURL: String { "\(baseURL.absoluteString)/graphql" }
    private let accountsJSON = #"{"result":[{"id":"acc1"}]}"#

    @Test("decodes a successful summary with full-timestamp dates")
    func decodesSummaryWithFullTimestampDates() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(statusCode: 200, body: """
            {"data":{"viewer":{"accounts":[{"rumPageloadEventsAdaptiveGroups":[
                {"count":100,"sum":{"visits":40},"dimensions":{"date":"2026-08-01T00:00:00Z"}},
                {"count":140,"sum":{"visits":60},"dimensions":{"date":"2026-08-02T00:00:00Z"}}
            ]}]}}}
            """)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        let summary = try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)

        #expect(summary.totalPageviews == 240)
        #expect(summary.totalVisits == 100)
        #expect(summary.dailyPageviews.map(\.pageviews) == [100, 140])
    }

    @Test("decodes a successful summary with bare-day dates")
    func decodesSummaryWithBareDayDates() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(statusCode: 200, body: """
            {"data":{"viewer":{"accounts":[{"rumPageloadEventsAdaptiveGroups":[
                {"count":10,"sum":{"visits":4},"dimensions":{"date":"2026-08-01"}}
            ]}]}}}
            """)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        let summary = try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)

        #expect(summary.totalPageviews == 10)
        #expect(summary.dailyPageviews.count == 1)
    }

    @Test("throws noAccount when the token has no Cloudflare account")
    func throwsWhenNoAccount() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: #"{"result":[]}"#)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        await #expect(throws: CloudflareWebAnalyticsError.noAccount) {
            try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)
        }
    }

    @Test("throws api error on a non-2xx GraphQL response")
    func throwsOnNon2xxResponse() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(
            statusCode: 403, body: #"{"errors":[{"message":"Invalid token"}]}"#)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        await #expect(throws: CloudflareWebAnalyticsError.api("Invalid token")) {
            try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)
        }
    }

    @Test("throws api error when a 200 response carries GraphQL-level errors")
    func throwsOnGraphQLLevelErrors() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(
            statusCode: 200, body: #"{"data":null,"errors":[{"message":"siteTag not found"}]}"#)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        await #expect(throws: CloudflareWebAnalyticsError.api("siteTag not found")) {
            try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)
        }
    }

    @Test("throws invalidResponse when the body doesn't decode")
    func throwsOnUndecodableBody() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(statusCode: 200, body: "not json")
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        await #expect(throws: CloudflareWebAnalyticsError.invalidResponse) {
            try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter CloudflareRUMAnalyticsClientTests`
Expected: FAIL to compile — `CloudflareRUMAnalyticsClient`, `CloudflareRUMAnalyticsProviding`, `RUMAnalyticsSummary`, `DailyCount` don't exist yet.

- [ ] **Step 3: Write the implementation**

Create `Sources/AnglesiteCore/CloudflareRUMAnalyticsClient.swift`:

```swift
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One day's pageview count within a ``RUMAnalyticsSummary``'s trend.
public struct DailyCount: Sendable, Equatable {
    public let date: Date
    public let pageviews: Int

    public init(date: Date, pageviews: Int) {
        self.date = date
        self.pageviews = pageviews
    }
}

/// A pageviews/visits summary for one Web Analytics (RUM) site over a recent window — the
/// in-app answer to "how's my traffic doing," with the Cloudflare dashboard (linked via
/// `WorkerDashboardLinks`) as the deep-dive destination for anything beyond a glance.
public struct RUMAnalyticsSummary: Sendable, Equatable {
    public let totalPageviews: Int
    public let totalVisits: Int
    /// Ascending by date, one entry per day the API returned data for.
    public let dailyPageviews: [DailyCount]

    public init(totalPageviews: Int, totalVisits: Int, dailyPageviews: [DailyCount]) {
        self.totalPageviews = totalPageviews
        self.totalVisits = totalVisits
        self.dailyPageviews = dailyPageviews
    }
}

/// Seam for fetching a Web Analytics (RUM) summary, so callers (the Analytics tab) can inject a
/// fake instead of hitting Cloudflare's GraphQL API in tests. Kept separate from
/// ``CloudflareWebAnalyticsProviding`` (site-tag resolution): that's a one-time REST lookup done
/// during onboarding, this is a repeated GraphQL query done on every Analytics tab view — two
/// different Cloudflare APIs with two different call shapes and cadences.
public protocol CloudflareRUMAnalyticsProviding: Sendable {
    /// Fetches a summary for the last `days` days for the Web Analytics site identified by
    /// `siteTag`.
    func summary(siteTag: String, apiToken: String, days: Int) async throws -> RUMAnalyticsSummary
}

/// Production ``CloudflareRUMAnalyticsProviding``: queries Cloudflare's GraphQL Analytics API
/// (`rumPageloadEventsAdaptiveGroups`) for a day-by-day pageviews/visits breakdown.
public struct CloudflareRUMAnalyticsClient: CloudflareRUMAnalyticsProviding {
    private let baseURL: URL
    private let urlSession: URLSession

    /// Both parameters exist for tests — point `baseURL` at a local stub server to exercise the
    /// real request/decode path. Production callers take the defaults.
    public init(baseURL: URL = URL(string: "https://api.cloudflare.com/client/v4")!,
                urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    public func summary(siteTag: String, apiToken: String, days: Int) async throws -> RUMAnalyticsSummary {
        let accounts = try await accounts(apiToken: apiToken)
        guard let accountID = accounts.first?.id else { throw CloudflareWebAnalyticsError.noAccount }

        let until = Date()
        let since = Calendar(identifier: .gregorian).date(byAdding: .day, value: -days, to: until) ?? until
        let isoFormatter = ISO8601DateFormatter()
        let body: [String: Any] = [
            "query": Self.query,
            "variables": [
                "accountTag": accountID,
                "siteTag": siteTag,
                "since": isoFormatter.string(from: since),
                "until": isoFormatter.string(from: until)
            ]
        ]
        let response: GraphQLResponse = try await post(path: "graphql", apiToken: apiToken, jsonBody: body)
        if let message = response.errors?.first?.message {
            throw CloudflareWebAnalyticsError.api(message)
        }
        guard let groups = response.data?.viewer.accounts.first?.rumPageloadEventsAdaptiveGroups else {
            throw CloudflareWebAnalyticsError.invalidResponse
        }
        let daily = groups.compactMap { group -> DailyCount? in
            guard let date = Self.parseDate(group.dimensions.date) else { return nil }
            return DailyCount(date: date, pageviews: group.count)
        }.sorted { $0.date < $1.date }
        return RUMAnalyticsSummary(
            totalPageviews: groups.reduce(0) { $0 + $1.count },
            totalVisits: groups.reduce(0) { $0 + $1.sum.visits },
            dailyPageviews: daily)
    }

    /// Cloudflare's GraphQL `Date`/`Time` scalars have shown up as both a bare day
    /// (`"2026-08-01"`) and a full timestamp (`"2026-08-01T00:00:00Z"`) across adaptive-groups
    /// datasets — this tries the full form first, then falls back to the bare day, so the client
    /// doesn't hard-fail if the live API returns the form this wasn't verified against (see the
    /// "Verify-before-build note" above).
    private static func parseDate(_ raw: String) -> Date? {
        if let date = ISO8601DateFormatter().date(from: raw) { return date }
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "yyyy-MM-dd"
        dayFormatter.timeZone = TimeZone(identifier: "UTC")
        return dayFormatter.date(from: raw)
    }

    private static let query = """
        query RUMSummary($accountTag: string!, $siteTag: string!, $since: Time!, $until: Time!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              rumPageloadEventsAdaptiveGroups(
                limit: 1000
                orderBy: [date_ASC]
                filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
              ) {
                count
                sum { visits }
                dimensions { date }
              }
            }
          }
        }
        """

    private func accounts(apiToken: String) async throws -> [Account] {
        let envelope: Envelope<[Account]> = try await get("accounts", apiToken: apiToken)
        return envelope.result
    }

    private func get<T: Decodable>(_ path: String, apiToken: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func post<T: Decodable>(path: String, apiToken: String, jsonBody: [String: Any]) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: jsonBody)
        return try await send(request)
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await urlSession.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let message = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data).errors.first?.message)
                ?? "Cloudflare API request failed with HTTP \(http.statusCode)."
            throw CloudflareWebAnalyticsError.api(message)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw CloudflareWebAnalyticsError.invalidResponse
        }
    }

    private struct Envelope<Result: Decodable>: Decodable {
        let result: Result
    }

    private struct ErrorEnvelope: Decodable {
        let errors: [APIError]
    }

    private struct APIError: Decodable {
        let message: String
    }

    private struct Account: Decodable {
        let id: String
    }

    private struct GraphQLResponse: Decodable {
        struct DataBody: Decodable {
            struct Viewer: Decodable {
                struct AccountNode: Decodable {
                    let rumPageloadEventsAdaptiveGroups: [Group]
                }
                let accounts: [AccountNode]
            }
            let viewer: Viewer
        }
        struct Group: Decodable {
            struct Sum: Decodable { let visits: Int }
            struct Dimensions: Decodable { let date: String }
            let count: Int
            let sum: Sum
            let dimensions: Dimensions
        }
        struct GraphQLError: Decodable { let message: String }
        let data: DataBody?
        let errors: [GraphQLError]?
    }
}
```

Note the `errors` decode in `throwsOnGraphQLLevelErrors` above hits the top-level `GraphQLResponse.errors` field (a 200 response can still carry GraphQL-level errors with `data: null`) — this is checked before the `guard let groups = ...` line, so a `null` `data` field never reaches the `invalidResponse` fallback for this case.

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path . --filter CloudflareRUMAnalyticsClientTests`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Verify the live GraphQL schema and adjust if needed**

Using a real Cloudflare account token with Web Analytics enabled for at least one site, open Cloudflare's GraphiQL explorer (linked from `https://developers.cloudflare.com/analytics/graphql-api/getting-started/compose-graphql-query/`) and run the `query` string from `CloudflareRUMAnalyticsClient.query` (substituting real `accountTag`/`siteTag`/`since`/`until` values). Confirm the `dimensions { date }` field exists and returns a value in one of the two forms `parseDate` handles. If the live schema differs (a different field name, a different date format), update `Self.query` and `GraphQLResponse`'s nested types to match, then re-run Step 4's tests with matching fixture JSON before proceeding.

- [ ] **Step 6: Commit**

```bash
git add Sources/AnglesiteCore/CloudflareRUMAnalyticsClient.swift Tests/AnglesiteCoreTests/CloudflareRUMAnalyticsClientTests.swift
git commit -m "feat(core): add CloudflareRUMAnalyticsClient for Web Analytics summaries (#1114)"
```

---

### Task 2: Wire `loadRUMSummary()` into `PlistEditorModel`

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorModel.swift:11` (stored property), `:25` (state vars), `:216` (init param), `:238` (init body), after `:846` (new method)
- Test: `Tests/AnglesiteAppTests/PlistEditorModelRUMAnalyticsTests.swift`

**Interfaces:**
- Consumes: `CloudflareRUMAnalyticsProviding`, `CloudflareRUMAnalyticsClient`, `RUMAnalyticsSummary`, `DailyCount` (Task 1); existing `PlistEditorModel.cloudflareAnalyticsEnabled: Bool`, `analyticsSettings.cloudflareToken: String` (the resolved siteTag), and the existing private `cloudflareToken() async throws -> String?` method.
- Produces (used by Task 3):
  ```swift
  private(set) var rumSummary: RUMAnalyticsSummary?
  private(set) var isLoadingRUMSummary: Bool
  private(set) var rumSummaryError: String?
  func loadRUMSummary() async
  ```

- [ ] **Step 1: Write the failing tests**

Create `Tests/AnglesiteAppTests/PlistEditorModelRUMAnalyticsTests.swift`:

```swift
import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

@Suite("PlistEditorModel RUM analytics summary (#1114)")
@MainActor
struct PlistEditorModelRUMAnalyticsTests {
    private static let emptyPlist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict/></plist>
        """

    private struct FakeRUMAnalyticsProvider: CloudflareRUMAnalyticsProviding {
        let result: Result<RUMAnalyticsSummary, Error>
        func summary(siteTag: String, apiToken: String, days: Int) async throws -> RUMAnalyticsSummary {
            try result.get()
        }
    }

    private struct Fixture {
        let model: PlistEditorModel
    }

    private func makeFixture(
        token: String? = "test-token",
        siteTag: String = "",
        rumResult: Result<RUMAnalyticsSummary, Error> = .success(
            RUMAnalyticsSummary(totalPageviews: 100, totalVisits: 40, dailyPageviews: []))
    ) async throws -> Fixture {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlistEditorModelRUMAnalyticsTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDir = dir.appendingPathComponent("Source", isDirectory: true)
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let plistURL = sourceDir.appendingPathComponent("Info.plist")
        try Self.emptyPlist.write(to: plistURL, atomically: true, encoding: .utf8)
        let keychainService = "io.dwk.anglesite.test-\(UUID().uuidString)"
        let keychain = KeychainStore(service: keychainService)
        if let token {
            try keychain.writeCloudflareToken(token)
        }
        let model = PlistEditorModel(
            file: FileRef(url: plistURL, group: .metadata, name: "Info.plist"),
            websiteTitle: "My Test Site",
            sourceDirectory: sourceDir,
            configDirectory: configDir,
            rumAnalyticsProvider: FakeRUMAnalyticsProvider(result: rumResult),
            keychain: keychain)
        model.analyticsSettings.cloudflareToken = siteTag
        return Fixture(model: model)
    }

    @Test("loadRUMSummary does nothing when Cloudflare Analytics is not enabled")
    func skipsWhenAnalyticsDisabled() async throws {
        let fixture = try await makeFixture(siteTag: "")

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == nil)
        #expect(fixture.model.rumSummaryError == nil)
    }

    @Test("loadRUMSummary populates rumSummary on success")
    func populatesSummaryOnSuccess() async throws {
        let summary = RUMAnalyticsSummary(
            totalPageviews: 240, totalVisits: 90,
            dailyPageviews: [DailyCount(date: Date(timeIntervalSince1970: 0), pageviews: 240)])
        let fixture = try await makeFixture(siteTag: "site-tag-1", rumResult: .success(summary))

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == summary)
        #expect(fixture.model.rumSummaryError == nil)
    }

    @Test("loadRUMSummary surfaces a provider error and clears any prior summary")
    func surfacesProviderError() async throws {
        let fixture = try await makeFixture(
            siteTag: "site-tag-1",
            rumResult: .failure(CloudflareWebAnalyticsError.api("boom")))

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == nil)
        #expect(fixture.model.rumSummaryError == "boom")
    }

    @Test("loadRUMSummary surfaces missingToken when no Cloudflare token is configured",
          .enabled(if: ProcessInfo.processInfo.environment["CLOUDFLARE_API_TOKEN"] == nil))
    func surfacesMissingToken() async throws {
        let fixture = try await makeFixture(token: nil, siteTag: "site-tag-1")

        await fixture.model.loadRUMSummary()

        #expect(fixture.model.rumSummary == nil)
        #expect(fixture.model.rumSummaryError == CloudflareWebAnalyticsError.missingToken.localizedDescription)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path . --filter PlistEditorModelRUMAnalyticsTests`
Expected: FAIL to compile — `rumAnalyticsProvider` init param, `loadRUMSummary()`, `rumSummary`, `rumSummaryError` don't exist yet.

- [ ] **Step 3: Add the stored property and state**

In `Sources/AnglesiteApp/PlistEditorModel.swift`, change:

```swift
    private let analyticsProvider: any CloudflareWebAnalyticsProviding
    private let customAnalyticsValidator: any CustomAnalyticsHTMLValidating
```

to:

```swift
    private let analyticsProvider: any CloudflareWebAnalyticsProviding
    private let rumAnalyticsProvider: any CloudflareRUMAnalyticsProviding
    private let customAnalyticsValidator: any CustomAnalyticsHTMLValidating
```

and change:

```swift
    private(set) var isSavingAnalytics = false
    private(set) var isConfiguringCloudflareAnalytics = false
```

to:

```swift
    private(set) var isSavingAnalytics = false
    private(set) var isConfiguringCloudflareAnalytics = false
    private(set) var isLoadingRUMSummary = false
    private(set) var rumSummary: RUMAnalyticsSummary?
    private(set) var rumSummaryError: String?
```

- [ ] **Step 4: Wire the init parameter**

Change:

```swift
         analyticsProvider: any CloudflareWebAnalyticsProviding = CloudflareWebAnalyticsClient(),
         customAnalyticsValidator: (any CustomAnalyticsHTMLValidating)? = nil,
```

to:

```swift
         analyticsProvider: any CloudflareWebAnalyticsProviding = CloudflareWebAnalyticsClient(),
         rumAnalyticsProvider: any CloudflareRUMAnalyticsProviding = CloudflareRUMAnalyticsClient(),
         customAnalyticsValidator: (any CustomAnalyticsHTMLValidating)? = nil,
```

and in the init body, change:

```swift
        self.analyticsProvider = analyticsProvider
```

to:

```swift
        self.analyticsProvider = analyticsProvider
        self.rumAnalyticsProvider = rumAnalyticsProvider
```

- [ ] **Step 5: Add `loadRUMSummary()`**

Immediately after the closing brace of `setCloudflareAnalyticsEnabled(_:)` (the method ending just before `/// Also returns the raw \`.site-config\` contents...`), add:

```swift
    /// Fetches the last 7 days' pageviews/visits summary for the Analytics tab (#1114). A no-op
    /// when Cloudflare Analytics isn't enabled for this site — there's no siteTag to query. A
    /// thrown error clears any prior summary rather than leaving a stale one on screen.
    func loadRUMSummary() async {
        guard cloudflareAnalyticsEnabled else { return }
        guard !isLoadingRUMSummary else { return }
        isLoadingRUMSummary = true
        rumSummaryError = nil
        defer { isLoadingRUMSummary = false }
        do {
            guard let token = try await cloudflareToken(), !token.isEmpty else {
                rumSummary = nil
                rumSummaryError = CloudflareWebAnalyticsError.missingToken.localizedDescription
                return
            }
            rumSummary = try await rumAnalyticsProvider.summary(
                siteTag: analyticsSettings.cloudflareToken, apiToken: token, days: 7)
        } catch {
            rumSummary = nil
            rumSummaryError = error.localizedDescription
        }
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `swift test --package-path . --filter PlistEditorModelRUMAnalyticsTests`
Expected: PASS (all 4 tests)

- [ ] **Step 7: Run the full AnglesiteAppCore/AnglesiteCore suites to check for regressions**

Run: `swift test --package-path .`
Expected: PASS (no regressions in `PlistEditorModel`'s other tab tests)

- [ ] **Step 8: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorModel.swift Tests/AnglesiteAppTests/PlistEditorModelRUMAnalyticsTests.swift
git commit -m "feat(app): wire loadRUMSummary into PlistEditorModel (#1114)"
```

---

### Task 3: Analytics tab UI — summary card with a Swift Charts sparkline

**Files:**
- Modify: `Sources/AnglesiteApp/PlistEditorView.swift:3` (import), `:333-346` (analyticsTab body), after `:357` (new `rumSummarySection` computed property)

**Interfaces:**
- Consumes: `PlistEditorModel.cloudflareAnalyticsEnabled`, `.isLoadingRUMSummary`, `.rumSummary`, `.rumSummaryError`, `.loadRUMSummary()` (Task 2); `RUMAnalyticsSummary`, `DailyCount` (Task 1).

- [ ] **Step 1: Add the Charts import**

In `Sources/AnglesiteApp/PlistEditorView.swift`, change:

```swift
import AppKit
import SwiftUI
import AnglesiteCore
```

to:

```swift
import AppKit
import SwiftUI
import Charts
import AnglesiteCore
```

- [ ] **Step 2: Add the trigger and summary section to `analyticsTab`**

Change:

```swift
            HStack(spacing: 8) {
                if model.isSavingAnalytics {
                    ProgressView()
                        .controlSize(.small)
                }
                if let customAnalyticsMessage {
                    Label(customAnalyticsMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.callout)
                }
            }
        }
        .popover(isPresented: $showingCustomAnalyticsHelp, arrowEdge: .trailing) {
```

to:

```swift
            HStack(spacing: 8) {
                if model.isSavingAnalytics {
                    ProgressView()
                        .controlSize(.small)
                }
                if let customAnalyticsMessage {
                    Label(customAnalyticsMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.callout)
                }
            }
            rumSummarySection
        }
        .task { await model.loadRUMSummary() }
        .popover(isPresented: $showingCustomAnalyticsHelp, arrowEdge: .trailing) {
```

- [ ] **Step 3: Add the `rumSummarySection` view**

Immediately after `analyticsTab`'s closing (after the `.popover { ... }` block's closing brace, before the `/// Stable per-row identity...` comment above `RedirectRow`), add:

```swift
    @ViewBuilder
    private var rumSummarySection: some View {
        if model.cloudflareAnalyticsEnabled {
            SettingsBox(title: "Traffic") {
                VStack(alignment: .leading, spacing: 8) {
                    if model.isLoadingRUMSummary {
                        ProgressView()
                            .controlSize(.small)
                    } else if let rumSummaryError = model.rumSummaryError {
                        Label(rumSummaryError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    } else if let summary = model.rumSummary {
                        if summary.dailyPageviews.isEmpty {
                            Text("No traffic recorded in the last 7 days.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Last 7 days: \(summary.totalPageviews) pageviews · \(summary.totalVisits) visits")
                            Chart(summary.dailyPageviews, id: \.date) { day in
                                BarMark(
                                    x: .value("Day", day.date, unit: .day),
                                    y: .value("Pageviews", day.pageviews)
                                )
                            }
                            .frame(height: 60)
                            .accessibilityLabel("7-day pageviews trend")
                            .accessibilityValue("\(summary.totalPageviews) total pageviews over the last 7 days")
                        }
                    }
                }
            }
        }
    }
```

- [ ] **Step 4: Build the app target**

Run:
```bash
scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```
Expected: BUILD SUCCEEDED. This is the only way to prove Swift Charts links correctly and the view compiles — `swift test` alone doesn't build `AnglesiteApp`'s SwiftUI view files through Xcode's toolchain the same way (CONTRIBUTING.md).

- [ ] **Step 5: Sync the String Catalog**

New user-visible text was added ("Traffic", "No traffic recorded in the last 7 days.", the pageviews/visits line) via a CLI-only build, so the merge into `Localizable.xcstrings` needs a manual sync. Follow CONTRIBUTING.md's "Commit String Catalog updates" recipe exactly (derive `BUILD_DIR` from `-showBuildSettings`, scope the `.stringsdata` glob to this worktree, use `--skip-marking-strings-stale`), then review the resulting diff to confirm it only adds the new keys from this task before committing it.

- [ ] **Step 6: Manual GUI smoke — verify in the running app**

With a real `.anglesite` package that has Cloudflare Web Analytics enabled (or a fake enabled via test data), open Site Settings ▸ Analytics and confirm:
- A site with analytics enabled and a successful fetch shows the totals line and sparkline.
- A site with analytics disabled shows nothing new in the tab.
- Toggling analytics on with an invalid/missing token surfaces the error message with no chart.

- [ ] **Step 7: File the manual GUI smoke follow-up issue**

Per the design doc's §7 follow-up, file a tracking issue for a fuller manual QA pass (multiple real sites, revoked-token case, empty-traffic case) using this repo's standard owed-QA pattern:

```bash
gh issue create \
  --title "Manual GUI smoke: Analytics tab traffic summary (#1114)" \
  --body "Follow-up from #1114 (docs/superpowers/specs/2026-08-07-in-app-analytics-design.md §6-7): manually verify the Analytics tab's traffic summary card across a site with real traffic, a site with analytics disabled, a site with analytics enabled but no traffic yet, and a revoked-token error case." \
  --label "🏭 Ready"
```

- [ ] **Step 8: Commit**

```bash
git add Sources/AnglesiteApp/PlistEditorView.swift Sources/AnglesiteApp/Localizable.xcstrings
git commit -m "feat(app): add RUM traffic summary card to Analytics tab (#1114)"
```

---

## Final verification

- [ ] `swift test --package-path .` passes in full.
- [ ] `scripts/build-app.sh -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build` succeeds.
- [ ] Manual GUI smoke from Task 3 Step 6 completed.
- [ ] PR body includes `Closes #1114` and follows `.github/PULL_REQUEST_TEMPLATE.md`'s exact headings (Summary, Paired PR check, Test plan) per CONTRIBUTING.md — note in "Paired PR check" that this is app-only (no MCP schema change, no sidecar PR needed).
