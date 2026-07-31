// Sources/AnglesiteCore/ProjectConventionsStore.swift
import Foundation

/// Per-site persistence for `ProjectConventions`, at `<configDirectory>/conventions.json`.
/// Follows `ChatHistoryStore`'s precedent: `Config/` is app-owned and not git-tracked. Unlike
/// `ChatHistoryStore` (append-only JSONL), this is a single whole-value JSON file — there's one
/// current `ProjectConventions`, not a history of them.
public actor ProjectConventionsStore {
    private let fileURL: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// Points the store at `<configDirectory>/conventions.json`. Encoding uses sorted keys and
    /// ISO 8601 dates so successive saves of equal values are byte-identical (stable for
    /// change-detection and debugging); `fileManager` is injectable for tests.
    public init(configDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = configDirectory.appendingPathComponent("conventions.json")
        self.fileManager = fileManager
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        self.encoder = encoder
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    /// The stored conventions, or `nil` when the file is absent or undecodable. Both collapse
    /// to `nil` deliberately: conventions are a derived cache, so a missing or stale-schema file
    /// just means "re-extract from the site source" — never an error worth surfacing.
    public func load() -> ProjectConventions? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? decoder.decode(ProjectConventions.self, from: data)
    }

    /// Persists `conventions` atomically, creating the `Config/` directory if needed. Failures
    /// are swallowed for the same reason ``load()`` returns `nil`: the file is a re-derivable
    /// cache, and a failed write must never break the feature that triggered the extraction.
    public func save(_ conventions: ProjectConventions) {
        guard let data = try? encoder.encode(conventions) else { return }
        try? fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}
