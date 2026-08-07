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
    /// Per-file-path locks that serialize access to `anglesite.json` to prevent concurrent writes from
    /// dropping updates (#1189). Multiple producers (DomainOperations, HardenExecutor,
    /// CustomDomainAttachCommand, EmailSetupExecutor, and others) may call `save()`
    /// concurrently; locks ensure the read-modify-write sequence is atomic. Scoped per file path so
    /// concurrent saves to different sites' configs don't block each other.
    /// Note: Uses `NSLock` (OS-thread blocking) rather than Swift `actor` (cooperative suspension),
    /// which is acceptable here due to the short critical section. An actor-based store may be
    /// reconsidered if contention becomes a concern (#1189).
    private static let fileLocks = SharedInstanceCache<NSLock>()

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
    /// unchanged content produces a minimal git diff. The read-modify-write sequence is protected
    /// by a per-file lock to ensure atomicity when multiple producers call `save()` concurrently (#1189).
    ///
    /// This merge cannot distinguish "this field is unknown to the current app version" from
    /// "this field is known but the caller passed `nil` for it" — both look identical to `merge`
    /// (the key is simply absent from `newFields`), and both leave whatever is already on disk
    /// for that key untouched. Concretely: saving a `DomainConfig(domain: .init(hostname:
    /// "new.example.com"))` over a file that already has `"domain":{"hostname":"old.example.com",
    /// "attach":true}` does *not* clear `attach` — it stays `true`. `save(DomainConfig())` over a
    /// populated file changes nothing but `version`. So `save(_:)` is not equivalent to erasing
    /// prior declarations, only to layering new ones on top; there is currently no way to express
    /// "remove this previously-declared field/section." Real deletion semantics are deferred to
    /// whichever later slice first needs them (e.g. #1170 or beyond).
    ///
    /// Unlike every other field, `version` is non-optional on `DomainConfig`, so it's always
    /// present in the freshly-encoded fields and would otherwise always win the merge — even a
    /// stale caller that just defaulted `version` to `1` would silently stamp a newer on-disk
    /// schema version back down. `save(_:)` guards against that one case explicitly: it never
    /// lets the merge lower the on-disk `version`.
    ///
    /// Unknown-key preservation also doesn't recurse into arrays: `dns.managedRecords` and
    /// `edge.cloudflare.wafRules` are replaced wholesale by whatever `config` provides, the same
    /// as any other non-object value. A hand-added array element, or an unknown field inside one,
    /// does not survive a save that touches the containing array.
    public func save(_ config: DomainConfig) throws {
        let lock = Self.fileLocks.instance(forKey: fileURL.path) { NSLock() }
        lock.lock()
        defer { lock.unlock() }

        try performSave(config)
    }

    /// Loads the current config (falling back to an empty `DomainConfig` if the file is absent or
    /// fails to decode — mirrors `DomainConfigStore.update(sourceDirectory:_:)`'s pre-#1255
    /// fallback), applies `mutate` in place, and saves the result — holding the per-file lock
    /// (#1189) across the *entire* load-mutate-save sequence, not just the save. This is what
    /// closes #1255: two concurrent calls that both mutate the same top-level section can no
    /// longer both load the same stale snapshot before either saves, because the second caller's
    /// `load()` here can't run until the first caller's `performSave(_:)` has released the lock.
    ///
    /// - Warning: `mutate` runs while the per-file lock is held. It must not call back into
    ///   `save(_:)` or `update(_:)` on a `DomainConfigStore` for this same `anglesite.json` path —
    ///   `NSLock` isn't reentrant, so that would deadlock. Every current caller's closure only does
    ///   in-memory `DomainConfig` field mutation; keep new ones that way too.
    @discardableResult
    public func update(_ mutate: (inout DomainConfig) -> Void) -> Bool {
        let lock = Self.fileLocks.instance(forKey: fileURL.path) { NSLock() }
        lock.lock()
        defer { lock.unlock() }

        var config = (try? load()) ?? DomainConfig()
        mutate(&config)
        return (try? performSave(config)) != nil
    }

    /// The unlocked body of `save(_:)`, reused by `update(_:)` so it can hold the lock across its
    /// own load+mutate+save without `NSLock`'s non-reentrancy deadlocking a nested `save()` call.
    private func performSave(_ config: DomainConfig) throws {
        let newData = try JSONEncoder().encode(config)
        var newFields = Self.objectFields(fromJSONData: newData)

        var existingFields: [String: JSONValue] = [:]
        if let existingData = try? Data(contentsOf: fileURL) {
            existingFields = Self.objectFields(fromJSONData: existingData)
        }

        if case .int(let onDiskVersion)? = existingFields["version"], onDiskVersion > config.version {
            newFields["version"] = .int(onDiskVersion)
        }

        let merged = Self.merge(newFields, into: existingFields)
        let mergedData = try JSONSerialization.data(
            withJSONObject: JSONValue.object(merged).rawValue,
            options: [.prettyPrinted, .sortedKeys]
        )
        let mergedString = String(data: mergedData, encoding: .utf8) ?? "{}"
        let text = mergedString.hasSuffix("\n") ? mergedString : mergedString + "\n"
        try text.write(to: fileURL, atomically: true, encoding: .utf8)
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
