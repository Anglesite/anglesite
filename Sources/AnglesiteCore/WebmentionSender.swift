import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Outcome of one webmention send attempt for a single (source, target) pair.
public enum WebmentionSendOutcome: Equatable, Sendable {
    /// The endpoint accepted the mention (2xx). `statusCode` distinguishes a synchronous 200 from
    /// an async-processing 201/202, both of which count as sent.
    case sent(endpoint: URL, statusCode: Int)
    /// The target declares no webmention endpoint — a normal outcome (most of the web doesn't),
    /// distinct from failure so callers can skip quietly rather than log an error.
    case noEndpointDiscovered
    /// Discovery or the POST failed; `reason` is human-readable for the log pane. The pair stays
    /// unrecorded, so the next send pass retries it for free.
    case requestFailed(reason: String)
}

/// Sends one Webmention: discovers `target`'s declared endpoint via `WebmentionEndpointDiscovery`,
/// then POSTs `source`+`target` form-encoded per the webmention.org spec. No retry logic here —
/// a caller that doesn't record a `.requestFailed` pair as sent gets a free retry on its next
/// pass (see `WebmentionSendCommand`).
public enum WebmentionSender {
    /// Discovers `target`'s endpoint and POSTs the form-encoded pair, folding every failure mode
    /// into a ``WebmentionSendOutcome`` instead of throwing — the caller treats each pair as
    /// independent best-effort work and only needs a value to log/record.
    public static func send(
        source: URL,
        target: URL,
        transport: WebmentionEndpointDiscovery.Transport
    ) async -> WebmentionSendOutcome {
        let endpoint: URL?
        do {
            endpoint = try await WebmentionEndpointDiscovery.discover(target: target, transport: transport)
        } catch {
            return .requestFailed(reason: "endpoint discovery failed: \(error)")
        }
        guard let endpoint else { return .noEndpointDiscovered }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = "source=\(formEncode(source.absoluteString))&target=\(formEncode(target.absoluteString))"
        request.httpBody = Data(body.utf8)

        let http: HTTPURLResponse
        do {
            (_, http) = try await transport(request)
        } catch {
            return .requestFailed(reason: "POST to \(endpoint.absoluteString) failed: \(error)")
        }
        guard (200..<300).contains(http.statusCode) else {
            return .requestFailed(reason: "\(endpoint.absoluteString) returned HTTP \(http.statusCode)")
        }
        return .sent(endpoint: endpoint, statusCode: http.statusCode)
    }

    /// Percent-encodes everything but RFC 3986 unreserved characters, so a source/target URL's
    /// own `:`, `/`, `?`, `&`, `=` can't be mistaken for the outer form body's delimiters.
    private static func formEncode(_ value: String) -> String {
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        return value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
    }
}
