// Sources/AnglesiteCore/FrontmatterDocument.swift
import Foundation

/// A read/write model of a content file's YAML frontmatter + body.
///
/// Unlike `Frontmatter.parse` (read-only, drops unknown keys, no serialization), this preserves
/// **every** source segment — known keys, unknown keys, comments, and blank lines — in order, each
/// with its verbatim source text. A key is re-rendered only when it is `set`. Consequences the
/// editor relies on:
///
/// - An unedited `parse(...).serialized()` is the identity (modulo uniform line-ending
///   normalization for mixed endings).
/// - Editing one field never disturbs untouched keys or the body.
/// - Form-only editing can never silently drop a hand-authored key or body content.
///
/// Scalar/array parsing reuses `Frontmatter`'s internal helpers, and values are the existing
/// `FrontmatterValue`. Pure value type, no I/O.
public struct FrontmatterDocument: Equatable, Sendable {
    /// One ordered segment of the frontmatter block. A `key` segment is editable; a raw segment
    /// (comment / blank / stray line) is opaque and always serialized verbatim.
    private struct Segment: Equatable {
        var key: String?               // nil ⟹ raw passthrough segment
        var value: FrontmatterValue?   // logical value for key segments
        var verbatim: [String]?        // original source lines; nil once a key segment is mutated
    }

    private var segments: [Segment]
    /// Index into `segments` by key, for O(1) get/set. Only key segments are listed.
    ///
    /// Known limitation: if a malformed source has the **same key twice**, `indexByKey` points at
    /// the last occurrence (so get/set address it), but both segments remain in `segments`. An
    /// unedited round-trip still reproduces the duplicate verbatim (identity holds); editing that
    /// key re-renders only the last segment, leaving the first with its old value. Duplicate
    /// top-level keys are already invalid YAML, so this is accepted rather than de-duplicated.
    private var indexByKey: [String: Int]
    /// Text after the closing `---` fence, verbatim (internally newline = "\n").
    public var body: String
    private let newline: String
    private let hadFrontmatter: Bool
    /// Whether the source had anything (a body, or just a terminal newline) after the closing
    /// `---` fence. Distinguishes `"---\n…\n---"` (no trailing newline) from `"---\n…\n---\n"`, so
    /// `serialized()` doesn't inject a newline the source never had.
    private let hasBodySection: Bool

    public var keys: [String] { segments.compactMap(\.key) }

    public func value(for key: String) -> FrontmatterValue? {
        guard let i = indexByKey[key] else { return nil }
        return segments[i].value
    }

    public mutating func set(_ value: FrontmatterValue, for key: String) {
        if let i = indexByKey[key] {
            segments[i].value = value
            segments[i].verbatim = nil   // force re-render
        } else {
            indexByKey[key] = segments.count
            segments.append(Segment(key: key, value: value, verbatim: nil))
        }
    }

    public func serialized() -> String {
        guard hadFrontmatter else { return body.replacingOccurrences(of: "\n", with: newline) }
        var lines: [String] = ["---"]
        for seg in segments {
            if let verbatim = seg.verbatim {
                lines.append(contentsOf: verbatim)
            } else if let key = seg.key, let value = seg.value {
                lines.append(Self.render(key: key, value: value))
            }
        }
        lines.append("---")
        var out = lines.joined(separator: "\n")
        if hasBodySection { out += "\n" + body }
        return out.replacingOccurrences(of: "\n", with: newline)
    }

    // MARK: Parse

    public static func parse(_ source: String) -> FrontmatterDocument {
        let newline = source.contains("\r\n") ? "\r\n" : "\n"
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n")

        let all = normalized.components(separatedBy: "\n")
        // No leading fence, or an unterminated one — treat the whole source as body.
        guard let close = Frontmatter.closingFenceIndex(of: all) else {
            return FrontmatterDocument(segments: [], indexByKey: [:], body: normalized,
                                       newline: newline, hadFrontmatter: false, hasBodySection: false)
        }
        // Anything after the closing fence (even just a terminal newline → one trailing "") means
        // the source had a body section to reproduce.
        let hasBodySection = (close + 1) < all.count
        let block = Array(all[1..<close])
        // body = everything after the closing fence, rejoined (the leading separator after `---`
        // is represented by the first element being "").
        let body = Array(all[(close + 1)...]).joined(separator: "\n")

        var segments: [Segment] = []
        var indexByKey: [String: Int] = [:]
        var j = 0
        while j < block.count {
            let line = block[j]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // Comment / blank / stray-indent → raw passthrough.
            let indented = (line.first == " " || line.first == "\t")
            if trimmed.isEmpty || trimmed.hasPrefix("#") || indented {
                segments.append(Segment(key: nil, value: nil, verbatim: [line]))
                j += 1
                continue
            }
            guard let (key, rawValue) = Frontmatter.splitKeyValue(line) else {
                segments.append(Segment(key: nil, value: nil, verbatim: [line]))
                j += 1
                continue
            }

            var verbatim = [line]
            let value: FrontmatterValue
            if rawValue.isEmpty {
                if j + 1 < block.count,
                   let firstItemText = Frontmatter.blockArrayItem(block[j + 1]),
                   Frontmatter.splitKeyValue(firstItemText) != nil {
                    // Block array of records: `  - field: value` starts a record; deeper-indented
                    // `field: value` lines continue it. Heuristic: a flat string array item that
                    // itself looks like `word: value` would be misread as a record start — not a
                    // shape this codebase's flat arrays (tags/hours/image paths) ever produce.
                    var records: [[FrontmatterRecordField]] = []
                    var k = j + 1
                    while k < block.count, let itemText = Frontmatter.blockArrayItem(block[k]) {
                        let dashIndent = block[k].prefix(while: { $0 == " " }).count
                        var record: [FrontmatterRecordField] = []
                        if let (fieldKey, fieldRaw) = Frontmatter.splitKeyValue(itemText) {
                            record.append(FrontmatterRecordField(fieldKey, Frontmatter.parseScalarOrArray(fieldRaw)))
                        }
                        verbatim.append(block[k])
                        k += 1
                        while k < block.count {
                            let contLine = block[k]
                            let contIndent = contLine.prefix(while: { $0 == " " }).count
                            let trimmed = contLine.trimmingCharacters(in: .whitespaces)
                            guard contIndent > dashIndent, !trimmed.hasPrefix("-"),
                                  let (fieldKey, fieldRaw) = Frontmatter.splitKeyValue(trimmed)
                            else { break }
                            record.append(FrontmatterRecordField(fieldKey, Frontmatter.parseScalarOrArray(fieldRaw)))
                            verbatim.append(contLine)
                            k += 1
                        }
                        records.append(record)
                    }
                    value = .objectArray(records)
                    j = k
                } else {
                    // Possible block array on following `- item` lines.
                    var items: [String] = []
                    var k = j + 1
                    while k < block.count, let item = Frontmatter.blockArrayItem(block[k]) {
                        items.append(Frontmatter.unquote(item))
                        verbatim.append(block[k])
                        k += 1
                    }
                    value = items.isEmpty ? .string("") : .array(items)
                    j = k
                }
            } else {
                value = Frontmatter.parseScalarOrArray(rawValue)
                j += 1
            }
            indexByKey[key] = segments.count
            segments.append(Segment(key: key, value: value, verbatim: verbatim))
        }
        return FrontmatterDocument(segments: segments, indexByKey: indexByKey, body: body,
                                   newline: newline, hadFrontmatter: true, hasBodySection: hasBodySection)
    }

    // MARK: Render (mirrors ContentScaffold: double-quoted scalars, `[]` empty arrays, block lists)

    private static func render(key: String, value: FrontmatterValue) -> String {
        switch value {
        case .string(let s):
            return "\(key): \(Frontmatter.doubleQuoted(s))"
        case .bool(let b):
            // Bool fields canonicalize to true/false on write. YAML also accepts yes/no/on/off/1/0,
            // but we intentionally normalize here (matching ContentScaffold) — an edited bool loses
            // a non-canonical original spelling. Verbatim is still preserved for *unedited* bools.
            return "\(key): \(b)"
        case .number(let n):
            // Numbers serialize unquoted so YAML reads them as numbers (a quoted "4" fails a
            // collection's z.number() schema). Integral values drop the decimal point; the
            // magnitude guard avoids the Int(_:) overflow trap.
            return "\(key): \(formatNumber(n))"
        case .date(let s):
            // Already-formatted date scalar, emitted unquoted (matching ContentScaffold) so YAML
            // reads it as a date — a quoted scalar fails a non-coercing date schema.
            return "\(key): \(s)"
        case .array(let items):
            if items.isEmpty { return "\(key): []" }
            return ([ "\(key):" ] + items.map { "  - \(Frontmatter.doubleQuoted($0))" }).joined(separator: "\n")
        case .objectArray(let records):
            if records.isEmpty { return "\(key): []" }
            var lines = ["\(key):"]
            for record in records {
                if let first = record.first {
                    lines.append("  - \(first.name): \(renderScalar(first.value))")
                    for field in record.dropFirst() {
                        lines.append("    \(field.name): \(renderScalar(field.value))")
                    }
                } else {
                    lines.append("  - {}")
                }
            }
            return lines.joined(separator: "\n")
        }
    }

    private static func formatNumber(_ n: Double) -> String {
        (n == n.rounded() && abs(n) < 1e15) ? String(Int(n)) : String(n)
    }

    /// Renders one record field's value the same way its top-level `render(key:value:)` counterpart
    /// would, minus the `key: ` prefix (the caller supplies that at either 2- or 4-space indent).
    /// Exhaustive over every `FrontmatterValue` case for compiler-checked totality, even though
    /// record fields are conventionally scalar-only (see `FrontmatterValue.objectArray`'s doc
    /// comment) — `.array`/`.objectArray` never actually reach here in practice.
    private static func renderScalar(_ value: FrontmatterValue) -> String {
        switch value {
        case .string(let s): return Frontmatter.doubleQuoted(s)
        case .bool(let b): return "\(b)"
        case .number(let n): return formatNumber(n)
        case .date(let s): return s
        case .array(let items):
            if items.isEmpty { return "[]" }
            return "[" + items.map { Frontmatter.doubleQuoted($0) }.joined(separator: ", ") + "]"
        case .objectArray:
            return "[]"
        }
    }
}
