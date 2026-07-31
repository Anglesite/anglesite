import Foundation
// URLSession/URLRequest/HTTPURLResponse live in FoundationNetworking on non-Darwin
// platforms (swift-corelibs-foundation); this import is a no-op on macOS.
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One Web Analytics (RUM) site registration from Cloudflare's `site_info/list` endpoint —
/// the hostname it's registered for plus the tag that identifies it in beacon/analytics queries.
public struct CloudflareWebAnalyticsSite: Sendable, Equatable {
    /// Hostname the analytics site is registered under, as Cloudflare stores it (a bare host —
    /// see ``CloudflareWebAnalyticsClient/matchingSite(for:in:)`` for how looser inputs match it).
    public let host: String
    /// Cloudflare's `site_tag` — the stable identifier used to query this site's analytics.
    public let siteTag: String

    /// Memberwise initializer; the client maps API rows into this, and tests build fixtures.
    public init(host: String, siteTag: String) {
        self.host = host
        self.siteTag = siteTag
    }
}

/// Failures resolving a Web Analytics site tag. Conforms to `LocalizedError` so callers can
/// surface `errorDescription` directly as the user-facing message without a mapping layer.
public enum CloudflareWebAnalyticsError: Error, LocalizedError, Sendable, Equatable {
    /// The caller had no Cloudflare API token to send — nothing was requested.
    case missingToken
    /// The token verified but `GET /accounts` returned no account to scope the site lookup to.
    case noAccount
    /// No registered Web Analytics site matched the given host — usually means Web Analytics
    /// simply hasn't been enabled for it in the Cloudflare dashboard.
    case noMatchingSite(String)
    /// A 2xx response whose body didn't decode as the expected envelope.
    case invalidResponse
    /// A non-2xx response; carries Cloudflare's own error message when one was decodable, else a
    /// generic HTTP-status message.
    case api(String)

    /// User-facing message for each failure — the reason this type adopts `LocalizedError`.
    public var errorDescription: String? {
        switch self {
        case .missingToken:
            return "Cloudflare API token is not configured."
        case .noAccount:
            return "No Cloudflare account was available for this token."
        case .noMatchingSite(let host):
            return "Cloudflare Web Analytics is not enabled for \(host)."
        case .invalidResponse:
            return "Cloudflare returned an unexpected Web Analytics response."
        case .api(let message):
            return message
        }
    }
}

/// Seam for resolving a host's Web Analytics site tag, so callers (the plist editor's analytics
/// wiring) can inject a fake instead of hitting the Cloudflare API in tests.
public protocol CloudflareWebAnalyticsProviding: Sendable {
    /// Resolves the `site_tag` for `host`, or throws ``CloudflareWebAnalyticsError`` when the
    /// account has no Web Analytics registration matching it.
    func siteTag(for host: String, apiToken: String) async throws -> String
}

/// Production ``CloudflareWebAnalyticsProviding``: a thin v4 REST client that looks up the
/// token's first account, lists its Web Analytics (RUM) sites, and matches by normalized host.
public struct CloudflareWebAnalyticsClient: CloudflareWebAnalyticsProviding {
    private let baseURL: URL
    private let urlSession: URLSession

    /// Both parameters exist for tests — point `baseURL` at a local stub server to exercise the
    /// real request/decode path. Production callers take the defaults.
    public init(baseURL: URL = URL(string: "https://api.cloudflare.com/client/v4")!,
                urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    /// Resolves the site tag by scoping to the token's *first* account — Anglesite's Cloudflare
    /// onboarding assumes a single-account token, so no account picker exists here.
    public func siteTag(for host: String, apiToken: String) async throws -> String {
        let accounts = try await accounts(apiToken: apiToken)
        guard let accountID = accounts.first?.id else { throw CloudflareWebAnalyticsError.noAccount }
        let sites = try await webAnalyticsSites(accountID: accountID, apiToken: apiToken)
        guard let site = Self.matchingSite(for: host, in: sites) else {
            throw CloudflareWebAnalyticsError.noMatchingSite(host)
        }
        return site.siteTag
    }

    /// Finds the registration whose host matches `host` after normalization (lowercased, scheme
    /// and path stripped) — a stored value like `https://Example.com/about` still matches
    /// Cloudflare's bare-hostname records. Static and public so the matching rule is unit-testable
    /// without any network.
    public static func matchingSite(for host: String, in sites: [CloudflareWebAnalyticsSite]) -> CloudflareWebAnalyticsSite? {
        let normalized = normalizeHost(host)
        return sites.first { normalizeHost($0.host) == normalized }
    }

    private func accounts(apiToken: String) async throws -> [Account] {
        let envelope: Envelope<[Account]> = try await get("accounts", apiToken: apiToken)
        return envelope.result
    }

    private func webAnalyticsSites(accountID: String, apiToken: String) async throws -> [CloudflareWebAnalyticsSite] {
        let envelope: Envelope<[SiteInfo]> = try await get("accounts/\(accountID)/rum/site_info/list", apiToken: apiToken)
        return envelope.result.map { CloudflareWebAnalyticsSite(host: $0.host, siteTag: $0.siteTag) }
    }

    private func get<T: Decodable>(_ path: String, apiToken: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
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

    private static func normalizeHost(_ host: String) -> String {
        host.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"/.*$"#, with: "", options: .regularExpression)
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

    private struct SiteInfo: Decodable {
        let host: String
        let siteTag: String

        enum CodingKeys: String, CodingKey {
            case host
            case siteTag = "site_tag"
        }
    }
}
