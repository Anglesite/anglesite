import Foundation

/// Native port of the plugin's `server/annotations.mjs` (Bucket 1, #275).
///
/// Reads and writes the owner's "sticky note" annotations at `<projectRoot>/annotations.json`,
/// replacing the `add_annotation` / `list_annotations` / `resolve_annotation` MCP round-trips with
/// direct filesystem work. Byte-compatible with the Node store it supersedes: it reads both the
/// versioned wrapper (`{ version, annotations }`) and the legacy bare-array format, and writes the
/// versioned wrapper with ISO-8601 (fractional-second) timestamps so an external `claude` CLI or
/// the sidecar can still round-trip the file.
///
/// The filesystem is the source of truth; there is no in-memory cache — every call re-reads disk.
public enum AnnotationStore {
    /// On-disk filename, relative to the project (`Source/`) root. Matches `annotations.mjs`.
    static let filename = "annotations.json"
    /// Schema version stamped into the wrapper, mirroring the Node store.
    static let schemaVersion = 1
    /// Hard cap on unresolved annotations, mirroring `annotations.mjs`'s `MAX_UNRESOLVED`.
    static let maxUnresolved = 50

    /// nanoid alphabet from `annotations.mjs` — 64 URL-safe characters indexed by `byte & 63`.
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")

    /// The store's two refusals, mirroring the errors `annotations.mjs` throws so callers see
    /// the same failure modes whichever store backs them.
    public enum AnnotationStoreError: Error, Equatable {
        /// `add` rejected because `maxUnresolved` unresolved annotations already exist.
        case limitReached(Int)
        /// `resolve` couldn't find an annotation with the given id.
        case notFound(String)
    }

    // MARK: - Read / write

    /// Load all annotations (resolved and unresolved). Returns `[]` if the file is missing or
    /// unparseable, matching the Node store's tolerant behavior. Accepts both the versioned
    /// wrapper and the legacy bare-array format.
    public static func load(in directory: URL) -> [Annotation] {
        let url = directory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = makeDecoder()
        if let wrapper = try? decoder.decode(Wrapper.self, from: data) {
            return wrapper.annotations
        }
        if let bare = try? decoder.decode([Annotation].self, from: data) {
            return bare
        }
        return []
    }

    /// Persist `annotations` as the versioned wrapper with a trailing newline, byte-identical to
    /// the Node store's `JSON.stringify({ version, annotations }, null, 2) + "\n"`.
    public static func save(_ annotations: [Annotation], in directory: URL) throws {
        let text = serialize(annotations) + "\n"
        // `.atomic` writes to a sibling temp file and renames it over the target, so a crash
        // mid-write can't truncate annotations.json (which `load` would then read back as []).
        try Data(text.utf8).write(to: directory.appendingPathComponent(filename), options: .atomic)
    }

    /// Render the versioned wrapper exactly as `JSON.stringify(obj, null, 2)` would: keys in
    /// insertion order (`version`, then `annotations`; per-entry `id, path, selector, [sourceFile],
    /// text, resolved, createdAt, [resolvedAt]`), two-space indentation, and ECMA string escaping.
    /// Foundation's `JSONEncoder` can't be used here — it reorders keys and spaces colons
    /// differently — so the small, well-bounded object shape is serialized by hand.
    static func serialize(_ annotations: [Annotation]) -> String {
        guard !annotations.isEmpty else {
            return "{\n  \"version\": \(schemaVersion),\n  \"annotations\": []\n}"
        }
        let entries = annotations.map { entryJSON($0) }.joined(separator: ",\n")
        return """
        {
          "version": \(schemaVersion),
          "annotations": [
        \(entries)
          ]
        }
        """
    }

    /// Serialize one annotation as a `JSON.stringify(…, 2)` array element: the object opens at
    /// four-space indent, its fields at six.
    private static func entryJSON(_ a: Annotation) -> String {
        var lines: [String] = []
        lines.append("      \(field("id", a.id))")
        lines.append("      \(field("path", a.path))")
        lines.append("      \(field("selector", a.selector))")
        if let sourceFile = a.sourceFile {
            lines.append("      \(field("sourceFile", sourceFile))")
        }
        lines.append("      \(field("text", a.text))")
        lines.append("      \"resolved\": \(a.resolved ? "true" : "false")")
        lines.append("      \(field("createdAt", isoFractional.string(from: a.createdAt)))")
        if let resolvedAt = a.resolvedAt {
            lines.append("      \(field("resolvedAt", isoFractional.string(from: resolvedAt)))")
        }
        return "    {\n" + lines.joined(separator: ",\n") + "\n    }"
    }

    private static func field(_ key: String, _ value: String) -> String {
        "\"\(key)\": \(escapeJSONString(value))"
    }

    /// Escape a string exactly as `JSON.stringify` does: quote/backslash and the C0 control set
    /// (with the short forms `\b \t \n \f \r`), everything else emitted as raw UTF-8 — forward
    /// slashes and non-ASCII are left untouched.
    static func escapeJSONString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
            case let c where c.value < 0x20:
                out += String(format: "\\u%04x", c.value)
            default:
                out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
        return out
    }

    // MARK: - Operations

    /// Create a new unresolved annotation, persist it, and return it. Throws `.limitReached` once
    /// `maxUnresolved` unresolved annotations already exist.
    @discardableResult
    public static func add(
        in directory: URL,
        path: String,
        selector: String,
        text: String,
        sourceFile: String?,
        now: Date = Date()
    ) throws -> Annotation {
        var annotations = load(in: directory)
        let unresolved = annotations.filter { !$0.resolved }.count
        if unresolved >= maxUnresolved {
            throw AnnotationStoreError.limitReached(maxUnresolved)
        }
        let annotation = Annotation(
            id: nanoid(),
            path: path,
            selector: selector,
            sourceFile: sourceFile,
            text: text,
            resolved: false,
            createdAt: now,
            resolvedAt: nil
        )
        annotations.append(annotation)
        try save(annotations, in: directory)
        return annotation
    }

    /// List unresolved annotations, optionally filtered to a single page `path`. Resolved
    /// annotations are always excluded, mirroring `listAnnotations`.
    public static func list(in directory: URL, path: String? = nil) -> [Annotation] {
        var annotations = load(in: directory).filter { !$0.resolved }
        if let path {
            annotations = annotations.filter { $0.path == path }
        }
        return annotations
    }

    /// Mark the annotation with `id` resolved (stamping `resolvedAt`), persist, and return it.
    /// Throws `.notFound` if no annotation has that id.
    @discardableResult
    public static func resolve(in directory: URL, id: String, now: Date = Date()) throws -> Annotation {
        var annotations = load(in: directory)
        guard let index = annotations.firstIndex(where: { $0.id == id }) else {
            throw AnnotationStoreError.notFound(id)
        }
        // NOTE: re-stamps `resolvedAt` even if already resolved — this deliberately mirrors
        // `annotations.mjs`'s unconditional `resolveAnnotation`. Don't add an early-return guard
        // without also changing the Node reference, or the two stores diverge.
        let existing = annotations[index]
        let resolved = Annotation(
            id: existing.id,
            path: existing.path,
            selector: existing.selector,
            sourceFile: existing.sourceFile,
            text: existing.text,
            resolved: true,
            createdAt: existing.createdAt,
            resolvedAt: now
        )
        annotations[index] = resolved
        try save(annotations, in: directory)
        return resolved
    }

    // MARK: - nanoid

    /// Generate an 8-character nanoid, mirroring `annotations.mjs`: random bytes masked into the
    /// 64-character alphabet.
    static func nanoid(size: Int = 8) -> String {
        var bytes = [UInt8](repeating: 0, count: size)
        for i in 0..<size { bytes[i] = UInt8.random(in: 0...255) }
        return String(bytes.map { alphabet[Int($0 & 63)] })
    }

    // MARK: - Coding

    private struct Wrapper: Codable {
        let version: Int
        let annotations: [Annotation]
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = isoFractional.date(from: raw) ?? isoPlain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Expected an ISO-8601 timestamp, got \"\(raw)\""
            ))
        }
        return decoder
    }

    private nonisolated(unsafe) static let isoPlain = ISO8601DateFormatter()
    private nonisolated(unsafe) static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
