import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The result of a Green Web Foundation Greencheck lookup. Distinct from `GreenHostCheckError`
/// so a definitive "not green" (a successful, negative answer) is never conflated with a failed
/// check (network failure or an unreachable/broken API) — issue #684's explicit requirement.
public enum GreenHostCheckResult: Equatable, Sendable {
    /// The Green Web Foundation reports the host as running on verified green energy.
    case green
    /// A definitive negative: the check succeeded and the host is *not* listed as green.
    /// Distinct from any error case so it can be shown as a fact, not a shrug.
    case notGreen
}

/// Why a Greencheck lookup couldn't produce an answer — the "we don't know" side of the
/// result/error split described on ``GreenHostCheckResult``.
public enum GreenHostCheckError: Error, Equatable, Sendable {
    /// The request never completed (DNS/connection failure) — likely the user's connectivity.
    case network
    /// The API responded but unusably (rate limit, 5xx, or an undecodable body); carries the
    /// user-facing message to display.
    case unavailable(String)
}

/// Seam for the Greencheck lookup so callers can be tested without the live Green Web
/// Foundation API; ``GreenHostChecker`` is the production conformance.
public protocol GreenHostChecking: Sendable {
    /// Looks up `hostname` (a bare host, not a URL), answering green/not-green or an error.
    /// A `Result` rather than `throws` so a failed check can never be mistaken for "not green"
    /// (#684's explicit requirement).
    func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError>
}

/// Client for the Green Web Foundation's public Greencheck API (verified 2026-07-23 against
/// developers.thegreenwebfoundation.org): `GET .../api/v3/greencheck/{hostname}` → `{"green": bool, ...}`.
public struct GreenHostChecker: GreenHostChecking {
    /// Performs one GET and returns its body + response; throws on connection failure. Same
    /// injectable-HTTP seam shape as ``GitHubAPITokenVerifier/Transport``, for the same reason:
    /// the response-classification logic is unit-testable without real network.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let baseURL: URL
    private let transport: Transport

    /// Both parameters exist for tests (stub server / no network at all); production uses the
    /// defaults.
    public init(
        baseURL: URL = URL(string: "https://api.thegreenwebfoundation.org/api/v3/greencheck")!,
        transport: @escaping Transport = GreenHostChecker.defaultTransport
    ) {
        self.baseURL = baseURL
        self.transport = transport
    }

    /// GETs `{baseURL}/{hostname}` and maps the response: transport failure → `.network`,
    /// 429/5xx or an undecodable body → `.unavailable`, otherwise the API's boolean `green`
    /// field decides ``GreenHostCheckResult``. No status code ever maps to `.notGreen` — only
    /// an explicit `"green": false` does.
    public func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError> {
        let request = URLRequest(url: baseURL.appendingPathComponent(hostname))
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport(request)
        } catch {
            return .failure(.network)
        }
        if http.statusCode == 429 || http.statusCode >= 500 {
            return .failure(.unavailable("The Green Web Foundation is unavailable right now (HTTP \(http.statusCode)). Try again in a moment."))
        }
        guard (200..<300).contains(http.statusCode),
              let body = try? JSONDecoder().decode(GreenCheckResponse.self, from: data)
        else {
            return .failure(.unavailable("The Green Web Foundation returned an unexpected response while checking your host."))
        }
        return .success(body.green ? .green : .notGreen)
    }

    private struct GreenCheckResponse: Decodable { let green: Bool }

    /// Production transport: a plain shared-`URLSession` GET.
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
