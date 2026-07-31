import Foundation

/// Durable per-site POSSE ledger. Recording the returned social URL before source write-back means
/// a crash cannot silently duplicate the post: the next deploy retries write-back from this ledger.
public struct POSSESyndicationLog: Equatable, Sendable {
    /// One successful syndication: which source post went to which platform, and where it
    /// landed. Identity for dedup purposes is (`canonicalURL`, `platform`) — see
    /// ``POSSESyndicationLog/contains(canonicalURL:platform:)``.
    public struct Entry: Codable, Equatable, Sendable {
        /// Site-relative path of the source file carrying the `posse:` opt-in; used for the
        /// `syndication:` frontmatter write-back.
        public let sourceFile: String
        /// The post's published URL on the owner's own site — the Webmention source.
        public let canonicalURL: URL
        /// Normalized platform key (`"mastodon"` or `"bluesky"`), never the raw frontmatter
        /// spelling (`"fediverse"`, `"bsky"`).
        public let platform: String
        /// The URL the platform returned for the syndicated copy — the Webmention target.
        public let syndicationURL: URL
        /// When the platform accepted the post.
        public let postedAt: Date
        /// When the backfeed webmention was sent, or `nil` while it's still pending — the send
        /// waits for a *subsequent* deploy to make the written-back `u-syndication` link live.
        public var backfeedSentAt: Date?

        /// Memberwise initializer; `backfeedSentAt` defaults to `nil` because a freshly
        /// recorded entry is always pre-backfeed.
        public init(
            sourceFile: String,
            canonicalURL: URL,
            platform: String,
            syndicationURL: URL,
            postedAt: Date,
            backfeedSentAt: Date? = nil
        ) {
            self.sourceFile = sourceFile
            self.canonicalURL = canonicalURL
            self.platform = platform
            self.syndicationURL = syndicationURL
            self.postedAt = postedAt
            self.backfeedSentAt = backfeedSentAt
        }
    }

    /// The ledger's file name inside the package's `Config/` directory — app-owned state, so it
    /// lives beside `settings.plist`, never in the site's git repo.
    public static let filename = "posse-syndication.json"
    /// All recorded syndications, in the order they were posted.
    public var entries: [Entry]

    /// Creates a ledger; empty by default, matching a site that has never syndicated.
    public init(entries: [Entry] = []) { self.entries = entries }

    private struct Envelope: Codable { let entries: [Entry] }

    /// Loads the ledger from `configDirectory`, or `nil` if the file is missing or unreadable.
    /// Deliberately non-throwing: a missing or corrupt ledger degrades to "never syndicated"
    /// rather than blocking the deploy pipeline, and the posting side's stable
    /// idempotency/record keys blunt the resulting re-post attempts.
    public static func load(from configDirectory: URL) -> POSSESyndicationLog? {
        guard let data = try? Data(contentsOf: configDirectory.appendingPathComponent(filename)) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return POSSESyndicationLog(entries: envelope.entries)
    }

    /// Atomically writes the ledger (creating `configDirectory` if needed). Pretty-printed with
    /// sorted keys so the file diffs cleanly when a user inspects Config/ by hand.
    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(entries: entries))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }

    /// Whether this post has already been syndicated to this platform — the guard that makes a
    /// re-run of the deploy pipeline a no-op instead of a double post.
    public func contains(canonicalURL: URL, platform: String) -> Bool {
        entries.contains { $0.canonicalURL == canonicalURL && $0.platform == platform }
    }

    /// Appends `entry` unless its (canonicalURL, platform) pair is already ledgered — recording
    /// is idempotent so callers don't need their own dedup check.
    public mutating func record(_ entry: Entry) {
        guard !contains(canonicalURL: entry.canonicalURL, platform: entry.platform) else { return }
        entries.append(entry)
    }

    /// Stamps ``Entry/backfeedSentAt`` on the ledgered entry matching `entry`'s
    /// (canonicalURL, platform) pair; a no-op if no match exists. Matching by identity pair
    /// rather than full equality means the caller's copy needn't be byte-identical to the
    /// stored one.
    public mutating func markBackfeedSent(for entry: Entry, at date: Date) {
        guard let index = entries.firstIndex(where: {
            $0.canonicalURL == entry.canonicalURL && $0.platform == entry.platform
        }) else { return }
        entries[index].backfeedSentAt = date
    }
}
