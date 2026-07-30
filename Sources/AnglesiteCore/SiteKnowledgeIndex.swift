import Foundation

/// Project-local retrieval index for an Astro site.
///
/// The index is intentionally lexical for v1: it reads the project's text files, extracts useful
/// metadata (frontmatter, headings, internal links), and ranks file excerpts against a user query.
/// That gives assistant features citation-ready project context without a network embedding service.
public actor SiteKnowledgeIndex {
    public struct Document: Sendable, Equatable, Identifiable {
        public let id: String
        public let siteID: String
        public let path: String
        public let kind: Kind
        public let title: String?
        public let frontmatter: [String: FrontmatterValue]
        public let headings: [String]
        public let internalLinks: [String]
        public let excerptText: String
        public let lastModified: Date

        public enum Kind: String, Sendable, Equatable, CaseIterable {
            case page
            case post
            case component
            case layout
            case content
            case config
            case style
            case script
            case other
        }
    }

    public struct SearchResult: Sendable, Equatable, Identifiable {
        public let id: String
        public let document: Document
        public let score: Double
        public let excerpt: String
        public let lineRange: ClosedRange<Int>?
    }

    public struct SearchOptions: Sendable, Equatable {
        public let limit: Int
        public let kinds: Set<Document.Kind>?

        public init(limit: Int = 8, kinds: Set<Document.Kind>? = nil) {
            self.limit = max(1, limit)
            self.kinds = kinds
        }
    }

    private var documentsBySite: [String: [String: Document]] = [:]
    private static let maxExcerptCharacters = 8_192

    public init() {}

    /// Rebuilds the site's index from disk. Missing directories and unreadable files are skipped.
    public func rebuild(siteID: String, projectRoot: URL) async {
        let documents = await Task.detached(priority: .utility) {
            Self.scan(siteID: siteID, projectRoot: projectRoot)
        }.value
        documentsBySite[siteID] = Dictionary(uniqueKeysWithValues: documents.map { ($0.path, $0) })
    }

    public func unload(siteID: String) {
        documentsBySite[siteID] = nil
    }

    public func documents(siteID: String) -> [Document] {
        (documentsBySite[siteID] ?? [:]).values.sorted { $0.path < $1.path }
    }

    public func upsertFile(siteID: String, projectRoot: URL, relativePath: String) async {
        let scanned = await Task.detached(priority: .utility) {
            Self.document(siteID: siteID, projectRoot: projectRoot, relativePath: relativePath)
        }.value
        guard let document = scanned else {
            documentsBySite[siteID]?[relativePath] = nil
            return
        }
        var siteDocs = documentsBySite[siteID] ?? [:]
        siteDocs[relativePath] = document
        documentsBySite[siteID] = siteDocs
    }

    public func removeFile(siteID: String, relativePath: String) {
        documentsBySite[siteID]?[relativePath] = nil
    }

    /// The currently-indexed document for a path, or `nil` if none is held. Lets incremental
    /// consumers (the semantic ranker) read back what `upsertFile` produced without a full scan.
    public func document(siteID: String, relativePath: String) -> Document? {
        documentsBySite[siteID]?[relativePath]
    }

    /// The stable document ID for a path. The index owns this format; consumers that key off
    /// document identity (e.g. ``SemanticRanker``) derive it here rather than reconstructing it.
    public static func documentID(siteID: String, relativePath: String) -> String {
        "\(siteID):knowledge:\(relativePath)"
    }

    public func search(siteID: String, query: String, options: SearchOptions = .init()) -> [SearchResult] {
        let terms = Self.queryTerms(query)
        guard !terms.isEmpty else { return [] }
        let phrase = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let siteDocuments = documentsBySite[siteID] else { return [] }
        let allDocuments = siteDocuments.values
        let scoped = allDocuments.filter { doc in
            guard let kinds = options.kinds else { return true }
            return kinds.contains(doc.kind)
        }

        return scoped.compactMap { document -> SearchResult? in
            let score = Self.score(document: document, terms: terms, phrase: phrase)
            guard score > 0 else { return nil }
            let snippet = Self.excerpt(from: document.excerptText, terms: terms)
            return SearchResult(
                id: "\(document.id)#\(snippet.lineRange?.lowerBound ?? 0)",
                document: document,
                score: score,
                excerpt: snippet.text,
                lineRange: snippet.lineRange
            )
        }
        .sorted {
            if $0.score != $1.score { return $0.score > $1.score }
            return $0.document.path < $1.document.path
        }
        .prefix(options.limit)
        .map { $0 }
    }

    public func formattedContext(siteID: String, query: String, limit: Int = 6) -> String? {
        let results = search(siteID: siteID, query: query, options: .init(limit: limit))
        guard !results.isEmpty else { return nil }
        var lines = [
            "Relevant project context retrieved from this Astro site:",
            "Use this context when it is relevant. Cite file paths when answering.",
        ]
        for result in results {
            let lineLabel = result.lineRange.map { range in
                range.lowerBound == range.upperBound
                    ? "line \(range.lowerBound)"
                    : "lines \(range.lowerBound)-\(range.upperBound)"
            } ?? "excerpt"
            let title = result.document.title.map { " - \($0)" } ?? ""
            lines.append("\n[\(result.document.path):\(lineLabel)]\(title)")
            lines.append(result.excerpt)
        }
        return lines.joined(separator: "\n")
    }

    private static func scan(siteID: String, projectRoot: URL) -> [Document] {
        walk(projectRoot).compactMap { abs in
            let relativePath = relativePosix(abs, from: projectRoot)
            return document(siteID: siteID, projectRoot: projectRoot, relativePath: relativePath)
        }
    }

    private static func document(siteID: String, projectRoot: URL, relativePath: String) -> Document? {
        guard shouldIndex(relativePath) else { return nil }
        let url = projectRoot.appendingPathComponent(relativePath)
        guard let size = fileSize(url), size <= 512_000 else { return nil }
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let frontmatter = Frontmatter.parse(source)
        let bodySource = bodyText(from: source)
        let title = title(in: bodySource, frontmatter: frontmatter)
        let headings = headings(in: bodySource)
        let links = internalLinks(in: bodySource)
        return Document(
            id: documentID(siteID: siteID, relativePath: relativePath),
            siteID: siteID,
            path: relativePath,
            kind: kind(for: relativePath),
            title: title,
            frontmatter: frontmatter,
            headings: headings,
            internalLinks: links,
            excerptText: truncatedExcerpt(bodySource),
            lastModified: mtime(url)
        )
    }

    private static func walk(_ dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]
        ) else { return [] }
        var files: [URL] = []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            if skippedDirectoryNames.contains(entry.lastPathComponent) { continue }
            let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values?.isSymbolicLink == true { continue }
            if values?.isDirectory == true {
                files.append(contentsOf: walk(entry))
            } else {
                files.append(entry)
            }
        }
        return files
    }

    private static let skippedDirectoryNames = SiteIndexPaths.skippedDirectoryNames

    private static let indexedExtensions: Set<String> = [
        "astro", "md", "mdx", "mdoc", "markdown", "html", "css",
        "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "yaml", "yml", "toml"
    ]

    private static func shouldIndex(_ relativePath: String) -> Bool {
        if relativePath.split(separator: "/").contains(where: { skippedDirectoryNames.contains(String($0)) }) {
            return false
        }
        let ext = URL(fileURLWithPath: relativePath).pathExtension.lowercased()
        return indexedExtensions.contains(ext)
    }

    private static func kind(for path: String) -> Document.Kind {
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        if path.hasPrefix("src/pages/") { return .page }
        if path.hasPrefix("src/content/posts/") || path.hasPrefix("src/content/notes/") { return .post }
        if path.hasPrefix("src/content/") { return .content }
        if path.hasPrefix("src/components/") { return .component }
        if path.hasPrefix("src/layouts/") { return .layout }
        if ext == "css" { return .style }
        if ["js", "mjs", "cjs", "ts", "tsx", "jsx"].contains(ext) { return .script }
        if path == "package.json" || path == "astro.config.mjs" || ["json", "yaml", "yml", "toml"].contains(ext) {
            return .config
        }
        return .other
    }

    private static func title(in source: String, frontmatter: [String: FrontmatterValue]) -> String? {
        if case let .string(value)? = frontmatter["title"], !value.isEmpty { return value }
        return headings(in: source).first
    }

    private static let markdownHeadingRegex = try! NSRegularExpression(pattern: #"(?m)^\s{0,3}#{1,6}\s+(.+?)\s*$"#)
    private static let htmlHeadingRegex = try! NSRegularExpression(pattern: #"<h[1-6][^>]*>(.*?)</h[1-6]>"#, options: [.caseInsensitive, .dotMatchesLineSeparators])

    private static func headings(in source: String) -> [String] {
        var out: [String] = []
        for match in matches(markdownHeadingRegex, in: source, group: 1) {
            out.append(cleanInlineMarkup(match))
        }
        for match in matches(htmlHeadingRegex, in: source, group: 1) {
            out.append(cleanInlineMarkup(match))
        }
        return Array(out.prefix(12))
    }

    private static let linkRegex = try! NSRegularExpression(pattern: #"(?:href|src)=["']([^"']+)["']|\]\(([^)]+)\)"#, options: [.caseInsensitive])

    private static func internalLinks(in source: String) -> [String] {
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        var links: [String] = []
        for match in linkRegex.matches(in: source, range: range) {
            for group in [1, 2] {
                guard let r = Range(match.range(at: group), in: source) else { continue }
                let value = String(source[r]).trimmingCharacters(in: .whitespacesAndNewlines)
                if value.hasPrefix("/") || value.hasPrefix("./") || value.hasPrefix("../") {
                    links.append(value)
                }
            }
        }
        return Array(Set(links)).sorted()
    }

    private static func matches(_ regex: NSRegularExpression, in source: String, group: Int) -> [String] {
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        return regex.matches(in: source, range: range).compactMap { match in
            guard let r = Range(match.range(at: group), in: source) else { return nil }
            return String(source[r])
        }
    }

    private static func cleanInlineMarkup(_ raw: String) -> String {
        raw.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func score(document: Document, terms: [String], phrase: String) -> Double {
        let title = (document.title ?? "").lowercased()
        let path = document.path.lowercased()
        let headings = document.headings.joined(separator: " ").lowercased()
        let frontmatter = document.frontmatter.values.map(Self.frontmatterText).joined(separator: " ").lowercased()
        let links = document.internalLinks.joined(separator: " ").lowercased()
        let body = bodyText(from: document.excerptText).lowercased()
        var score = 0.0

        for term in terms {
            if path.contains(term) { score += 6 }
            if title.contains(term) { score += 7 }
            if headings.contains(term) { score += 4 }
            if frontmatter.contains(term) { score += 3 }
            if links.contains(term) { score += 3 }
            score += min(6, Double(body.components(separatedBy: term).count - 1))
        }
        if !phrase.isEmpty {
            if path.contains(phrase) { score += 6 }
            if title.contains(phrase) { score += 8 }
            if body.contains(phrase) { score += 5 }
        }
        if score > 0, document.kind == .page || document.kind == .post { score += 1 }
        return score
    }

    private static func frontmatterText(_ value: FrontmatterValue) -> String {
        switch value {
        case .string(let s): return s
        case .bool(let b): return b ? "true" : "false"
        case .array(let values): return values.joined(separator: " ")
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
        case .date(let s): return s
        case .objectArray(let records):
            // Object array: flatten all field values for indexing
            return records.flatMap { record in
                record.map { field in frontmatterText(field.value) }
            }.joined(separator: " ")
        }
    }

    private static func truncatedExcerpt(_ source: String) -> String {
        guard source.count > maxExcerptCharacters else { return source }
        return String(source.prefix(maxExcerptCharacters))
    }

    private static func bodyText(from source: String) -> String {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n")
        var lines = normalized.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) == "---" else {
            return normalized
        }
        guard let closing = lines.dropFirst().firstIndex(where: {
            $0.trimmingCharacters(in: .whitespacesAndNewlines) == "---"
        }) else {
            return normalized
        }
        for index in 0...closing {
            lines[index] = ""
        }
        return lines.joined(separator: "\n")
    }

    private static func queryTerms(_ query: String) -> [String] {
        let pieces = query.lowercased().split { !$0.isLetter && !$0.isNumber }
        var seen: Set<String> = []
        return pieces.compactMap { piece in
            let term = String(piece)
            guard term.count >= 2, !seen.contains(term) else { return nil }
            seen.insert(term)
            return term
        }
    }

    private static func excerpt(from source: String, terms: [String]) -> (text: String, lineRange: ClosedRange<Int>?) {
        let lines = bodyText(from: source).replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        let matchIndex = lines.firstIndex { line in
            let lowered = line.lowercased()
            return terms.contains { lowered.contains($0) }
        } ?? 0
        let lower = max(0, matchIndex - 1)
        let upper = min(lines.count - 1, matchIndex + 2)
        let excerpt = lines[lower...upper]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        let trimmed = excerpt.count > 700 ? String(excerpt.prefix(700)) + "..." : excerpt
        return (trimmed, (lower + 1)...(upper + 1))
    }

    private static func relativePosix(_ url: URL, from base: URL) -> String {
        let urlComponents = url.standardizedFileURL.pathComponents
        let baseComponents = base.standardizedFileURL.pathComponents
        guard urlComponents.starts(with: baseComponents) else { return url.path }
        return urlComponents.dropFirst(baseComponents.count).joined(separator: "/")
    }

    private static func mtime(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
            ?? Date(timeIntervalSince1970: 0)
    }

    private static func fileSize(_ url: URL) -> Int64? {
        guard let value = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return nil }
        return Int64(value)
    }
}
