// Sources/AnglesiteCore/ProjectConventionsExtractor.swift
import Foundation

/// Pure, deterministic statistics over a project's file contents (Bucket 1 — no model calls).
/// Each `*Convention` function is independently testable against fixture strings; `extract(files:)`
/// composes them into one `ProjectConventions` value. Tone/brand-term fields are left at their
/// `.empty` zero-confidence default here — those come from the throttled FM enrichment pass
/// added in Task 5.
public enum ProjectConventionsExtractor {
    /// A project file handed to the extractor as an in-memory path + contents snapshot, so
    /// extraction stays pure (no filesystem access) and each heuristic is testable against
    /// fixture strings.
    public struct ScannedFile: Sendable {
        /// Project-relative path (e.g. `src/content/posts/my-trip.mdoc`). The prefix and
        /// extension decide which conventions the file feeds — slugs come only from
        /// `src/content/`/`src/pages/`, component counts only from `.astro` files.
        public let path: String
        /// The file's full text contents.
        public let contents: String

        /// Pairs a project-relative `path` with the file's `contents`.
        public init(path: String, contents: String) {
            self.path = path
            self.contents = contents
        }
    }

    /// Runs every deterministic convention heuristic over `files` and composes the results into
    /// one ``ProjectConventions`` value. Heuristics with no signal (no headings, no alt text, …)
    /// yield zero-confidence values rather than guesses, so downstream guidance can tell
    /// "learned" from "unknown" — see `BrandVoiceGuidance.hasSignal`.
    public static func extract(files: [ScannedFile]) -> ProjectConventions {
        var conventions = ProjectConventions.empty
        conventions.writing.headingCapitalization = headingCapitalizationConvention(files: files)
        conventions.images.altTextAverageLength = altTextAverageLengthConvention(files: files)
        conventions.images.altTextEndsWithPunctuation = altTextEndsWithPunctuationConvention(files: files)
        conventions.components.usageCounts = componentUsageCountsConvention(files: files)
        conventions.naming.slugStyle = slugStyleConvention(files: files)
        conventions.seo.metaDescriptionAverageLength = metaDescriptionAverageLengthConvention(files: files)
        return conventions
    }

    // MARK: Heading capitalization

    private static let headingPattern = try! NSRegularExpression(
        pattern: "^#{1,6}\\s+(.+)$", options: [.anchorsMatchLines]
    )
    private static let stopwords: Set<String> = ["a", "an", "and", "the", "of", "to", "for", "in", "on", "with", "or"]

    static func headingCapitalizationConvention(files: [ScannedFile]) -> Learned<HeadingCapitalization> {
        var titleCaseCount = 0
        var sentenceCaseCount = 0
        var total = 0
        for file in files {
            for heading in headings(in: file.contents) {
                total += 1
                if isTitleCase(heading) { titleCaseCount += 1 }
                else if isSentenceCase(heading) { sentenceCaseCount += 1 }
            }
        }
        guard total > 0 else {
            return Learned(value: .mixed, source: .inferred(confidence: 0), sampleSize: 0)
        }
        let confidence = Double(max(titleCaseCount, sentenceCaseCount)) / Double(total)
        let style: HeadingCapitalization = confidence >= 0.7
            ? (titleCaseCount >= sentenceCaseCount ? .titleCase : .sentenceCase)
            : .mixed
        return Learned(value: style, source: .inferred(confidence: confidence), sampleSize: total)
    }

    private static func headings(in source: String) -> [String] {
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        return headingPattern.matches(in: source, range: range).compactMap { match in
            guard let r = Range(match.range(at: 1), in: source) else { return nil }
            return String(source[r]).trimmingCharacters(in: .whitespaces)
        }
    }

    private static func isTitleCase(_ heading: String) -> Bool {
        let words = heading.split(separator: " ").map(String.init)
        guard !words.isEmpty else { return false }
        return words.allSatisfy { word in
            if stopwords.contains(word.lowercased()) { return true }
            guard let first = word.first else { return false }
            return first.isUppercase
        }
    }

    /// Sentence case: first word capitalized, and at least one later word starts lowercase (which
    /// rules out title case). This is a heuristic, not a grammar check — good enough to bucket a
    /// site's dominant style, not to grade any single heading.
    private static func isSentenceCase(_ heading: String) -> Bool {
        let words = heading.split(separator: " ").map(String.init)
        guard let firstChar = words.first?.first, firstChar.isUppercase else { return false }
        guard words.count > 1 else { return true }
        return words.dropFirst().contains { word in
            guard let c = word.first else { return false }
            return c.isLowercase
        }
    }

    // MARK: Alt text

    private static let markdownImagePattern = try! NSRegularExpression(pattern: "!\\[([^\\]]*)\\]\\([^)]*\\)")
    private static let htmlAltPattern = try! NSRegularExpression(pattern: "alt=\"([^\"]*)\"")

    static func altTextAverageLengthConvention(files: [ScannedFile]) -> Learned<Int> {
        let values = altTexts(files: files).filter { !$0.isEmpty }
        guard !values.isEmpty else {
            return Learned(value: 0, source: .inferred(confidence: 0), sampleSize: 0)
        }
        let average = values.reduce(0) { $0 + $1.count } / values.count
        return Learned(value: average, source: .inferred(confidence: 1), sampleSize: values.count)
    }

    static func altTextEndsWithPunctuationConvention(files: [ScannedFile]) -> Learned<Bool> {
        let values = altTexts(files: files).filter { !$0.isEmpty }
        guard !values.isEmpty else {
            return Learned(value: false, source: .inferred(confidence: 0), sampleSize: 0)
        }
        let punctuation: Set<Character> = [".", "!", "?"]
        let endingCount = values.filter { punctuation.contains($0.last ?? " ") }.count
        let confidence = Double(endingCount) / Double(values.count)
        return Learned(value: confidence >= 0.5, source: .inferred(confidence: confidence), sampleSize: values.count)
    }

    private static func altTexts(files: [ScannedFile]) -> [String] {
        files.flatMap { file -> [String] in
            let range = NSRange(file.contents.startIndex..<file.contents.endIndex, in: file.contents)
            let markdown = markdownImagePattern.matches(in: file.contents, range: range).compactMap { match -> String? in
                guard let r = Range(match.range(at: 1), in: file.contents) else { return nil }
                return String(file.contents[r])
            }
            let html = htmlAltPattern.matches(in: file.contents, range: range).compactMap { match -> String? in
                guard let r = Range(match.range(at: 1), in: file.contents) else { return nil }
                return String(file.contents[r])
            }
            return markdown + html
        }
    }

    // MARK: Component usage

    private static let componentTagPattern = try! NSRegularExpression(pattern: "<([A-Z][A-Za-z0-9]*)\\b")

    static func componentUsageCountsConvention(files: [ScannedFile]) -> Learned<[String: Int]> {
        var counts: [String: Int] = [:]
        var total = 0
        for file in files where file.path.hasSuffix(".astro") {
            let range = NSRange(file.contents.startIndex..<file.contents.endIndex, in: file.contents)
            for match in componentTagPattern.matches(in: file.contents, range: range) {
                guard let r = Range(match.range(at: 1), in: file.contents) else { continue }
                counts[String(file.contents[r]), default: 0] += 1
                total += 1
            }
        }
        guard total > 0 else {
            return Learned(value: [:], source: .inferred(confidence: 0), sampleSize: 0)
        }
        return Learned(value: counts, source: .inferred(confidence: 1), sampleSize: total)
    }

    // MARK: Naming

    static func slugStyleConvention(files: [ScannedFile]) -> Learned<SlugStyle> {
        let slugs = files
            .filter { $0.path.hasPrefix("src/content/") || $0.path.hasPrefix("src/pages/") }
            .map { URL(fileURLWithPath: $0.path).deletingPathExtension().lastPathComponent }
            .filter { $0 != "index" }
        guard !slugs.isEmpty else {
            return Learned(value: .mixed, source: .inferred(confidence: 0), sampleSize: 0)
        }
        let kebabCount = slugs.filter(isKebabCase).count
        let snakeCount = slugs.filter(isSnakeCase).count
        let confidence = Double(max(kebabCount, snakeCount)) / Double(slugs.count)
        let style: SlugStyle = confidence >= 0.7
            ? (kebabCount >= snakeCount ? .kebabCase : .snakeCase)
            : .mixed
        return Learned(value: style, source: .inferred(confidence: confidence), sampleSize: slugs.count)
    }

    private static func isKebabCase(_ s: String) -> Bool {
        !s.isEmpty && !s.contains("_") && s.allSatisfy { $0.isLowercase || $0.isNumber || $0 == "-" }
    }

    private static func isSnakeCase(_ s: String) -> Bool {
        !s.isEmpty && !s.contains("-") && s.allSatisfy { $0.isLowercase || $0.isNumber || $0 == "_" }
    }

    // MARK: SEO

    static func metaDescriptionAverageLengthConvention(files: [ScannedFile]) -> Learned<Int> {
        let lengths = files.compactMap { file -> Int? in
            guard case .string(let description)? = Frontmatter.parse(file.contents)["description"],
                  !description.isEmpty
            else { return nil }
            return description.count
        }
        guard !lengths.isEmpty else {
            return Learned(value: 0, source: .inferred(confidence: 0), sampleSize: 0)
        }
        let average = lengths.reduce(0, +) / lengths.count
        return Learned(value: average, source: .inferred(confidence: 1), sampleSize: lengths.count)
    }
}
