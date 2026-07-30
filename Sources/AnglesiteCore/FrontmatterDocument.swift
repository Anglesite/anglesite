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
                // A bare `key:` header followed by `- …` lines is either a flat string list or a
                // list of records (`  - field: value` starts a record; deeper-indented
                // `field: value` lines continue it). Walk the block **once**, building both
                // readings, then let what the whole block actually contained decide.
                //
                // The rule: it is an object array iff at least one record anywhere in the block
                // consumed a continuation line.
                //
                // Why not "the first item parses as `key: value`" — that alone is far too weak.
                // `Frontmatter.splitKeyValue` splits on the first colon with no space required, so
                // unquoted flat-array items like `- https://example.com` (key "https") or
                // `- Monday: 9:00-17:00` (key "Monday") match it. Those are exactly the shapes of
                // two shipped `.stringArray` fields — `member.links` and `businessProfile.hours` —
                // and misreading one as an object array makes `TypedContentEditor.decode` yield an
                // empty list, which the next save writes back over the author's real data.
                //
                // Why the evidence must come from the *whole* block, not a peek at the first
                // record: records need not be uniform. A hand-edited, incrementally filled-in list
                // can easily put the short record first —
                //
                //     experience:
                //       - title: "Engineer"
                //       - title: "Intern"
                //         org: "Acme"
                //
                // — and judging from the first record alone would call that flat, stranding
                // `org: "Acme"` as an orphaned raw line detached from `experience` and showing the
                // editor zero rows. Scanning the whole block gets both orderings right.
                //
                // Documented trade-off: a block whose records are *all* single-field (nothing
                // indented under any dash) is read as a flat string list. Nothing in the source
                // distinguishes it from a flat list of `key: value`-shaped strings, and every
                // planned use of this primitive (h-resume `experience`/`education`:
                // title/org/start/end/description) has several fields in at least one record.
                // Losing real data is not an acceptable price for the degenerate case.
                var records: [[FrontmatterRecordField]] = []
                var items: [String] = []
                var sawContinuation = false
                var k = j + 1
                while k < block.count, let itemText = Frontmatter.blockArrayItem(block[k]) {
                    let itemIndent = dashIndent(of: block[k])
                    var record: [FrontmatterRecordField] = []
                    if let (fieldKey, fieldRaw) = Frontmatter.splitKeyValue(itemText) {
                        record.append(FrontmatterRecordField(fieldKey, Frontmatter.parseScalarOrArray(fieldRaw)))
                    }
                    items.append(Frontmatter.unquote(itemText))
                    verbatim.append(block[k])
                    k += 1
                    while k < block.count,
                          let (fieldKey, fieldRaw) = recordContinuation(block[k], dashIndent: itemIndent) {
                        record.append(FrontmatterRecordField(fieldKey, Frontmatter.parseScalarOrArray(fieldRaw)))
                        verbatim.append(block[k])
                        sawContinuation = true
                        k += 1
                    }
                    records.append(record)
                }
                // With no continuation anywhere, the inner loop consumed nothing, so `k` and
                // `verbatim` are exactly what a flat-only walk would have produced — the two
                // readings only diverge once there is record evidence.
                if sawContinuation {
                    value = .objectArray(records)
                } else {
                    value = items.isEmpty ? .string("") : .array(items)
                }
                j = k
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

    /// Leading-space count of a block-array item line — the indent its record's continuation lines
    /// must exceed.
    private static func dashIndent(of line: String) -> Int {
        line.prefix(while: { $0 == " " }).count
    }

    /// If `line` continues the record started by a `- key: value` item whose dash sits at
    /// `dashIndent`, returns that continuation's parsed `key: value`; otherwise `nil`.
    ///
    /// A continuation is indented strictly deeper than the dash, is not itself a new `-` item, and
    /// parses as `key: value`. Single source of truth for that shape: `parse` uses it both to
    /// *detect* an object array (peeking at the line after the first item) and to *consume* each
    /// record's remaining fields, so the two can't drift apart.
    private static func recordContinuation(_ line: String, dashIndent: Int) -> (key: String, value: String)? {
        guard Self.dashIndent(of: line) > dashIndent else { return nil }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.hasPrefix("-") else { return nil }
        return Frontmatter.splitKeyValue(trimmed)
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
