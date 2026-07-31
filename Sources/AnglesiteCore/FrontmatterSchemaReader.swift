import Foundation

/// Reads `src/content.config.ts` as ground truth for each content collection's declared field
/// names — this is NOT inference (see `ProjectConventionsExtractor` for the inferred fields).
///
/// This is a lightweight text scan, not a TypeScript/Zod parser: it recognizes the site
/// template's consistent shape (`const NAME = defineCollection({ ..., schema: z.object({...}) })`
/// — see `Resources/Template/src/content.config.ts`) and extracts top-level `key: z....` field
/// names inside the `z.object({...})` block. Anything it doesn't recognize is left out rather
/// than guessed, matching `Frontmatter.parse`'s "deliberately minimal" precedent.
public enum FrontmatterSchemaReader {
    /// Reads `<siteDirectory>/src/content.config.ts` and returns each collection's declared field
    /// names, keyed by collection name. A missing or unreadable config yields `[:]` rather than an
    /// error — no declared schema is a normal state (callers fall back to inferred conventions),
    /// not a failure to surface.
    public static func read(siteDirectory: URL) -> [String: [String]] {
        let url = siteDirectory.appendingPathComponent("src/content.config.ts")
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return [:] }
        return collections(fromContentConfig: source)
    }

    /// Extracts collection-name → field-name lists from content-config source text. Split out
    /// from ``read(siteDirectory:)`` so the text scan is unit-testable without a site on disk.
    /// Collections whose declaration doesn't match the template's `defineCollection` +
    /// `z.object({...})` shape are omitted (left out rather than guessed).
    public static func collections(fromContentConfig source: String) -> [String: [String]] {
        var result: [String: [String]] = [:]
        for block in collectionBlocks(in: source) {
            result[block.name] = fieldNames(in: block.schemaBody)
        }
        return result
    }

    // MARK: - Parsing

    private struct CollectionBlock {
        let name: String
        let schemaBody: String
    }

    private static let declarationPattern = try! NSRegularExpression(
        pattern: "const\\s+(\\w+)\\s*=\\s*defineCollection\\("
    )
    /// Matches field names: this flat regex is not nesting-aware, so a hypothetical nested `z.object({...})`
    /// would have its inner keys over-included alongside the top-level keys (expected for current templates).
    private static let fieldPattern = try! NSRegularExpression(pattern: "(\\w+):\\s*z\\.")

    private static func collectionBlocks(in source: String) -> [CollectionBlock] {
        var blocks: [CollectionBlock] = []
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        for match in declarationPattern.matches(in: source, range: range) {
            guard let nameRange = Range(match.range(at: 1), in: source),
                  let fullRange = Range(match.range, in: source)
            else { continue }
            let name = String(source[nameRange])
            // `fullRange.upperBound` sits right after the "defineCollection(" we just matched —
            // step back one character to land ON that opening paren.
            let openParenIndex = source.index(before: fullRange.upperBound)
            guard let body = balancedSubstring(in: source, openIndex: openParenIndex, open: "(", close: ")"),
                  let schemaKeywordRange = body.range(of: "z.object(")
            else { continue }
            let schemaOpenIndex = body.index(before: schemaKeywordRange.upperBound)
            guard let schemaBody = balancedSubstring(in: body, openIndex: schemaOpenIndex, open: "(", close: ")")
            else { continue }
            blocks.append(CollectionBlock(name: name, schemaBody: schemaBody))
        }
        return blocks
    }

    private static func fieldNames(in schemaBody: String) -> [String] {
        let range = NSRange(schemaBody.startIndex..<schemaBody.endIndex, in: schemaBody)
        return fieldPattern.matches(in: schemaBody, range: range).compactMap { match in
            guard let r = Range(match.range(at: 1), in: schemaBody) else { return nil }
            return String(schemaBody[r])
        }
    }

    /// Starting at `openIndex` (which must be the `open` character), returns the substring
    /// strictly between the matching `open`/`close` pair, honoring nesting. `nil` if the pair
    /// never balances before the string ends.
    private static func balancedSubstring(
        in source: String, openIndex: String.Index, open: Character, close: Character
    ) -> String? {
        guard source[openIndex] == open else { return nil }
        var depth = 0
        var index = openIndex
        let contentStart = source.index(after: openIndex)
        while index < source.endIndex {
            let c = source[index]
            if c == open { depth += 1 }
            else if c == close {
                depth -= 1
                if depth == 0 { return String(source[contentStart..<index]) }
            }
            index = source.index(after: index)
        }
        return nil
    }
}
