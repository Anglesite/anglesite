import Foundation

/// Durable per-site Standard.site publish ledger. Records are content-addressed by deterministic
/// rkey, so re-publishing is always safe without this ledger — it exists for debug-pane history
/// and to give a future unpublish pass (v1.1) something to diff removed content against.
public struct StandardSitePublishLog: Equatable, Sendable {
    /// One successfully published `site.standard.document` record.
    public struct Entry: Codable, Equatable, Sendable {
        /// The document's URL path, e.g. `/blog/hello-world/` — identity for dedup purposes.
        public let path: String
        /// The record's resulting at-URI (`at://<did>/site.standard.document/<rkey>`).
        public let uri: String
        /// The record's `publishedAt` value.
        public let publishedAt: Date
        /// When this record was last successfully written (put), as opposed to `publishedAt`
        /// which reflects the content's own publish date.
        public let lastPublishedAt: Date

        /// Memberwise initializer.
        public init(path: String, uri: String, publishedAt: Date, lastPublishedAt: Date) {
            self.path = path
            self.uri = uri
            self.publishedAt = publishedAt
            self.lastPublishedAt = lastPublishedAt
        }
    }

    /// The ledger's file name inside the package's `Config/` directory — app-owned state, so it
    /// lives beside `settings.plist`, never in the site's git repo.
    public static let filename = "standard-site-publish.json"
    /// The site's `site.standard.publication` record's at-URI, once first published.
    public var publicationURI: String?
    /// All recorded documents, in the order they were first published.
    public var entries: [Entry]

    /// Creates a ledger; empty by default, matching a site that has never published.
    public init(publicationURI: String? = nil, entries: [Entry] = []) {
        self.publicationURI = publicationURI
        self.entries = entries
    }

    private struct Envelope: Codable { let publicationURI: String?; let entries: [Entry] }

    /// Loads the ledger from `configDirectory`, or `nil` if the file is missing or unreadable.
    /// Deliberately non-throwing: a missing or corrupt ledger degrades to "never published"
    /// rather than blocking the deploy pipeline — deterministic rkeys make every record safe to
    /// re-put regardless.
    public static func load(from configDirectory: URL) -> StandardSitePublishLog? {
        guard let data = try? Data(contentsOf: configDirectory.appendingPathComponent(filename)) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return StandardSitePublishLog(publicationURI: envelope.publicationURI, entries: envelope.entries)
    }

    /// Atomically writes the ledger (creating `configDirectory` if needed). Pretty-printed with
    /// sorted keys so the file diffs cleanly when a user inspects Config/ by hand.
    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(publicationURI: publicationURI, entries: entries))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }

    /// Records or replaces the ledgered entry for `entry.path` — a re-publish overwrites the
    /// prior entry's `uri`/`lastPublishedAt` in place rather than accumulating duplicates.
    public mutating func record(_ entry: Entry) {
        if let index = entries.firstIndex(where: { $0.path == entry.path }) {
            entries[index] = entry
        } else {
            entries.append(entry)
        }
    }
}
