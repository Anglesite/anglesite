import Foundation

/// Reads/writes `Source/anglesite.json` (#1169) — the git-tracked declared-intent file for a
/// site's domain, DNS, edge hardening, email, and Worker configuration. Rooted at
/// `sourceDirectory` (the `Source/` git repo), not `Config/`, following `RedirectsStore`:
/// this is site content the owner's clone must see, not app-private state.
///
/// `save(_:)` preserves any JSON key this version of the app doesn't model — both unrecognized
/// top-level sections and unrecognized fields inside a section it does know — so a hand edit or
/// a field written by a newer app version survives being loaded and re-saved by an older one.
/// This is what "unknown-key-preserving" (investigation doc §7) means in practice: only the
/// exact fields `DomainConfig` declares are ever overwritten; everything else in the existing
/// file rides along untouched.
public struct DomainConfigStore: Sendable {
    private let fileURL: URL
    private let fileManager: FileManager

    /// `fileManager` is injectable for tests.
    public init(sourceDirectory: URL, fileManager: FileManager = .default) {
        self.fileURL = sourceDirectory.appendingPathComponent("anglesite.json")
        self.fileManager = fileManager
    }

    /// A default, all-`nil`-sections `DomainConfig` when the file is absent — the normal "no
    /// declarations yet" case (investigation doc §5.6).
    ///
    /// - Throws: The underlying `DecodingError` when the file exists but isn't valid JSON or
    ///   doesn't match the schema — invalid files fail with a fix-it rather than being silently
    ///   dropped (§5.5), unlike the unknown-key tolerance `save(_:)` applies to *valid* JSON.
    public func load() throws -> DomainConfig {
        guard fileManager.fileExists(atPath: fileURL.path) else { return DomainConfig() }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(DomainConfig.self, from: data)
    }

    /// Writes `config`, merging it over whatever is already on disk so unknown keys survive.
    /// Pretty-printed and sorted (matching `RedirectsStore`/`RobotsConfigStore`) so re-saving
    /// unchanged content produces a minimal git diff, and atomic so a crash mid-write can never
    /// leave a truncated `anglesite.json` behind.
    public func save(_ config: DomainConfig) throws {
        let newData = try JSONEncoder().encode(config)
        let newFields = Self.objectFields(fromJSONData: newData)

        var existingFields: [String: JSONValue] = [:]
        if let existingData = try? Data(contentsOf: fileURL) {
            existingFields = Self.objectFields(fromJSONData: existingData)
        }

        let merged = Self.merge(newFields, into: existingFields)
        let mergedData = try JSONSerialization.data(
            withJSONObject: JSONValue.object(merged).rawValue,
            options: [.prettyPrinted, .sortedKeys]
        )
        try mergedData.write(to: fileURL, options: .atomic)
    }

    /// Parses `data` as a JSON object into `JSONValue` fields, or `[:]` for anything that isn't
    /// well-formed JSON object data. Used for both the freshly-encoded `config` (which always
    /// succeeds — a struct with named properties always encodes to a JSON object) and the
    /// existing on-disk file (which may be absent or hand-broken, where "nothing to preserve"
    /// is the correct fallback).
    private static func objectFields(fromJSONData data: Data) -> [String: JSONValue] {
        guard let any = try? JSONSerialization.jsonObject(with: data),
              case .object(let fields)? = JSONValue.from(any) else {
            return [:]
        }
        return fields
    }

    /// Deep-merges `new` over `old`: a key present in both whose values are both JSON objects is
    /// merged recursively; any other key in `new` (scalar, array, or a value whose old
    /// counterpart isn't an object) replaces the old value outright; a key only in `old` is left
    /// untouched. This is the mechanism behind `save(_:)`'s unknown-key preservation.
    private static func merge(_ new: [String: JSONValue], into old: [String: JSONValue]) -> [String: JSONValue] {
        var result = old
        for (key, newValue) in new {
            if case .object(let newNested) = newValue, case .object(let oldNested)? = old[key] {
                result[key] = .object(merge(newNested, into: oldNested))
            } else {
                result[key] = newValue
            }
        }
        return result
    }
}
