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
        // `groups` had real, nonzero data, but none of it had a date in either format
        // `parseDate` understands — that's a parse failure, not "no traffic in this window," and
        // must not be conflated with the genuinely-empty (`groups.isEmpty`) case below.
        if !groups.isEmpty && daily.isEmpty {
            throw CloudflareWebAnalyticsError.invalidResponse
        }
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
