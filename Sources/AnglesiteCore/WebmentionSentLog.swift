import Foundation

/// A `(source, target)` webmention pair — the unit `WebmentionSentLog` tracks and
/// `WebmentionSendCommand` sends.
public struct WebmentionTargetPair: Equatable, Sendable {
    /// The just-published page on the owner's site that mentions the target.
    public let source: URL
    /// The external URL being notified.
    public let target: URL

    /// Creates a pair; identity is exact URL equality (no normalization), matching how the sent
    /// log keys pairs.
    public init(source: URL, target: URL) {
        self.source = source
        self.target = target
    }
}

/// Per-site record of `(source, target)` webmention pairs already sent successfully, persisted at
/// `Config/webmention-sent.json` — app-owned state, never committed to the site's git repo (same
/// place as `DeployedRoutesSnapshot`'s `last-deployed-routes.json`). Lets `WebmentionSendCommand`
/// skip pairs it already notified on a prior deploy, instead of re-pinging every target's
/// endpoint on every redeploy.
public struct WebmentionSentLog: Equatable, Sendable {
    /// One successfully-sent pair plus when it was sent — the timestamp is diagnostic (nothing
    /// currently expires entries; the pair alone decides dedup).
    public struct Entry: Codable, Equatable, Sendable {
        /// The owner-site page that carried the mention.
        public let source: URL
        /// The external URL that was notified.
        public let target: URL
        /// When the send succeeded (ISO 8601 on disk).
        public let sentAt: Date

        /// Memberwise creation — normally reached via ``WebmentionSentLog/recording(_:now:)``
        /// rather than directly.
        public init(source: URL, target: URL, sentAt: Date) {
            self.source = source
            self.target = target
            self.sentAt = sentAt
        }
    }

    /// Every pair recorded as sent, in recording order. Append-only via ``recording(_:now:)``.
    public let sent: [Entry]

    /// Creates a log; the empty default is the "fresh site, nothing sent yet" starting state.
    public init(sent: [Entry] = []) {
        self.sent = sent
    }

    /// On-disk filename inside the site's `Config/` directory.
    public static let filename = "webmention-sent.json"

    private struct Envelope: Codable {
        let sent: [Entry]
    }

    /// `nil` when the file is absent or unreadable — the normal "no prior sends yet" case.
    public static func load(from configDirectory: URL) -> WebmentionSentLog? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return WebmentionSentLog(sent: envelope.sent)
    }

    /// Writes the log atomically. Losing this file is safe — the worst case is re-sending
    /// webmentions the targets already received, which the protocol treats as an update.
    public func save(to configDirectory: URL) throws {
        let url = configDirectory.appendingPathComponent(Self.filename)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(Envelope(sent: sent))
        try data.write(to: url, options: .atomic)
    }

    /// Pairs from `plan`'s entries not already recorded as sent.
    public func pending(in plan: SocialPublishPlan.Plan) -> [WebmentionTargetPair] {
        let sentKeys = Set(sent.map { pairKey(source: $0.source, target: $0.target) })
        var result: [WebmentionTargetPair] = []
        for entry in plan.entries {
            for target in entry.webmentionTargets {
                let key = pairKey(source: entry.canonicalURL, target: target)
                if !sentKeys.contains(key) {
                    result.append(WebmentionTargetPair(source: entry.canonicalURL, target: target))
                }
            }
        }
        return result
    }

    /// A new log with `pairs` appended, all stamped with the same `now()` timestamp.
    public func recording(
        _ pairs: [WebmentionTargetPair],
        now: @escaping () -> Date = Date.init
    ) -> WebmentionSentLog {
        let timestamp = now()
        let newEntries = pairs.map { Entry(source: $0.source, target: $0.target, sentAt: timestamp) }
        return WebmentionSentLog(sent: sent + newEntries)
    }

    private func pairKey(source: URL, target: URL) -> String {
        "\(source.absoluteString)\n\(target.absoluteString)"
    }
}
