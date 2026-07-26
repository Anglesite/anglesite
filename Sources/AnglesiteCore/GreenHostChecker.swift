import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The result of a Green Web Foundation Greencheck lookup. Distinct from `GreenHostCheckError`
/// so a definitive "not green" (a successful, negative answer) is never conflated with a failed
/// check (network failure or an unreachable/broken API) — issue #684's explicit requirement.
public enum GreenHostCheckResult: Equatable, Sendable {
    case green
    case notGreen
}

public enum GreenHostCheckError: Error, Equatable, Sendable {
    case network
    case unavailable(String)
}

public protocol GreenHostChecking: Sendable {
    func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError>
}

/// Client for the Green Web Foundation's public Greencheck API (verified 2026-07-23 against
/// developers.thegreenwebfoundation.org): `GET .../api/v3/greencheck/{hostname}` → `{"green": bool, ...}`.
public struct GreenHostChecker: GreenHostChecking {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let baseURL: URL
    private let transport: Transport

    public init(
        baseURL: URL = URL(string: "https://api.thegreenwebfoundation.org/api/v3/greencheck")!,
        transport: @escaping Transport = GreenHostChecker.defaultTransport
    ) {
        self.baseURL = baseURL
        self.transport = transport
    }

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

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
