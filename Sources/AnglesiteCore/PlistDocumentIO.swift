import Foundation

/// Stateless IO for small property-list metadata files shown in the navigator.
/// The first GUI editor version intentionally supports root dictionaries with scalar values,
/// which covers package `Info.plist` and `Config/settings.plist`.
public enum PlistDocumentIO {
    /// A loaded plist plus the file's modification date at read time, captured together so the
    /// editor can later detect external changes via
    /// ``PlistDocumentIO/externalChange(at:lastKnownModificationDate:bufferIsDirty:fileManager:)``.
    public struct Loaded: Sendable, Equatable {
        /// The root dictionary's entries, sorted by key for a stable editor order (plist
        /// dictionaries carry no inherent ordering).
        public let entries: [PlistEntry]
        /// The file's modification date when loaded, or `nil` if the filesystem didn't report
        /// one. Feed this back as `lastKnownModificationDate` when checking for external edits.
        public let modificationDate: Date?
    }

    /// One key/value row of the root dictionary, in editor-friendly form. `Identifiable` by key
    /// so SwiftUI lists can track rows — which is also why
    /// ``PlistDocumentIO/PlistError/duplicateKey(_:)`` is a save-time error rather than
    /// silently last-write-wins.
    public struct PlistEntry: Sendable, Equatable, Identifiable {
        /// The key doubles as the identity — plist dictionaries can't hold duplicate keys, so
        /// no synthetic ID is needed.
        public var id: String { key }
        /// The dictionary key. Whitespace is trimmed at save; a blank result is a
        /// ``PlistDocumentIO/PlistError/blankKey`` error.
        public var key: String
        /// The entry's typed value.
        public var value: PlistValue

        /// Creates an entry row. Public so the editor UI can build new rows, not just receive
        /// loaded ones.
        public init(key: String, value: PlistValue) {
            self.key = key
            self.value = value
        }
    }

    /// A typed scalar value the editor can round-trip. Non-scalar values aren't dropped on
    /// load — they surface as ``PlistDocumentIO/PlistValue/unsupported(_:)`` so the row stays visible (and save-blocked)
    /// rather than silently vanishing from the file on the next save.
    public enum PlistValue: Sendable, Equatable {
        /// A plist string.
        case string(String)
        /// A plist boolean. Distinguished from numbers at load time (plists box both the same
        /// way off-Darwin) so the editor can show a checkbox rather than 0/1.
        case bool(Bool)
        /// A plist integer.
        case integer(Int)
        /// A plist real (float or double).
        case double(Double)
        /// A plist date.
        case date(Date)
        /// A value this editor can't represent — the payload is a human-readable type name
        /// ("Array", "Dictionary", "Data"). Saving a row with this value throws
        /// ``PlistDocumentIO/PlistError/unsupportedValue(key:description:)``.
        case unsupported(String)

        /// The value's payload-free ``PlistDocumentIO/PlistValueKind``, so UI can compare and
        /// display value types without pattern-matching every case.
        public var kind: PlistValueKind {
            switch self {
            case .string: return .string
            case .bool: return .bool
            case .integer: return .integer
            case .double: return .double
            case .date: return .date
            case .unsupported: return .unsupported
            }
        }
    }

    /// Payload-free mirror of ``PlistDocumentIO/PlistValue``, `CaseIterable` + `Identifiable`
    /// so editor UI can enumerate and compare value types without inventing placeholder values.
    public enum PlistValueKind: String, Sendable, CaseIterable, Identifiable {
        /// Mirrors ``PlistDocumentIO/PlistValue/string(_:)``.
        case string
        /// Mirrors ``PlistDocumentIO/PlistValue/bool(_:)``.
        case bool
        /// Mirrors ``PlistDocumentIO/PlistValue/integer(_:)``.
        case integer
        /// Mirrors ``PlistDocumentIO/PlistValue/double(_:)``.
        case double
        /// Mirrors ``PlistDocumentIO/PlistValue/date(_:)``.
        case date
        /// Mirrors ``PlistDocumentIO/PlistValue/unsupported(_:)`` — included so an unsupported
        /// row can still report a kind, not as a type the owner should choose.
        case unsupported

        /// `Identifiable` by raw value so pickers can iterate `allCases` directly.
        public var id: String { rawValue }
    }

    /// What can go wrong loading or saving. All four are surfaced to the owner via
    /// `LocalizedError` below rather than mapped to generic I/O failures.
    public enum PlistError: Error, Sendable, Equatable {
        /// The file's root object isn't a dictionary. Array-rooted plists are legal plist
        /// files but outside this editor's intentional v1 scope.
        case rootNotDictionary
        /// Two rows resolved to the same key at save time. An explicit error because rows are
        /// `Identifiable` by key — silently keeping the last write would also corrupt SwiftUI's
        /// row identity.
        case duplicateKey(String)
        /// A row's key was empty after whitespace trimming.
        case blankKey
        /// A row still holds a ``PlistDocumentIO/PlistValue/unsupported(_:)`` value, which this
        /// editor can't serialize; `description` is the human-readable type name for the alert.
        case unsupportedValue(key: String, description: String)
    }

    /// Reads the plist at `url` into editor rows plus the modification date needed later by
    /// ``PlistDocumentIO/externalChange(at:lastKnownModificationDate:bufferIsDirty:fileManager:)``.
    ///
    /// - Throws: ``PlistDocumentIO/PlistError/rootNotDictionary`` for a non-dictionary root, or
    ///   the underlying read/deserialization error.
    public static func load(_ url: URL, fileManager: FileManager = .default) throws -> Loaded {
        let data = try Data(contentsOf: url)
        let object = try PropertyListSerialization.propertyList(from: data, options: [], format: nil)
        guard let dictionary = object as? [String: Any] else {
            throw PlistError.rootNotDictionary
        }
        let entries = dictionary.keys.sorted().map { key in
            PlistEntry(key: key, value: value(from: dictionary[key] as Any))
        }
        return Loaded(entries: entries, modificationDate: try modificationDate(of: url, fileManager: fileManager))
    }

    /// Validates the rows (trimmed keys, no blanks, no duplicates, no unsupported values) and
    /// atomically writes them as XML. Validation happens *before* serialization so a bad row
    /// never clobbers the file on disk.
    ///
    /// - Returns: The file's new modification date — feed it back as
    ///   `lastKnownModificationDate` so the editor's own save isn't flagged as an external
    ///   change. Discardable for callers that don't track external edits.
    /// - Throws: A ``PlistDocumentIO/PlistError`` validation case, or the underlying
    ///   serialization/write error.
    @discardableResult
    public static func save(_ entries: [PlistEntry], to url: URL, fileManager: FileManager = .default) throws -> Date? {
        var dictionary: [String: Any] = [:]
        for entry in entries {
            let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty else { throw PlistError.blankKey }
            guard dictionary[key] == nil else { throw PlistError.duplicateKey(key) }
            dictionary[key] = try serializedValue(entry.value, key: key)
        }
        let data = try PropertyListSerialization.data(fromPropertyList: dictionary, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        return try modificationDate(of: url, fileManager: fileManager)
    }

    /// Detects whether the file changed on disk behind the editor, reusing
    /// ``FileDocumentIO``'s `ExternalChange` verdict so plist and text editors share one
    /// reload/conflict vocabulary. Modification-date comparison only — a same-date rewrite is
    /// indistinguishable from no change, which is acceptable for the small metadata files this
    /// editor targets.
    ///
    /// - Parameters:
    ///   - url: The plist file to check.
    ///   - lastKnownModificationDate: The date returned by the last `load`/`save`; `nil`
    ///     disables detection (nothing to compare against).
    ///   - bufferIsDirty: Whether the editor holds unsaved edits — this is what distinguishes
    ///     a safe `reloadable` from a `conflict` the owner must resolve.
    ///   - fileManager: File-attribute source, injectable for tests.
    /// - Returns: `.none`, or `.reloadable`/`.conflict` carrying the raw on-disk contents.
    public static func externalChange(
        at url: URL,
        lastKnownModificationDate: Date?,
        bufferIsDirty: Bool,
        fileManager: FileManager = .default
    ) throws -> FileDocumentIO.ExternalChange {
        let current = try modificationDate(of: url, fileManager: fileManager)
        guard let current, let last = lastKnownModificationDate, current > last else {
            return .none
        }
        let diskContents = try String(contentsOf: url, encoding: .utf8)
        return bufferIsDirty ? .conflict(diskContents) : .reloadable(diskContents)
    }

    private static func value(from object: Any) -> PlistValue {
        switch object {
        case let value as String:
            return .string(value)
        case let value as Date:
            return .date(value)
        case let value as NSNumber:
            #if canImport(Darwin)
            let isBool = CFGetTypeID(value) == CFBooleanGetTypeID()
            #else
            // CFGetTypeID/CFBooleanGetTypeID (CoreFoundation) don't exist off Darwin. Empirically,
            // swift-corelibs-foundation's PropertyListSerialization boxes plist booleans with
            // objCType "c" and every plist number (integer or real) with "i"/"q"/"d"/"f" — never
            // "c" — matching the `["f", "d"].contains(type)` check just below.
            let isBool = String(cString: value.objCType) == "c"
            #endif
            if isBool {
                return .bool(value.boolValue)
            }
            let type = String(cString: value.objCType)
            if ["f", "d"].contains(type) {
                return .double(value.doubleValue)
            }
            return .integer(value.intValue)
        case is [Any]:
            return .unsupported("Array")
        case is [String: Any]:
            return .unsupported("Dictionary")
        case is Data:
            return .unsupported("Data")
        default:
            return .unsupported(String(describing: type(of: object)))
        }
    }

    private static func serializedValue(_ value: PlistValue, key: String) throws -> Any {
        switch value {
        case .string(let string):
            return string
        case .bool(let bool):
            return bool
        case .integer(let int):
            return int
        case .double(let double):
            return double
        case .date(let date):
            return date
        case .unsupported(let description):
            throw PlistError.unsupportedValue(key: key, description: description)
        }
    }

    private static func modificationDate(of url: URL, fileManager: FileManager) throws -> Date? {
        try fileManager.attributesOfItem(atPath: url.path(percentEncoded: false))[.modificationDate] as? Date
    }
}

extension PlistDocumentIO.PlistError: LocalizedError {
    /// Owner-facing message for each validation failure, phrased about the document ("Keys
    /// can't be blank") rather than the plist format, per the app's advise-don't-delegate voice.
    public var errorDescription: String? {
        switch self {
        case .rootNotDictionary:
            return "Only dictionary property lists can be edited here."
        case .duplicateKey(let key):
            return "The key \(key) appears more than once."
        case .blankKey:
            return "Keys can't be blank."
        case .unsupportedValue(let key, let description):
            return "\(key) is a \(description.lowercased()) value, which this editor can't save yet."
        }
    }
}
