import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Verifies atproto's HTTPS handle-verification method (#1235): fetches
/// `https://<domain>/.well-known/atproto-did` and checks the response body is exactly the
/// account's DID (https://atproto.com/specs/handle#https-method).
///
/// On-demand rather than a `DeployCoordinator.runPostDeploySequencing` pass: this checks a static
/// file the *template* generates from `.site-config` at build time (`edge-artifacts.ts`'s
/// `applyAtprotoDidPlan`), not something this verifier itself publishes, so there is no
/// publish-then-verify ordering to sequence into a deploy. It mirrors how `DomainModel` already
/// verifies `_atproto` TXT records client-side rather than through the deploy pipeline — the
/// domain sheet calls this directly once the owner asks to use their domain as their Bluesky
/// handle.
public enum ATProtoDIDVerification {
    /// One verification attempt's outcome. Reported instead of thrown so the UI can distinguish
    /// "wrong content" from "unreachable" without parsing an error string.
    public enum Outcome: Equatable, Sendable {
        /// The endpoint resolved and its body matched the expected DID exactly.
        case verified
        /// The endpoint resolved (2xx) but returned different or no usable content.
        case mismatch(actual: String?)
        /// The request failed outright, or returned a non-2xx status.
        case unreachable(String)
    }

    /// Bounded well below `URLSession.shared`'s ~60s default, matching
    /// `WebSubPublishPing.requestTimeoutSeconds`'s reasoning: this checks the site's own
    /// just-deployed static asset, so a healthy response is near-instant — 10s is generous
    /// headroom, not a tight budget.
    static let requestTimeoutSeconds: TimeInterval = 10

    static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeoutSeconds
        return URLSession(configuration: config)
    }()

    /// Production transport: a dedicated ephemeral `URLSession` with the tight timeout above,
    /// reusing `POSSEHTTPTransport`'s shape so no second seam type is needed. A non-HTTP response
    /// is surfaced as `URLError.badServerResponse` rather than silently coerced.
    public static let defaultTransport: POSSEHTTPTransport = { request in
        let (data, response) = try await defaultSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    /// Fetches `https://<domain>/.well-known/atproto-did` and compares its trimmed body to
    /// `expectedDID`. `domain` is a bare host (no scheme) — the check is always HTTPS, matching
    /// atproto's requirement that handle resolution never trust plain HTTP. `transport` is
    /// injectable so tests can stub the response without a network.
    public static func verify(
        domain: String,
        expectedDID: String,
        transport: POSSEHTTPTransport = defaultTransport
    ) async -> Outcome {
        let trimmedDomain = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDomain.isEmpty,
              let url = URL(string: "https://\(trimmedDomain)/.well-known/atproto-did")
        else {
            return .unreachable("couldn't build a well-known URL for domain \"\(domain)\"")
        }
        let expected = expectedDID.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let (data, http) = try await transport(URLRequest(url: url))
            guard (200..<300).contains(http.statusCode) else {
                return .unreachable("HTTP \(http.statusCode)")
            }
            let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let body, body == expected else {
                return .mismatch(actual: body)
            }
            return .verified
        } catch {
            return .unreachable("\(error)")
        }
    }
}
