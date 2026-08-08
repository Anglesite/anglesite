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
    /// Outgoing request bodies, keyed by URL — lets tests assert on what the client actually sent
    /// (e.g. the GraphQL `variables`), not just what it received back.
    nonisolated(unsafe) static var capturedBodies: [String: Data] = [:]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let key = request.url?.absoluteString ?? ""
        if let body = Self.bodyData(from: request) {
            Self.capturedBodies[key] = body
        }
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

    static func reset() {
        responses = [:]
        capturedBodies = [:]
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RUMAnalyticsStubURLProtocol.self]
        return URLSession(configuration: config)
    }

    /// `URLSession` moves a POST body set via `URLRequest.httpBody` into `httpBodyStream` for
    /// requests routed through a custom `URLProtocol` — `request.httpBody` alone comes back `nil`
    /// here even though the client set it, so fall back to draining the stream.
    private static func bodyData(from request: URLRequest) -> Data? {
        if let httpBody = request.httpBody {
            return httpBody
        }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 4096
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while stream.hasBytesAvailable {
            let bytesRead = stream.read(&buffer, maxLength: bufferSize)
            if bytesRead > 0 {
                data.append(buffer, count: bytesRead)
            } else {
                break
            }
        }
        return data
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

    @Test("throws invalidResponse when every group's date fails to parse, rather than reporting empty traffic")
    func throwsWhenAllDatesUnparseable() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(statusCode: 200, body: """
            {"data":{"viewer":{"accounts":[{"rumPageloadEventsAdaptiveGroups":[
                {"count":100,"sum":{"visits":40},"dimensions":{"date":"not-a-date"}}
            ]}]}}}
            """)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        await #expect(throws: CloudflareWebAnalyticsError.invalidResponse) {
            try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)
        }
    }

    @Test("sends the expected siteTag and a roughly 7-day since/until window")
    func sendsExpectedSiteTagAndDateWindow() async throws {
        RUMAnalyticsStubURLProtocol.reset()
        RUMAnalyticsStubURLProtocol.responses[accountsURL] = .init(statusCode: 200, body: accountsJSON)
        RUMAnalyticsStubURLProtocol.responses[graphqlURL] = .init(statusCode: 200, body: """
            {"data":{"viewer":{"accounts":[{"rumPageloadEventsAdaptiveGroups":[]}]}}}
            """)
        let client = CloudflareRUMAnalyticsClient(baseURL: baseURL, urlSession: RUMAnalyticsStubURLProtocol.makeSession())

        _ = try await client.summary(siteTag: "site-tag-1", apiToken: "token", days: 7)

        let capturedBody = try #require(RUMAnalyticsStubURLProtocol.capturedBodies[graphqlURL])
        let json = try #require(
            try JSONSerialization.jsonObject(with: capturedBody) as? [String: Any])
        let variables = try #require(json["variables"] as? [String: Any])

        #expect(variables["siteTag"] as? String == "site-tag-1")

        let isoFormatter = ISO8601DateFormatter()
        let sinceString = try #require(variables["since"] as? String)
        let untilString = try #require(variables["until"] as? String)
        let since = try #require(isoFormatter.date(from: sinceString))
        let until = try #require(isoFormatter.date(from: untilString))
        let span = until.timeIntervalSince(since)
        let sevenDays: TimeInterval = 7 * 24 * 60 * 60
        #expect(abs(span - sevenDays) < 3600 * 4)
    }
}
