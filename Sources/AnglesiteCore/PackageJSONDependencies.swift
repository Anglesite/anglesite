import Foundation

/// Reads and surgically rewrites the `dependencies`/`devDependencies` version
/// ranges in a package.json's raw text. `apply` never re-serializes the whole
/// file — it only replaces the specific `"name": "range"` substrings for accepted
/// offers, leaving formatting, key order, comments-adjacent content, and any
/// dependency the site added on its own completely untouched.
public enum PackageJSONDependencies {
    public enum ExtractionError: Error, Equatable {
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
    /// top-level section.
    public static func applyAdditions(_ offers: [DependencyAdditionOffer], to text: String) -> String {
        var result = text
        for offer in offers {
            let key = offer.section == .devDependencies ? "devDependencies" : "dependencies"
            guard let span = objectSpan(forKey: key, in: result) else { continue }
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
                result.insert(contentsOf: "\(entry),\(indent)", at: afterBrace)
            } else {
                // Empty section (`{}` or `{ }`): no existing indentation to copy.
                result.replaceSubrange(afterBrace..<firstContent, with: "\n  \(entry)\n")
            }
        }
        return result
    }

    /// Finds the `{ ... }` span (braces inclusive) of the object value for a
    /// top-level `"key": { ... }` entry, or `nil` if the key isn't present or
    /// isn't followed by an object. Brace-depth tracking skips over quoted
    /// string content (respecting `\"` escapes) so a version range or other
    /// string value can never be mistaken for a structural brace.
    private static func objectSpan(forKey key: String, in text: String) -> Range<String.Index>? {
        let escapedKey = NSRegularExpression.escapedPattern(for: key)
        guard let keyRegex = try? NSRegularExpression(pattern: "\"\(escapedKey)\"\\s*:\\s*\\{") else { return nil }
        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = keyRegex.firstMatch(in: text, range: fullRange),
              let matchRange = Range(match.range, in: text)
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
}
