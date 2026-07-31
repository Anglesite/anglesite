import Foundation

/// Reads and surgically rewrites the `dependencies`/`devDependencies` version
/// ranges in a package.json's raw text. `apply` never re-serializes the whole
/// file — it only replaces the specific `"name": "range"` substrings for accepted
/// offers, leaving formatting, key order, comments-adjacent content, and any
/// dependency the site added on its own completely untouched.
public enum PackageJSONDependencies {
    /// Why ``extract(from:)`` couldn't read the file. A single case: apart from unparseable
    /// JSON, every shape degrades gracefully (missing sections just yield an empty result).
    public enum ExtractionError: Error, Equatable {
        /// The text isn't valid JSON with an object root — nothing can be safely read from it.
        case invalidJSON
    }

    /// `dependencies` and `devDependencies`, kept separate (unlike `extract`,
    /// which merges them). Used where the caller needs to know which section a
    /// package belongs to, not just its version range.
    public static func extractSections(from text: String) throws -> (dependencies: [String: String], devDependencies: [String: String]) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data),
              let object = json as? [String: Any]
        else { throw ExtractionError.invalidJSON }
        let deps = object["dependencies"] as? [String: String] ?? [:]
        let devDeps = object["devDependencies"] as? [String: String] ?? [:]
        return (dependencies: deps, devDependencies: devDeps)
    }

    /// The union of `dependencies` and `devDependencies` (name -> version range).
    /// If a name appears in both sections, `devDependencies` wins (checked second).
    public static func extract(from text: String) throws -> [String: String] {
        let sections = try extractSections(from: text)
        var result = sections.dependencies
        result.merge(sections.devDependencies) { _, new in new }
        return result
    }

    /// Rewrites `text`, replacing the version-range string for each offer's
    /// package name wherever it appears as a `"name": "range"` pair *within the
    /// `dependencies`/`devDependencies` object spans* — never against the whole
    /// file. This matters because a future template dependency could share a
    /// name with an unrelated top-level key (a script name, `"version"`, a
    /// nested config value); scoping the match to the two known object spans
    /// means such a collision can never silently corrupt the wrong field. A
    /// name present in both `dependencies` and `devDependencies` gets the same
    /// new range in both places (matches `extract`'s dedup rule). A name not
    /// found in either span is silently ignored — `apply` never adds anything.
    public static func apply(_ offers: [DependencyUpdateOffer], to text: String) -> String {
        var result = text
        for offer in offers {
            let escapedName = NSRegularExpression.escapedPattern(for: offer.name)
            guard let regex = try? NSRegularExpression(pattern: "\"\(escapedName)\"\\s*:\\s*\"[^\"]*\"") else { continue }
            let replacement = "\"\(offer.name)\": \"\(offer.offeredRange)\""
            let template = NSRegularExpression.escapedTemplate(for: replacement)
            // Recompute each span against the current `result` (not once up front):
            // an earlier replacement in this same loop can shift the indices of a
            // later one, and a `Range<String.Index>` from a prior string value isn't
            // valid to reuse against a newly-mutated string.
            for key in ["dependencies", "devDependencies"] {
                guard let span = objectSpan(forKey: key, in: result) else { continue }
                let nsRange = NSRange(span, in: result)
                result = regex.stringByReplacingMatches(in: result, range: nsRange, withTemplate: template)
            }
        }
        return result
    }

    /// Inserts each offer's `"name": "range"` as a new first entry in its
    /// target `dependencies`/`devDependencies` section, copying the
    /// indentation of whatever currently comes first in that section. An
    /// offer whose target section doesn't exist in `text` at all is silently
    /// skipped — this mutates existing structure, it never fabricates a new
    /// top-level section. An offer whose name is *already* a key in the
    /// target section is also silently skipped — inserting it anyway would
    /// produce a second `"name": ...` key in the same JSON object, which is
    /// semantically broken even though most parsers (including
    /// `JSONSerialization`) tolerate it by keeping only the last value. This
    /// shouldn't be reachable through the real `DependencySync.diff` ->
    /// `DependencySyncApplier` path (diff only offers additions for names
    /// absent from the site), but this function is public and should stay
    /// safe against a stale or already-present offer regardless of caller
    /// discipline.
    public static func applyAdditions(_ offers: [DependencyAdditionOffer], to text: String) -> String {
        var result = text
        for offer in offers {
            let key = offer.section == .devDependencies ? "devDependencies" : "dependencies"
            guard let span = objectSpan(forKey: key, in: result) else { continue }
            let escapedExistingName = NSRegularExpression.escapedPattern(for: offer.name)
            if let existsRegex = try? NSRegularExpression(pattern: "\"\(escapedExistingName)\"\\s*:"),
               existsRegex.firstMatch(in: result, range: NSRange(span, in: result)) != nil {
                continue
            }
            let openBrace = span.lowerBound
            let afterBrace = result.index(after: openBrace)
            var firstContent = afterBrace
            while firstContent < span.upperBound, result[firstContent].isWhitespace {
                firstContent = result.index(after: firstContent)
            }
            let escapedName = offer.name.replacingOccurrences(of: "\"", with: "\\\"")
            let escapedRange = offer.offeredRange.replacingOccurrences(of: "\"", with: "\\\"")
            let entry = "\"\(escapedName)\": \"\(escapedRange)\""
            if result[firstContent] != "}" {
                // Non-empty section: prepend as a new first entry, copying the
                // whitespace that currently precedes the existing first entry.
                let indent = String(result[afterBrace..<firstContent])
                result.insert(contentsOf: "\(indent)\(entry),", at: afterBrace)
            } else {
                // Empty section (`{}` or `{ }`): no existing indentation to copy.
                result.replaceSubrange(afterBrace..<firstContent, with: "\n  \(entry)\n")
            }
        }
        return result
    }

    /// Finds the `{ ... }` span (braces inclusive) of the object value for a
    /// top-level `"key": { ... }` entry, or `nil` if the key isn't present at
    /// the root of the document or isn't followed by an object. Brace-depth
    /// tracking skips over quoted string content (respecting `\"` escapes) so
    /// a version range or other string value can never be mistaken for a
    /// structural brace. Candidate matches of `"key": {` are checked against
    /// their enclosing brace depth so a nested object that happens to reuse
    /// the same key name (e.g. an `"overrides": { "dependencies": {...} }`
    /// block) is skipped in favor of the real top-level one.
    private static func objectSpan(forKey key: String, in text: String) -> Range<String.Index>? {
        let escapedKey = NSRegularExpression.escapedPattern(for: key)
        guard let keyRegex = try? NSRegularExpression(pattern: "\"\(escapedKey)\"\\s*:\\s*\\{") else { return nil }
        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        let candidates = keyRegex.matches(in: text, range: fullRange)
        guard let matchRange = candidates.lazy
            .compactMap({ Range($0.range, in: text) })
            .first(where: { enclosingBraceDepth(in: text, upTo: $0.lowerBound) == 1 })
        else { return nil }

        let objectStart = text.index(before: matchRange.upperBound)  // the `{` itself
        var depth = 1
        var index = matchRange.upperBound
        var inString = false
        var escaped = false
        while index < text.endIndex {
            let char = text[index]
            if inString {
                if escaped {
                    escaped = false
                } else if char == "\\" {
                    escaped = true
                } else if char == "\"" {
                    inString = false
                }
            } else if char == "\"" {
                inString = true
            } else if char == "{" {
                depth += 1
            } else if char == "}" {
                depth -= 1
                if depth == 0 {
                    return objectStart..<text.index(after: index)
                }
            }
            index = text.index(after: index)
        }
        return nil  // unbalanced braces — malformed input, no span to offer
    }

    /// The brace-nesting depth at `index`, counting only unclosed `{` seen so
    /// far (a root document's own top-level keys sit at depth 1, just inside
    /// its opening `{`). Quoted string content is skipped (respecting `\"`
    /// escapes) so braces inside a string value are never mistaken for
    /// structural ones.
    private static func enclosingBraceDepth(in text: String, upTo index: String.Index) -> Int {
        var depth = 0
        var inString = false
        var escaped = false
        var cursor = text.startIndex
        while cursor < index {
            let char = text[cursor]
            if inString {
                if escaped {
                    escaped = false
                } else if char == "\\" {
                    escaped = true
                } else if char == "\"" {
                    inString = false
                }
            } else if char == "\"" {
                inString = true
            } else if char == "{" {
                depth += 1
            } else if char == "}" {
                depth -= 1
            }
            cursor = text.index(after: cursor)
        }
        return depth
    }
}
