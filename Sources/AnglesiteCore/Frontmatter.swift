import Foundation

/// A parsed frontmatter scalar/array value. Mirrors the `string | boolean | string[]` union the
/// Node `parseFrontmatter` returns — the distinction matters to the scanner (`draft === true`
/// wants a real boolean; `Array.isArray(tags)` wants a real array).
///
/// `.number` and `.date` are write-only cases: `Frontmatter.parse` never produces them (a numeric
/// or date scalar parses as `.string`), but the editor uses them via `FrontmatterDocument.set` so
/// those fields serialize **unquoted** — `rating: 4` (not `rating: "4"`) and
/// `publishDate: 2026-01-01T00:00:00.000Z` (not `…: "…"`). Quoting would make YAML read the value
/// as a string and fail a content collection's `z.number()`/non-coercing date schema. `.date`
/// carries an already-formatted scalar (the editor decides date-only vs. full ISO by field kind),
/// emitted verbatim, matching `ContentScaffold`'s unquoted dates.
public enum FrontmatterValue: Equatable, Sendable {
    /// A textual scalar — also what numeric and date scalars parse as (see the type note),
    /// since ``Frontmatter/parse(_:)`` never guesses at types it wasn't asked to distinguish.
    case string(String)
    /// A real YAML boolean (`true`/`false` unquoted) — kept distinct so scanner checks like
    /// `draft == true` can't be satisfied by the string `"true"`.
    case bool(Bool)
    /// A string array from either inline (`[a, b]`) or block (`- a`) form.
    case array([String])
    /// Write-only numeric scalar (see the type note): never produced by ``Frontmatter/parse(_:)``,
    /// but serialized **unquoted** by the editor so `z.number()` collection schemas still validate.
    case number(Double)
    /// A preformatted date scalar emitted **unquoted**. `s` must be a safe bare YAML scalar — no
    /// newlines, no `: ` (colon-space) sequences — because `FrontmatterDocument.render` emits it
    /// verbatim, unescaped. It is always produced by `TypedContentEditor.format()`
    /// (`ISO8601DateFormatter` output or its 10-char date-only prefix), which satisfies that.
    case date(String)
    /// A repeating group of small structured records — e.g. h-resume `experience` entries. Each
    /// inner `[FrontmatterRecordField]` is one record's fields in declared order; the outer array
    /// is the ordered list of records. Record field values are conventionally scalar (`.string`,
    /// `.bool`, `.number`, `.date`) — never `.array`/`.objectArray` — matching
    /// `ContentTypeField.Kind.objectArray`'s member-field restriction; nothing in this codebase
    /// constructs a nested shape, so `FrontmatterDocument.render`'s scalar renderer treats one as
    /// an empty fallback rather than recursing.
    case objectArray([[FrontmatterRecordField]])
}

/// One name/value pair inside a `FrontmatterValue.objectArray` record, in declaration order.
public struct FrontmatterRecordField: Equatable, Sendable {
    /// The field's YAML key within its record.
    public let name: String
    /// The field's value — conventionally scalar (see ``FrontmatterValue/objectArray(_:)``'s
    /// nesting restriction).
    public let value: FrontmatterValue
    /// Creates a record field. Unlabeled parameters keep literal record construction
    /// readable — these appear in bulk when building `objectArray` values.
    public init(_ name: String, _ value: FrontmatterValue) {
        self.name = name
        self.value = value
    }
}

/// Native port of `server/content-frontmatter.mjs` (Bucket 1, #275).
///
/// A deliberately minimal YAML reader for the handful of fields `list_content` needs off
/// article-like collection entries (`title`, `slug`, `draft`, `publishDate`, `date`, `tags`).
/// It parses exactly that subset — quoted/unquoted scalars, booleans, and string arrays in both
/// inline (`[a, b]`) and block (`- a`) form, top-level keys only — and leaves anything it doesn't
/// recognize out of the returned map rather than guessing.
public enum Frontmatter {
    /// Parse the leading `---` frontmatter block of `source`. Returns an empty map when there is
    /// no frontmatter at the very start of the file.
    public static func parse(_ source: String) -> [String: FrontmatterValue] {
        guard let block = frontmatterBlock(source) else { return [:] }

        var out: [String: FrontmatterValue] = [:]
        // Split on `\n` and `\r\n` (the Node parser's `/\r?\n/`) by normalizing CRLF first.
        let lines = block.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var i = 0
        while i < lines.count {
            let line = lines[i]
            defer { i += 1 }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            // Only top-level keys (no leading whitespace) start a new field.
            if let first = line.first, first == " " || first == "\t" { continue }

            guard let (key, rawValue) = splitKeyValue(line) else { continue }

            if rawValue.isEmpty {
                // Possible block array on the following indented `- item` lines.
                var items: [String] = []
                var j = i + 1
                while j < lines.count, let item = blockArrayItem(lines[j]) {
                    items.append(unquote(item))
                    j += 1
                }
                if !items.isEmpty {
                    out[key] = .array(items)
                    i = j - 1
                } else {
                    out[key] = .string("")
                }
                continue
            }

            out[key] = parseScalarOrArray(rawValue)
        }
        return out
    }

    /// Everything after the closing `---` fence — the raw markdown/astro body with the
    /// frontmatter block removed. Returns the whole input when there is no fence at the very
    /// start or the fence is unterminated (malformed file — don't eat content). Companion to
    /// `parse`, added for the content-help chunker (Slice 6, #465).
    public static func body(_ source: String) -> String {
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        guard let match = frontmatterPattern.firstMatch(in: source, range: range),
              let matched = Range(match.range, in: source)
        else { return source }
        var rest = source[matched.upperBound...]
        // Drop the closing fence's own line ending so the body starts on the next line.
        if rest.hasPrefix("\r\n") {
            rest = rest.dropFirst(2)
        } else if rest.hasPrefix("\n") {
            rest = rest.dropFirst()
        }
        return String(rest)
    }

    // MARK: - Helpers

    /// Compiled once — `frontmatterBlock` runs per page/post file during a scan, so recompiling
    /// this dotall pattern each call would be O(files).
    private static let frontmatterPattern = try! NSRegularExpression(
        pattern: "^---\\r?\\n([\\s\\S]*?)\\r?\\n---"
    )

    /// Extract the text between the opening `---<newline>` and the first following `<newline>---`,
    /// anchored at the very start of `source`. `nil` if there is no such block.
    private static func frontmatterBlock(_ source: String) -> String? {
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        guard let match = frontmatterPattern.firstMatch(in: source, range: range),
              let captured = Range(match.range(at: 1), in: source)
        else { return nil }
        return String(source[captured])
    }

    /// Split `key: value` where key is `[A-Za-z0-9_-]+`. Value is right-trimmed of surrounding
    /// whitespace (`\s*(.*)` in the Node regex, then `.trim()`).
    static func splitKeyValue(_ line: String) -> (key: String, value: String)? {
        guard let colon = line.firstIndex(of: ":") else { return nil }
        let key = String(line[line.startIndex..<colon])
        guard !key.isEmpty, key.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }) else {
            return nil
        }
        let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        return (key, value)
    }

    /// If `line` is a block-array item (`^\s*-\s+item`), return its trimmed item text.
    static func blockArrayItem(_ line: String) -> String? {
        let stripped = String(line.drop(while: { $0 == " " || $0 == "\t" }))
        guard stripped.hasPrefix("-") else { return nil }
        let afterDash = stripped.dropFirst()
        // Require at least one whitespace after the dash (the `\s+` in `-\s+`).
        guard let firstAfter = afterDash.first, firstAfter == " " || firstAfter == "\t" else { return nil }
        return String(afterDash).trimmingCharacters(in: .whitespaces)
    }

    /// Also consumed by `FrontmatterDocument` for consistent scalar/array parsing semantics.
    static func parseScalarOrArray(_ raw: String) -> FrontmatterValue {
        if raw == "true" { return .bool(true) }
        if raw == "false" { return .bool(false) }
        if raw.hasPrefix("["), raw.hasSuffix("]") {
            let inner = String(raw.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
            if inner.isEmpty { return .array([]) }
            // `omittingEmptySubsequences: false` matches JS `String.split(",")`, which keeps empties.
            return .array(
                inner.split(separator: ",", omittingEmptySubsequences: false)
                    .map { unquote($0.trimmingCharacters(in: .whitespaces)) }
            )
        }
        return .string(unquote(raw))
    }

    /// Strip a single layer of matching `"` or `'` quotes and decode YAML escapes, else return as-is.
    ///
    /// - Double-quoted scalars: single-pass `\` decoding — `\"`→`"`, `\\`→`\`, `\n`→newline,
    ///   `\t`→tab; unknown sequences keep both the backslash and the following character.
    /// - Single-quoted scalars: `''`→`'` (YAML single-quote doubling). No backslash processing.
    /// - Unquoted scalars: returned unchanged.
    static func unquote(_ s: String) -> String {
        guard s.count >= 2 else { return s }
        if s.hasPrefix("\"") && s.hasSuffix("\"") {
            return decodeDoubleQuoted(String(s.dropFirst().dropLast()))
        }
        if s.hasPrefix("'") && s.hasSuffix("'") {
            // YAML single-quoted: only escape is '' → '
            return String(s.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
        }
        return s
    }

    /// The index of the closing `---` fence line in an LF-normalized `lines` array whose first
    /// element is the opening fence — or `nil` when the content doesn't start with a fence or the
    /// fence is unterminated. Line-based companion to `parse`'s regex for the in-place editors
    /// (`FrontmatterDocument`, `PageTitleEditor`, `SyndicationFrontmatter`) that need *line
    /// indices*, not just the block text. Fences are exact `---` lines; normalize CRLF away
    /// before splitting.
    static func closingFenceIndex(of lines: [String]) -> Int? {
        guard lines.first == "---" else { return nil }
        // `dropFirst()` yields an `ArraySlice`, so the returned index is valid in `lines`.
        return lines.dropFirst().firstIndex(of: "---")
    }

    /// Render a scalar as a double-quoted YAML value that `parse`/`unquote` reads back verbatim.
    /// Order matters: backslash first, then the quote, then control characters — a literal
    /// newline in the value (e.g. a pasted multi-line title or description) must become `\n`, or
    /// it would break `---` fence detection on re-parse. `decodeDoubleQuoted` reverses each of
    /// these. Shared by every frontmatter writer (`FrontmatterDocument`, `PageTitleEditor`).
    static func doubleQuoted(_ s: String) -> String {
        let escaped = s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
        return "\"\(escaped)\""
    }

    /// Single-pass YAML double-quoted escape decoder. Processes each character once so that
    /// `\\n` (two source chars) decodes to `\` + `n` (not newline), guarding the chained-replace
    /// pitfall.
    static func decodeDoubleQuoted(_ inner: String) -> String {
        var result = ""
        result.reserveCapacity(inner.unicodeScalars.count)
        var idx = inner.startIndex
        while idx < inner.endIndex {
            let ch = inner[idx]
            if ch == "\\" {
                let next = inner.index(after: idx)
                if next < inner.endIndex {
                    switch inner[next] {
                    case "\"": result.append("\"")
                    case "\\": result.append("\\")
                    case "n":  result.append("\n")
                    case "r":  result.append("\r")
                    case "t":  result.append("\t")
                    default:
                        // Unknown escape: keep backslash + char unchanged.
                        result.append("\\")
                        result.append(inner[next])
                    }
                    idx = inner.index(after: next)
                } else {
                    // Trailing backslash with no following char — keep it.
                    result.append("\\")
                    idx = next
                }
            } else {
                result.append(ch)
                idx = inner.index(after: idx)
            }
        }
        return result
    }
}
