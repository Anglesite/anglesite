import Foundation

/// Rewrites a page/post's *title* in place — frontmatter `title:` for markdown-family files,
/// the first `title="…"`/`title='…'` attribute for `.astro`/`.html`. Pure and I/O-free so the
/// transform is fully unit-testable; `NavigatorRenameService` owns the disk + git side.
///
/// `.astro` files use a JavaScript component script between `---` fences (NOT YAML), so we never
/// write YAML frontmatter there — the title lives in the layout invocation's `title=` prop.
public enum PageTitleEditor {
    /// Why a rewrite produced no output. Both cases are user-recoverable, so callers surface
    /// them as validation feedback rather than failures.
    public enum RewriteError: Error, Equatable {
        /// The new title was empty (or whitespace-only) after trimming — writing it would
        /// leave the page untitled.
        case emptyTitle
        /// The file has no recognized place to put a title: an extension outside the
        /// markdown/attribute families, or an `.astro`/`.html` file with no existing
        /// `title="…"` attribute to replace (we never invent one — there's no way to know
        /// which element should carry it).
        case noEditableLocation
    }

    private static let markdownExts: Set<String> = ["md", "mdx", "mdoc", "markdown"]
    private static let attributeExts: Set<String> = ["astro", "html"]

    /// Returns `contents` with its title replaced by `newTitle` (trimmed), or a
    /// ``RewriteError`` explaining why nothing could be written. The strategy is picked by
    /// `fileExtension` alone — markdown-family files get frontmatter surgery (inserting a
    /// block if none exists), `.astro`/`.html` get their first `title=` attribute replaced —
    /// so callers don't need to sniff the contents. Returns `Result` rather than throwing so
    /// the pure transform composes cleanly in tests and in the rename service's flow.
    public static func rewrite(
        contents: String,
        fileExtension: String,
        newTitle: String
    ) -> Result<String, RewriteError> {
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .failure(.emptyTitle) }

        let ext = fileExtension.lowercased()
        if markdownExts.contains(ext) { return .success(rewriteMarkdown(contents, title: trimmed)) }
        if attributeExts.contains(ext) { return rewriteAttribute(contents, title: trimmed) }
        // Unknown extension: nowhere defined to write a title.
        return .failure(.noEditableLocation)
    }

    // MARK: - Markdown frontmatter

    /// Replace the `title:` line inside a leading `---` block, insert one if the block lacks it,
    /// or synthesize a block at the top of the file. Fence detection, key matching, and scalar
    /// quoting delegate to `Frontmatter`'s helpers; only the line-level splice — which preserves
    /// the file's existing formatting — lives here.
    private static func rewriteMarkdown(_ contents: String, title: String) -> String {
        let yaml = "title: \(Frontmatter.doubleQuoted(title))"

        // Work in LF internally so the line logic is newline-agnostic, then restore CRLF on output
        // if the source used it. (A trailing `\r` left on each split line would make `lines[0]`
        // `"---\r"`, so the closing `---` fence is never found and a duplicate block gets prepended.)
        let usesCRLF = contents.contains("\r\n")
        let normalized = usesCRLF ? contents.replacingOccurrences(of: "\r\n", with: "\n") : contents
        func finish(_ s: String) -> String {
            usesCRLF ? s.replacingOccurrences(of: "\n", with: "\r\n") : s
        }

        var lines = normalized.components(separatedBy: "\n")
        // No leading fence, or an unterminated (malformed) one — prepend a fresh block.
        guard let close = Frontmatter.closingFenceIndex(of: lines) else {
            return finish("---\n\(yaml)\n---\n\n\(normalized)")
        }

        // Look for an existing top-level `title:` between the fences, using the canonical key
        // reader so the editor only rewrites a line `Frontmatter.parse` reads as the title.
        if let titleIdx = (1..<close).first(where: { Frontmatter.splitKeyValue(lines[$0])?.key == "title" }) {
            lines[titleIdx] = yaml
        } else {
            lines.insert(yaml, at: 1)
        }
        return finish(lines.joined(separator: "\n"))
    }

    // MARK: - Attribute (astro / html)

    /// Port of `ContentScanner.titleAttrRegex` — the first `title="…"` or `title='…'`.
    private static let titleAttrRegex = try! NSRegularExpression(
        pattern: #"\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')"#
    )

    private static func rewriteAttribute(_ contents: String, title: String) -> Result<String, RewriteError> {
        let full = NSRange(contents.startIndex..<contents.endIndex, in: contents)
        guard let match = titleAttrRegex.firstMatch(in: contents, range: full) else {
            return .failure(.noEditableLocation)
        }
        // Which capture group matched tells us the delimiter: group 1 = ", group 2 = '.
        let usesDouble = match.range(at: 1).location != NSNotFound
        let delimiter: Character = usesDouble ? "\"" : "'"
        let replacement = "title=\(delimiter)\(attrEscaped(title, delimiter: delimiter))\(delimiter)"
        guard let whole = Range(match.range, in: contents) else { return .failure(.noEditableLocation) }
        return .success(contents.replacingCharacters(in: whole, with: replacement))
    }

    /// HTML-attribute-escape: always `&` and `<`/`>`, plus the active quote delimiter.
    private static func attrEscaped(_ s: String, delimiter: Character) -> String {
        var out = s.replacingOccurrences(of: "&", with: "&amp;")
                   .replacingOccurrences(of: "<", with: "&lt;")
                   .replacingOccurrences(of: ">", with: "&gt;")
        out = delimiter == "\""
            ? out.replacingOccurrences(of: "\"", with: "&quot;")
            : out.replacingOccurrences(of: "'", with: "&#39;")
        return out
    }
}
