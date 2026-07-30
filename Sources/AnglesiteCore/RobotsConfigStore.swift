import Foundation

/// One entry's origin: which page or collection entry the app wrote it for (#1093). `nil` when an
/// entry was hand-added directly to the JSON file — `RobotsConfigStore`'s upsert/remove operations
/// only ever match entries by `source`, so a sourceless entry is never touched by app-driven writes.
public struct RobotsConfigSource: Codable, Equatable, Sendable {
    public var kind: String        // "page" | "collection"
    public var file: String?       // set when kind == "page"
    public var collection: String? // set when kind == "collection"
    public var id: String?         // set when kind == "collection"

    public init(kind: String, file: String? = nil, collection: String? = nil, id: String? = nil) {
        self.kind = kind
        self.file = file
        self.collection = collection
        self.id = id
    }

    public static func page(file: String) -> RobotsConfigSource {
        RobotsConfigSource(kind: "page", file: file)
    }

    public static func collection(_ name: String, id: String) -> RobotsConfigSource {
        RobotsConfigSource(kind: "collection", collection: name, id: id)
    }
}

public struct RobotsConfigEntry: Codable, Equatable, Sendable {
    public var path: String
    public var source: RobotsConfigSource?

    public init(path: String, source: RobotsConfigSource? = nil) {
        self.path = path
        self.source = source
    }
}

/// `src/data/robots-config.json` — the site's editable source of truth for per-route
/// noindex/disallow directives (#1093). Entries with a `source` were written by the app; entries
/// without one are hand-authored and are never touched by `RobotsConfigStore`'s write operations.
/// `extra` holds raw robots.txt lines/blocks for directives that don't fit the per-path shape.
public struct RobotsConfig: Codable, Equatable, Sendable {
    public var noindex: [RobotsConfigEntry]
    public var disallow: [RobotsConfigEntry]
    public var extra: [String]

    public init(noindex: [RobotsConfigEntry] = [], disallow: [RobotsConfigEntry] = [], extra: [String] = []) {
        self.noindex = noindex
        self.disallow = disallow
        self.extra = extra
    }
}

/// Which per-route directive an operation targets.
public enum RobotsDirective: Sendable {
    case noindex
    case disallowCrawl
}

/// Pure read/write transforms over `RobotsConfig` — no I/O. `RobotsConfigFile` below owns reading
/// and writing the actual file, the same split `PageMetadataEditor`/`buildRobotsTxt` already use.
public enum RobotsConfigStore {
    /// Missing or malformed JSON reads as an empty config — never throws. Same tolerance
    /// `readLicensingUsage` already applies to a malformed `licensing.json`.
    public static func read(_ contents: String) -> RobotsConfig {
        guard let data = contents.data(using: .utf8),
              let config = try? JSONDecoder().decode(RobotsConfig.self, from: data) else {
            return RobotsConfig()
        }
        return config
    }

    public static func contains(source: RobotsConfigSource, directive: RobotsDirective, in config: RobotsConfig) -> Bool {
        entries(for: directive, in: config).contains { $0.source == source }
    }

    /// Adds or updates the entry for `source` in `directive`'s array. Every other entry — other
    /// directive, other source, sourceless — is left exactly as it was.
    public static func upserting(
        path: String,
        source: RobotsConfigSource,
        directive: RobotsDirective,
        into config: RobotsConfig
    ) -> RobotsConfig {
        var config = config
        var list = entries(for: directive, in: config)
        if let idx = list.firstIndex(where: { $0.source == source }) {
            list[idx].path = path
        } else {
            list.append(RobotsConfigEntry(path: path, source: source))
        }
        setEntries(list, for: directive, in: &config)
        return config
    }

    /// Removes the entry for `source` from `directive`'s array, if present. `source` is never nil
    /// here, so a sourceless (hand-authored) entry can never be matched or removed this way.
    public static func removing(
        source: RobotsConfigSource,
        directive: RobotsDirective,
        from config: RobotsConfig
    ) -> RobotsConfig {
        var config = config
        var list = entries(for: directive, in: config)
        list.removeAll { $0.source == source }
        setEntries(list, for: directive, in: &config)
        return config
    }

    /// Deterministic JSON: sorted keys, entries sorted by path, trailing newline — re-saving
    /// without a real change produces no git diff.
    public static func serialized(_ config: RobotsConfig) -> String {
        var sorted = config
        sorted.noindex.sort { $0.path < $1.path }
        sorted.disallow.sort { $0.path < $1.path }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = (try? encoder.encode(sorted)) ?? Data("{}".utf8)
        let text = String(data: data, encoding: .utf8) ?? "{}"
        return text.hasSuffix("\n") ? text : text + "\n"
    }

    private static func entries(for directive: RobotsDirective, in config: RobotsConfig) -> [RobotsConfigEntry] {
        switch directive {
        case .noindex: return config.noindex
        case .disallowCrawl: return config.disallow
        }
    }

    private static func setEntries(_ entries: [RobotsConfigEntry], for directive: RobotsDirective, in config: inout RobotsConfig) {
        switch directive {
        case .noindex: config.noindex = entries
        case .disallowCrawl: config.disallow = entries
        }
    }
}

/// Disk I/O for `src/data/robots-config.json`, layered on the pure `RobotsConfigStore` transforms.
/// The relative path matches `src/data/licensing.json`'s existing location convention.
public enum RobotsConfigFile {
    public static let relativePath = "src/data/robots-config.json"

    public static func url(under sourceDirectory: URL) -> URL {
        sourceDirectory.appendingPathComponent(relativePath)
    }

    /// Missing file reads as an empty config — same tolerance as `RobotsConfigStore.read`.
    public static func read(under sourceDirectory: URL) -> RobotsConfig {
        guard let text = try? String(contentsOf: url(under: sourceDirectory), encoding: .utf8) else {
            return RobotsConfig()
        }
        return RobotsConfigStore.read(text)
    }

    public static func write(_ config: RobotsConfig, under sourceDirectory: URL) throws {
        let fileURL = url(under: sourceDirectory)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try RobotsConfigStore.serialized(config).write(to: fileURL, atomically: true, encoding: .utf8)
    }

    /// Whether `source` currently has an entry under each directive.
    public static func flags(for source: RobotsConfigSource, under sourceDirectory: URL) -> (noindex: Bool, disallowCrawl: Bool) {
        let config = read(under: sourceDirectory)
        return (
            RobotsConfigStore.contains(source: source, directive: .noindex, in: config),
            RobotsConfigStore.contains(source: source, directive: .disallowCrawl, in: config)
        )
    }

    /// Applies the desired noindex/disallowCrawl state for `source`, writing back only if an entry
    /// was actually added or removed. Re-reads fresh rather than trusting a caller's stale snapshot
    /// — narrows (doesn't eliminate) the window between two saves.
    public static func apply(
        source: RobotsConfigSource,
        noindex: Bool,
        disallowCrawl: Bool,
        path: String,
        under sourceDirectory: URL
    ) throws {
        var config = read(under: sourceDirectory)
        var changed = false
        for (directive, wants) in [(RobotsDirective.noindex, noindex), (.disallowCrawl, disallowCrawl)] {
            let present = RobotsConfigStore.contains(source: source, directive: directive, in: config)
            if wants, !present {
                config = RobotsConfigStore.upserting(path: path, source: source, directive: directive, into: config)
                changed = true
            } else if !wants, present {
                config = RobotsConfigStore.removing(source: source, directive: directive, from: config)
                changed = true
            }
        }
        guard changed else { return }
        try write(config, under: sourceDirectory)
    }
}
