import Foundation

/// Deterministic POSSE trail (#465): records published-copy URLs in the post's `syndication:`
/// frontmatter list (the u-syndication source the mf2 layer projects). Pure string → string.
///
/// Fence detection and value parsing delegate to `Frontmatter`'s helpers so what this writer
/// edits is exactly what the canonical reader (`Frontmatter.parse`) sees; only the line-level
/// splicing — which must preserve the file's existing formatting — lives here.
public enum SyndicationFrontmatter {
    /// Splices `urls` into the post's top-level `syndication:` list, preserving the file's
    /// existing formatting (including CRLF line endings) and deduplicating against items already
    /// recorded in block, inline-array, or bare-scalar form. Returns `contents` unchanged when
    /// there is nothing new to add, so callers can write the result back unconditionally without
    /// churning the file. A file with no (or an unterminated) frontmatter fence gets one
    /// synthesized around the new block — otherwise the canonical reader (`Frontmatter.parse`)
    /// would never see the URLs.
    public static func adding(urls: [String], to contents: String) -> String {
        let newURLs = urls.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !newURLs.isEmpty else { return contents }

        // Work in LF internally so fence/key scanning matches canonical `Frontmatter` semantics,
        // restoring CRLF on output if the source used it (mirrors `PageTitleEditor`).
        let usesCRLF = contents.contains("\r\n")
        let normalized = usesCRLF ? contents.replacingOccurrences(of: "\r\n", with: "\n") : contents
        func finish(_ s: String) -> String {
            usesCRLF ? s.replacingOccurrences(of: "\n", with: "\r\n") : s
        }

        var lines = normalized.components(separatedBy: "\n")

        // No leading fence (or an unterminated one): synthesize a fence around the syndication
        // block so the canonical reader actually sees the URLs.
        guard let closing = Frontmatter.closingFenceIndex(of: lines) else {
            let block = ["---", "syndication:"] + newURLs.map { "  - \($0)" } + ["---"]
            return finish((block + [normalized]).joined(separator: "\n"))
        }

        // Only a *top-level* `syndication:` key counts — `Frontmatter.splitKeyValue` rejects
        // indented lines, so a `syndication:` nested under another key (which the canonical
        // reader ignores) is never spliced into.
        guard let keyIndex = lines[..<closing].firstIndex(where: {
            Frontmatter.splitKeyValue($0)?.key == "syndication"
        }) else {
            // No syndication key yet: nothing to dedup against.
            lines.insert(contentsOf: ["syndication:"] + newURLs.map { "  - \($0)" }, at: closing)
            return finish(lines.joined(separator: "\n"))
        }

        if let inlineItems = inlineListItems(lines[keyIndex]) {
            // Inline value on the key line (`syndication: [a, b]` or a bare scalar
            // `syndication: https://a.test/1`): dedup against those items, then rewrite the
            // line as block form with existing + new items. Leaving a scalar mapping value
            // followed by a nested `- item` sequence is invalid YAML, so this must always
            // collapse to block form rather than appending after the key line.
            let toAdd = newURLs.filter { !inlineItems.contains($0) }
            guard !toAdd.isEmpty else { return contents }
            let blockLines = ["syndication:"] + (inlineItems + toAdd).map { "  - \($0)" }
            lines.replaceSubrange(keyIndex...keyIndex, with: blockLines)
            return finish(lines.joined(separator: "\n"))
        }

        // Block form: existing items are the consecutive `- item` lines right after the key,
        // read with the canonical item/unquote semantics so quoted items still dedup.
        var itemEnd = keyIndex + 1
        var existing = Set<String>()
        while itemEnd < closing, let item = Frontmatter.blockArrayItem(lines[itemEnd]) {
            existing.insert(Frontmatter.unquote(item))
            itemEnd += 1
        }
        let toAdd = newURLs.filter { !existing.contains($0) }
        guard !toAdd.isEmpty else { return contents }
        lines.insert(contentsOf: toAdd.map { "  - \($0)" }, at: itemEnd)
        return finish(lines.joined(separator: "\n"))
    }

    /// Parses the inline value(s) of a `syndication:` key line that already carries content —
    /// either an inline array (`syndication: [a, b]`) or a bare scalar
    /// (`syndication: https://a.test/1`), the latter written by hand or another tool. Returns
    /// `nil` for a bare `syndication:` key with nothing after the colon (block form, or empty).
    /// Value parsing delegates to `Frontmatter.parseScalarOrArray` so quoting and inline-array
    /// semantics match the canonical reader.
    private static func inlineListItems(_ line: String) -> [String]? {
        guard let (key, raw) = Frontmatter.splitKeyValue(line),
              key == "syndication", !raw.isEmpty
        else { return nil }
        switch Frontmatter.parseScalarOrArray(raw) {
        case .array(let items): return items.filter { !$0.isEmpty }
        case .string(let s): return s.isEmpty ? [] : [s]
        case .bool(let b): return [b ? "true" : "false"]
        case .number, .date, .objectArray: return nil  // write-only cases; parseScalarOrArray never produces them
        }
    }
}
