import Foundation

/// Project-local retrieval index for an Astro site.
///
/// The index is intentionally lexical for v1: it reads the project's text files, extracts useful
/// metadata (frontmatter, headings, internal links), and ranks file excerpts against a user query.
/// That gives assistant features citation-ready project context without a network embedding service.
public actor SiteKnowledgeIndex {
    /// One indexed project file: the extracted metadata plus a capped excerpt of its text. This
    /// is everything scoring needs, so search never re-reads the file from disk.
    public struct Document: Sendable, Equatable, Identifiable {
        /// Stable identity in ``SiteKnowledgeIndex/documentID(siteID:relativePath:)``'s format —
        /// derive it there, never reconstruct the string by hand.
        public let id: String
        /// The owning site, since one shared index instance holds documents for every open site.
        public let siteID: String
        /// Project-relative POSIX path — doubles as the citation path shown to the user.
        public let path: String
        /// Coarse role classification (see ``Kind``), used both for search-result weighting and
        /// for callers' kind filters.
        public let kind: Kind
        /// The frontmatter `title:` when present, else the first heading; `nil` for files with
        /// neither (config, styles, scripts).
        public let title: String?
        /// The parsed frontmatter block. Kept structured (not flattened to text) so consumers
        /// beyond search — e.g. content tooling — can read individual fields.
        public let frontmatter: [String: FrontmatterValue]
        /// Up to the first 12 markdown/HTML headings — enough for relevance signal without
        /// storing a full outline.
        public let headings: [String]
        /// Site-internal link targets (`/…`, `./…`, `../…`) found in the body, deduplicated and
        /// sorted; external URLs are deliberately excluded.
        public let internalLinks: [String]
        /// The frontmatter-stripped body, truncated to the index's excerpt cap — the text
        /// snippets are extracted from at search time.
        public let excerptText: String
        /// File modification time when scanned (epoch on failure) — lets consumers detect
        /// staleness against the file on disk.
        public let lastModified: Date

        /// A document's coarse role, derived from its path prefix and extension. Distinguished
        /// because search boosts owner-facing content (pages/posts) over plumbing, and callers
        /// scope queries by kind via ``SiteKnowledgeIndex/SearchOptions``.
        public enum Kind: String, Sendable, Equatable, CaseIterable {
            /// A routable page under `src/pages/`.
            case page
            /// A post-like entry (`src/content/posts/`, `src/content/notes/`) — split from
            /// ``content`` so blog-focused queries can target just these.
            case post
            /// A component under `src/components/`.
            case component
            /// A layout under `src/layouts/`.
            case layout
            /// Any other content-collection entry under `src/content/`.
            case content
            /// Project configuration (`package.json`, `astro.config.mjs`, JSON/YAML/TOML files).
            case config
            /// A CSS stylesheet.
            case style
            /// A JS/TS source file outside the categories above.
            case script
            /// Indexed text that fits no other category.
            case other
        }
    }

    /// One search hit: the matched document plus the specific excerpt that matched.
    public struct SearchResult: Sendable, Equatable, Identifiable {
        /// The document id suffixed with the excerpt's starting line — unique even if a future
        /// change surfaces multiple excerpts per document in one result list.
        public let id: String
        /// The matched document, carried whole so result UIs can show title/path/kind without a
        /// second index lookup.
        public let document: Document
        /// Lexical relevance score; meaningful only for ordering within one query, not across
        /// queries.
        public let score: Double
        /// A few trimmed lines around the first matching line, capped so a prompt assembled from
        /// several results stays small.
        public let excerpt: String
        /// 1-based line range of the excerpt in the source file — what citation UIs display and
        /// jump to. `nil` only when no range could be determined.
        public let lineRange: ClosedRange<Int>?
    }

    /// Query knobs for ``SiteKnowledgeIndex/search(siteID:query:options:)``.
    public struct SearchOptions: Sendable, Equatable {
        /// Maximum results returned; clamped to at least 1 at init so a caller can't accidentally
        /// ask for zero and read "no matches" from a valid query.
        public let limit: Int
        /// Restrict matches to these document kinds; `nil` searches everything.
        public let kinds: Set<Document.Kind>?

        /// The default (8 results, all kinds) suits prompt-context retrieval; tighten `kinds` for
        /// purpose-built lookups.
        public init(limit: Int = 8, kinds: Set<Document.Kind>? = nil) {
            self.limit = max(1, limit)
            self.kinds = kinds
        }
    }

    private var documentsBySite: [String: [String: Document]] = [:]
    private static let maxExcerptCharacters = 8_192

    /// Starts empty; the index is in-memory only, so each launch (and each site open) must
    /// `rebuild` before searching.
    public init() {}

    /// Rebuilds the site's index from disk. Missing directories and unreadable files are skipped.
    public func rebuild(siteID: String, projectRoot: URL) async {
        let documents = await Task.detached(priority: .utility) {
            Self.scan(siteID: siteID, projectRoot: projectRoot)
        }.value
        documentsBySite[siteID] = Dictionary(uniqueKeysWithValues: documents.map { ($0.path, $0) })
    }

    /// Drops every document for a closed site, so a long-lived shared index doesn't hold excerpt
    /// text for sites no longer open.
    public func unload(siteID: String) {
        documentsBySite[siteID] = nil
    }

    /// All indexed documents for a site, sorted by path for deterministic iteration; empty when
    /// the site was never rebuilt (or was unloaded).
    public func documents(siteID: String) -> [Document] {
        (documentsBySite[siteID] ?? [:]).values.sorted { $0.path < $1.path }
    }

    /// Incrementally re-indexes one changed file — the file-watcher path, so a single edit
    /// doesn't trigger a full `rebuild`. A file that no longer exists (or is no longer indexable)
    /// is removed instead, so callers can route both "changed" and "unsure" events here.
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

    /// Drops one file's document on deletion. No-op if the path was never indexed.
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

    /// Ranks indexed documents against a free-text query — lexical term/phrase matching over
    /// path, title, headings, frontmatter, links, and body (see the actor doc for why not
    /// embeddings). Ties break by path so identical scores order deterministically. Empty when
    /// the query has no usable terms or the site isn't indexed.
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

    /// Search results rendered as a ready-to-inject prompt block — `[path:lines]`-labelled
    /// excerpts under a short instruction to cite file paths, matching the citation contract the
    /// assistant decorators rely on. `nil` (rather than an empty block) when nothing matched, so
    /// callers skip enrichment entirely for unrelated prompts.
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
