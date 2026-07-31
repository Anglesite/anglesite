import Foundation

/// Durable per-site record of which content entries have already been backfilled into the
/// ActivityPub outbox (#926) — `Config/activitypub-outbox.json`, app-owned, never in git. Same
/// shape and crash-safety contract as `POSSESyndicationLog`, but deliberately a separate file:
/// POSSE tracks outbound copies posted to *other* platforms, this tracks entries synced into
/// *this site's own* outbox — different concepts that happen to share a JSON-ledger pattern.
public struct ActivityPubOutboxLedger: Codable, Equatable, Sendable {
    /// One synced content entry.
    public struct Entry: Codable, Equatable, Sendable {
        /// The entry's canonical page URL — the dedupe key ``ActivityPubOutboxLedger/contains(canonicalURL:)``
        /// and ``ActivityPubOutboxLedger/record(_:)`` match on. Chosen over the activity id
        /// because it's the identity that's stable across deploys and known *before* the POST.
        public let canonicalURL: String
        /// The activity id the outbox DO returned for this insert.
        public let activityID: String
        /// When the outbox accepted the entry (the backfill run's reference date — not the
        /// content's own publish date, which lives in the activity itself).
        public let syncedAt: Date

        /// Memberwise init, public so `ActivityPubOutboxBackfill` (and tests) can record
        /// entries directly.
        public init(canonicalURL: String, activityID: String, syncedAt: Date) {
            self.canonicalURL = canonicalURL
            self.activityID = activityID
            self.syncedAt = syncedAt
        }
    }

    /// The ledger's filename inside the site's `Config/` directory — app-owned state beside the
    /// repo, never inside it (see the type doc).
    public static let filename = "activitypub-outbox.json"

    /// All recorded entries, in sync order. `private(set)` so the only mutation path is
    /// ``record(_:)`` and its idempotent-insert contract can't be bypassed.
    public private(set) var entries: [Entry]

    /// Starts a ledger, empty by default — "brand-new site" and `load(from:)` returning `nil`
    /// deliberately collapse to the same starting state.
    public init(entries: [Entry] = []) {
        self.entries = entries
    }

    /// Whether `canonicalURL` has already been synced — the filter `ActivityPubOutboxBackfill`
    /// applies before POSTing anything.
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

    /// Reads the ledger from `configDirectory` — `nil` for a missing *or* undecodable file.
    /// Both collapse to "start fresh" on purpose: the worst consequence is re-posting entries
    /// the outbox already accepted, which is preferable to a corrupt ledger blocking the whole
    /// backfill.
    public static func load(from configDirectory: URL) -> ActivityPubOutboxLedger? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return ActivityPubOutboxLedger(entries: envelope.entries)
    }

    /// Writes the ledger atomically (a crash mid-write leaves the previous file intact, per the
    /// crash-safety contract in the type doc), creating `configDirectory` if needed. Output is
    /// pretty-printed with sorted keys so successive writes diff cleanly.
    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(entries: entries))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
