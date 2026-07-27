import Foundation

/// Durable per-site record of which content entries have already been backfilled into the
/// ActivityPub outbox (#926) — `Config/activitypub-outbox.json`, app-owned, never in git. Same
/// shape and crash-safety contract as `POSSESyndicationLog`, but deliberately a separate file:
/// POSSE tracks outbound copies posted to *other* platforms, this tracks entries synced into
/// *this site's own* outbox — different concepts that happen to share a JSON-ledger pattern.
public struct ActivityPubOutboxLedger: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public let canonicalURL: String
        /// The activity id the outbox DO returned for this insert.
        public let activityID: String
        public let syncedAt: Date

        public init(canonicalURL: String, activityID: String, syncedAt: Date) {
            self.canonicalURL = canonicalURL
            self.activityID = activityID
            self.syncedAt = syncedAt
        }
    }

    public static let filename = "activitypub-outbox.json"

    public private(set) var entries: [Entry]

    public init(entries: [Entry] = []) {
        self.entries = entries
    }

    public func contains(canonicalURL: String) -> Bool {
        entries.contains { $0.canonicalURL == canonicalURL }
    }

    /// No-ops if `entry.canonicalURL` is already recorded — the first successful sync wins,
    /// matching `POSSESyndicationLog.record`'s idempotent-insert contract.
    public mutating func record(_ entry: Entry) {
        guard !contains(canonicalURL: entry.canonicalURL) else { return }
        entries.append(entry)
    }

    private struct Envelope: Codable {
        let entries: [Entry]
    }

    public static func load(from configDirectory: URL) -> ActivityPubOutboxLedger? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return ActivityPubOutboxLedger(entries: envelope.entries)
    }

    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(entries: entries))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
