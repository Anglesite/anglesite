import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Pings the site's own WebSub hub after a successful deploy so subscribers get pushed the
/// updated feeds (V-3.3, #361).
///
/// The hub (`@dwk/websub`, composed into the per-site Worker at `/websub`) treats a
/// `hub.mode=publish` POST for one of the site's feed topics as "this topic changed": it fetches
/// the feed once and delivers the snapshot to every verified subscriber, HMAC-signing the body
/// (`X-Hub-Signature`) for subscribers that registered a secret. A deploy regenerates every
/// feed, so the app pings all of them — WebSub publish pings are deliberately unauthenticated
/// (a spoofed ping only makes the hub re-fetch content it already serves).
///
/// Best-effort by contract: a failed ping must never turn an already-successful deploy into a
/// failure, so `notify` reports outcomes (and logs them) instead of throwing — the same posture
/// as the webmention-send and POSSE passes it runs alongside in
/// `DeployCoordinator.runPostDeploySequencing`.
public struct WebSubPublishPing: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// The feed paths the hub serves as topics. Must mirror the template's
    /// `worker/worker.ts` `WEBSUB_TOPIC_PATHS` — a ping for any other path is a 400.
    public static let topicPaths = ["/rss.xml", "/atom.xml", "/feed.json"]

    public struct Outcome: Equatable, Sendable {
        public let topic: String
        public let accepted: Bool
        public let detail: String?

        public init(topic: String, accepted: Bool, detail: String? = nil) {
            self.topic = topic
            self.accepted = accepted
            self.detail = detail
        }
    }

    private let transport: Transport

    public init(transport: @escaping Transport = WebSubPublishPing.defaultTransport) {
        self.transport = transport
    }

    /// POSTs one `hub.mode=publish` ping per feed topic to `<origin>/websub` and returns the
    /// per-topic outcomes. `siteURL` is the site's canonical URL
    /// (`DeployCoordinator.resolveSiteURL`); an unparseable value yields no pings. Outcomes are
    /// also appended to the debug log under `source`.
    public func notify(siteURL: String, source: String = "websub-ping") async -> [Outcome] {
        guard let origin = Self.origin(from: siteURL) else {
            await LogCenter.shared.append(
                source: source, stream: .stderr,
                text: "skipping WebSub publish pings — no canonical site URL"
            )
            return []
        }
        guard let hubURL = URL(string: "\(origin)/websub") else { return [] }

        var outcomes: [Outcome] = []
        for path in Self.topicPaths {
            let topic = "\(origin)\(path)"
            var request = URLRequest(url: hubURL)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Self.formEncode([("hub.mode", "publish"), ("hub.url", topic)])

            let outcome: Outcome
            do {
                let (data, http) = try await transport(request)
                if (200..<300).contains(http.statusCode) {
                    outcome = Outcome(topic: topic, accepted: true)
                } else {
                    let body = String(data: data, encoding: .utf8) ?? ""
                    outcome = Outcome(
                        topic: topic, accepted: false,
                        detail: "HTTP \(http.statusCode)\(body.isEmpty ? "" : ": \(body)")"
                    )
                }
            } catch {
                outcome = Outcome(topic: topic, accepted: false, detail: "\(error)")
            }
            outcomes.append(outcome)
            await LogCenter.shared.append(
                source: source,
                stream: outcome.accepted ? .stdout : .stderr,
                text: outcome.accepted
                    ? "notified hub: \(topic)"
                    : "hub ping failed for \(topic): \(outcome.detail ?? "unknown error")"
            )
        }
        return outcomes
    }

    /// The canonical origin (`scheme://host[:port]`) of `siteURL`, or `nil` when it has no
    /// usable scheme/host. Topic URLs must match the hub's allowed-topic list exactly, and that
    /// list derives from the same origin (worker.ts `websubConfig`), so both sides agree by
    /// construction.
    static func origin(from siteURL: String) -> String? {
        guard let url = URL(string: siteURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else { return nil }
        let port = url.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    /// application/x-www-form-urlencoded body. Values here are URLs (no spaces), so plain
    /// percent-encoding of everything outside the unreserved set is sufficient and unambiguous.
    static func formEncode(_ fields: [(String, String)]) -> Data {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let encoded = fields.map { key, value in
            let k = key.addingPercentEncoding(withAllowedCharacters: unreserved) ?? key
            let v = value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
            return "\(k)=\(v)"
        }
        return Data(encoded.joined(separator: "&").utf8)
    }

    /// Bounded well below `URLSession.shared`'s ~60s default: three sequential pings on
    /// `URLSession.shared` could add up to ~3 minutes to a deploy before this best-effort pass
    /// gives up on an unreachable hub. The hub is the site's own just-deployed Worker, so a
    /// healthy response is near-instant — 10s per ping is generous headroom, not a tight budget.
    /// Internal (not private) so tests can confirm it's actually wired into `defaultSession`.
    static let requestTimeoutSeconds: TimeInterval = 10

    static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeoutSeconds
        return URLSession(configuration: config)
    }()

    public static let defaultTransport: Transport = { request in
        let (data, response) = try await defaultSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
