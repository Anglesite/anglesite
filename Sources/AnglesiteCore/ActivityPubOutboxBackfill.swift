import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Backfills a site's existing content into its ActivityPub actor's outbox at deploy time
/// (#926) — reads `OutboxBackfillPlan`, skips anything already in `ActivityPubOutboxLedger`,
/// and POSTs the rest, oldest-`publishedAt`-first, to the deployed site's own `/users/site/outbox`
/// route. Shaped like `WebSubPublishPing`: `Sendable`, injectable transport, best-effort — never
/// throws out of `backfill(...)`, one failed entry never blocks the rest.
///
/// **Wire format:** confirmed against the merged `davidwkeith/workers#451`/`#452` implementation
/// (published as `@dwk/activitypub` 1.0.0-beta.2) — quiet-insert is a `?skipDelivery=1` query
/// parameter on the outbox URL (translated by the worker's front door into an internal header),
/// not a body field, and the preserved `published` timestamp is a plain field on the posted AS2
/// object.
public struct ActivityPubOutboxBackfill: Sendable {
    /// Injectable network seam: takes the fully-formed request, returns body + response. Tests
    /// substitute a canned closure; production uses ``defaultTransport``.
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// One entry's result, returned (not just logged) so callers and tests can assert what
    /// happened without parsing `LogCenter` output.
    public struct Outcome: Equatable, Sendable {
        /// The entry's canonical page URL — also its identity in `ActivityPubOutboxLedger`.
        public let canonicalURL: String
        /// True when the outbox returned 2xx — even if the local ledger write then failed
        /// (see `detail`); acceptance is the server's fact, ledger state is ours.
        public let accepted: Bool
        /// The failure description, or the ledger-write warning on an otherwise-accepted entry;
        /// `nil` on full success.
        public let detail: String?
    }

    private let transport: Transport

    /// Creates the runner. Everything site-specific arrives per-call in `backfill(...)`, so one
    /// instance serves any site; `transport` is the only injectable.
    public init(transport: @escaping Transport = ActivityPubOutboxBackfill.defaultTransport) {
        self.transport = transport
    }

    /// Best-effort — always returns normally, one entry's failure never blocks the rest or
    /// throws out of this call. Returns `[]` (no requests made) when there's nothing pending or
    /// no publish token is provisioned yet.
    public func backfill(
        siteID: String,
        siteDirectory: URL,
        configDirectory: URL,
        siteBase: URL,
        secretStore: any SecretStore,
        referenceDate: Date = Date()
    ) async -> [Outcome] {
        let plan = OutboxBackfillPlan.build(projectRoot: siteDirectory, siteBase: siteBase, referenceDate: referenceDate)
        guard !plan.entries.isEmpty else { return [] }

        // `try?` on a throwing function that itself returns `String?` auto-flattens to `String?`
        // (SE-0230) — this `guard let` is `nil` both when `read` throws and when it legitimately
        // returns "no token provisioned yet", which is exactly the one "skip silently" case here.
        guard let token = try? secretStore.read(account: SecretAccounts.activityPubPublishToken(siteID: siteID)) else {
            await LogCenter.shared.append(
                source: "activitypub-backfill:\(siteID)", stream: .stderr,
                text: "skipped outbox backfill: no publish token provisioned"
            )
            return []
        }

        var ledger = ActivityPubOutboxLedger.load(from: configDirectory) ?? ActivityPubOutboxLedger()
        let pending = plan.entries
            .filter { !ledger.contains(canonicalURL: $0.canonicalURL.absoluteString) }
            .sorted { $0.publishedAt < $1.publishedAt }
        guard !pending.isEmpty else { return [] }

        // `?skipDelivery=1` (not a body field — see the wire-format note above) is the worker's
        // owner-authorized quiet-insert mode: the entry lands in the outbox without fanning out
        // to today's followers.
        guard
            var outboxComponents = URLComponents(
                url: ActivityPubActor.actorURL(siteURL: siteBase).appendingPathComponent("outbox"),
                resolvingAgainstBaseURL: false
            )
        else { return [] }
        outboxComponents.queryItems = [URLQueryItem(name: "skipDelivery", value: "1")]
        guard let outboxURL = outboxComponents.url else { return [] }
        var outcomes: [Outcome] = []

        for entry in pending {
            var request = URLRequest(url: outboxURL)
            request.httpMethod = "POST"
            request.setValue("application/activity+json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try? JSONSerialization.data(withJSONObject: Self.activityBody(for: entry))

            let canonical = entry.canonicalURL.absoluteString
            let outcome: Outcome
            do {
                let (data, http) = try await transport(request)
                if (200..<300).contains(http.statusCode) {
                    let activityID = Self.activityID(from: data) ?? canonical
                    ledger.record(.init(canonicalURL: canonical, activityID: activityID, syncedAt: referenceDate))
                    do {
                        try ledger.save(to: configDirectory)
                        outcome = Outcome(canonicalURL: canonical, accepted: true, detail: nil)
                    } catch {
                        await LogCenter.shared.append(
                            source: "activitypub-backfill:\(siteID)", stream: .stderr,
                            text: "outbox accepted \(canonical) but the local ledger write failed: \(error) — this entry may be re-posted on the next run"
                        )
                        outcomes.append(Outcome(canonicalURL: canonical, accepted: true, detail: "ledger write failed: \(error)"))
                        continue
                    }
                } else {
                    let body = String(data: data, encoding: .utf8) ?? ""
                    outcome = Outcome(
                        canonicalURL: canonical, accepted: false,
                        detail: "HTTP \(http.statusCode)\(body.isEmpty ? "" : ": \(body)")"
                    )
                }
            } catch {
                outcome = Outcome(canonicalURL: canonical, accepted: false, detail: "\(error)")
            }

            outcomes.append(outcome)
            await LogCenter.shared.append(
                source: "activitypub-backfill:\(siteID)",
                stream: outcome.accepted ? .stdout : .stderr,
                text: outcome.accepted
                    ? "backfilled outbox entry: \(canonical)"
                    : "outbox backfill failed for \(canonical): \(outcome.detail ?? "unknown error")"
            )
        }

        return outcomes
    }

    static func activityBody(for entry: OutboxBackfillPlan.Entry) -> [String: Any] {
        var object: [String: Any] = [
            "@context": "https://www.w3.org/ns/activitystreams",
            "type": entry.kind.rawValue,
            "content": entry.content,
            "mediaType": "text/plain",
            "url": entry.canonicalURL.absoluteString,
            "published": ISO8601DateFormatter().string(from: entry.publishedAt),
            "to": ["https://www.w3.org/ns/activitystreams#Public"],
        ]
        if let name = entry.name { object["name"] = name }
        if let inReplyTo = entry.inReplyTo { object["inReplyTo"] = inReplyTo }
        if !entry.attachments.isEmpty {
            object["attachment"] = entry.attachments.map { attachment -> [String: Any] in
                var dict: [String: Any] = ["type": "Image", "url": attachment.url]
                if let mediaType = attachment.mediaType { dict["mediaType"] = mediaType }
                return dict
            }
        }
        return object
    }

    static func activityID(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["id"] as? String
    }

    /// Production transport: a plain `URLSession` request (matching
    /// `ActivityPubFollowersClient.defaultTransport`'s shape).
    public static let defaultTransport: Transport = { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
