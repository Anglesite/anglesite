import Foundation

/// Network-free planning for V-2 outbound social publishing.
///
/// The actual Webmention/POSSE sends are gated on `@dwk/workers` readiness. This planner gives
/// the deploy pipeline a deterministic contract: for each publishable content entry, compute the
/// canonical source URL, outbound Webmention targets, and requested POSSE destinations.
public enum SocialPublishPlan {
    /// One publishable content entry's outbound-social work. Only entries with at least one
    /// Webmention or POSSE target become entries at all — content with nothing to send is left
    /// out of the plan entirely.
    public struct Entry: Equatable, Sendable {
        /// Project-relative POSIX path of the source markdown file, for display and tracing.
        public let sourceFile: String
        /// The entry's public URL on the deployed site — the Webmention `source` every outbound
        /// send will claim. Derived from the collection path and slug, since planning runs
        /// without a built site to consult.
        public let canonicalURL: URL
        /// External `http(s)` URLs this entry links to (reply/bookmark/like/repost frontmatter
        /// plus body links), deduplicated, sorted, and with same-host links excluded — a site
        /// never webmentions itself.
        public let webmentionTargets: [URL]
        /// Syndication destinations requested in frontmatter (`posse`/`syndicateTo`), kept as
        /// raw strings because destination identifiers belong to the (not-yet-shipped) sender.
        public let posseTargets: [String]

        /// Memberwise initializer, public for tests and future senders to construct fixtures.
        public init(
            sourceFile: String,
            canonicalURL: URL,
            webmentionTargets: [URL],
            posseTargets: [String]
        ) {
            self.sourceFile = sourceFile
            self.canonicalURL = canonicalURL
            self.webmentionTargets = webmentionTargets
            self.posseTargets = posseTargets
        }
    }

    /// The whole site's outbound-social plan for one deploy — deterministic for a given content
    /// tree, so the deploy pipeline can diff/summarize it before anything is actually sent.
    public struct Plan: Equatable, Sendable {
        /// The plan's entries, sorted by source file for stable output.
        public let entries: [Entry]

        /// Memberwise initializer, public for tests and future senders to construct fixtures.
        public init(entries: [Entry]) {
            self.entries = entries
        }

        /// `true` when this deploy has no outbound social work at all — the common case, letting
        /// the pipeline skip the whole feature silently.
        public var isEmpty: Bool { entries.isEmpty }
        /// Total outbound Webmention sends across all entries, for summary UI.
        public var webmentionCount: Int { entries.reduce(0) { $0 + $1.webmentionTargets.count } }
        /// Total requested POSSE syndications across all entries, for summary UI.
        public var posseCount: Int { entries.reduce(0) { $0 + $1.posseTargets.count } }
    }

    /// Input errors that make planning impossible (as opposed to per-file problems, which just
    /// skip the file).
    public enum PlanningError: Error, Equatable, Sendable {
        /// The site base URL has no host or a non-`http(s)` scheme, so canonical URLs and the
        /// self-link exclusion can't be computed; carries the offending URL string.
        case invalidSiteBase(String)
    }

    static let entryExtensions: Set<String> = ["md", "mdx", "mdoc", "markdown"]
    private static let outboundURLPattern: NSRegularExpression = {
        do {
            return try NSRegularExpression(
                pattern: #"https?://[^\s<>"'\)\]\}]+"#,
                options: [.caseInsensitive]
            )
        } catch {
            fatalError("Invalid outbound social URL regex: \(error)")
        }
    }()
    private static let trailingPunctuation = CharacterSet(charactersIn: ".,;:!?")

    /// Builds the outbound-social plan for a site's Astro project root (`Source/`).
    public static func build(
        projectRoot: URL,
        siteBase: URL,
        referenceDate: Date = Date()
    ) throws -> Plan {
        guard let baseHost = siteBase.host, siteBase.scheme == "http" || siteBase.scheme == "https" else {
            throw PlanningError.invalidSiteBase(siteBase.absoluteString)
        }

        let contentRoot = projectRoot.appendingPathComponent("src/content", isDirectory: true)
        let files = walk(contentRoot).filter { entryExtensions.contains($0.pathExtension.lowercased()) }
        let entries = files.compactMap { file -> Entry? in
            guard let source = try? String(contentsOf: file, encoding: .utf8) else { return nil }
            let frontmatter = Frontmatter.parse(source)
            if isDraft(frontmatter["draft"]) || isFutureDated(frontmatter, after: referenceDate) { return nil }

            let relPath = relativePosix(file, from: projectRoot)
            guard let canonical = canonicalURL(for: relPath, frontmatter: frontmatter, siteBase: siteBase) else {
                return nil
            }

            let targets = webmentionTargets(in: source, frontmatter: frontmatter, excludingHost: baseHost)
            let posseTargets = posseTargets(in: frontmatter)
            guard !targets.isEmpty || !posseTargets.isEmpty else { return nil }

            return Entry(
                sourceFile: relPath,
                canonicalURL: canonical,
                webmentionTargets: targets,
                posseTargets: posseTargets
            )
        }
        return Plan(entries: entries.sorted { $0.sourceFile < $1.sourceFile })
    }

    private static func canonicalURL(
        for relPath: String,
        frontmatter: [String: FrontmatterValue],
        siteBase: URL
    ) -> URL? {
        let parts = relPath.split(separator: "/").map(String.init)
        guard parts.count >= 4, parts[0] == "src", parts[1] == "content" else { return nil }
        let collection = parts[2]
        let collectionRelParts = Array(parts.dropFirst(3))
        guard let lastPart = collectionRelParts.last else { return nil }
        let fallbackSlug = (collectionRelParts.dropLast() + [basenameWithoutExtension(lastPart)])
            .joined(separator: "/")
        let slug = string(frontmatter["slug"]) ?? fallbackSlug
        return URL(string: "/\(collection)/\(slug)/", relativeTo: siteBase)?.absoluteURL
    }

    private static func webmentionTargets(
        in source: String,
        frontmatter: [String: FrontmatterValue],
        excludingHost siteHost: String
    ) -> [URL] {
        var candidates: [URL] = []

        for key in ["inReplyTo", "bookmarkOf", "likeOf", "repostOf"] {
            if let value = string(frontmatter[key]), let url = URL(string: value) {
                candidates.append(url)
            }
        }

        let body = FrontmatterDocument.parse(source).body
        let range = NSRange(body.startIndex..<body.endIndex, in: body)
        for match in outboundURLPattern.matches(in: body, range: range) {
            guard let r = Range(match.range, in: body) else { continue }
            let raw = String(body[r]).trimmingCharacters(in: trailingPunctuation)
            if let url = URL(string: raw) {
                candidates.append(url)
            }
        }

        return unique(candidates.compactMap { url -> URL? in
            guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
            guard let host = url.host, host.caseInsensitiveCompare(siteHost) != .orderedSame else { return nil }
            return url
        })
    }

    private static func posseTargets(in frontmatter: [String: FrontmatterValue]) -> [String] {
        let keys = ["posse", "syndicateTo", "syndicate-to"]
        let values = keys.flatMap { key -> [String] in
            switch frontmatter[key] {
            case .array(let items): return items
            case .string(let item) where !item.isEmpty: return [item]
            default: return []
            }
        }
        return uniqueStrings(values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
    }

    private static func unique(_ urls: [URL]) -> [URL] {
        var seen: Set<String> = []
        var out: [URL] = []
        for url in urls {
            let key = url.absoluteString
            if seen.insert(key).inserted {
                out.append(url)
            }
        }
        return out.sorted { $0.absoluteString < $1.absoluteString }
    }

    private static func uniqueStrings(_ values: [String]) -> [String] {
        var seen: Set<String> = []
        var out: [String] = []
        for value in values {
            if seen.insert(value).inserted {
                out.append(value)
            }
        }
        return out
    }

    static func isDraft(_ value: FrontmatterValue?) -> Bool {
        switch value {
        case .bool(true):
            return true
        case .string(let raw):
            return ["true", "yes", "1"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        default:
            return false
        }
    }

    private static func isFutureDated(_ frontmatter: [String: FrontmatterValue], after referenceDate: Date) -> Bool {
        guard let publishDate = parseDate(
            string(frontmatter["publishDate"]) ?? string(frontmatter["pubDate"])
                ?? string(frontmatter["date"]) ?? string(frontmatter["start"])
        ) else {
            return false
        }
        return publishDate > referenceDate
    }

    static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let date = ISO8601DateFormatter().date(from: raw) {
            return date
        }
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2])
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }

    static func string(_ value: FrontmatterValue?) -> String? {
        if case let .string(s)? = value, !s.isEmpty { return s }
        return nil
    }

    private static func basenameWithoutExtension(_ fileName: String) -> String {
        guard let dot = fileName.lastIndex(of: ".") else { return fileName }
        return String(fileName[..<dot])
    }

    static func walk(_ dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: []
        ) else { return [] }
        var files: [URL] = []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                files.append(contentsOf: walk(entry))
            } else {
                files.append(entry)
            }
        }
        return files
    }

    static func relativePosix(_ url: URL, from base: URL) -> String {
        let urlComponents = url.standardizedFileURL.pathComponents
        let baseComponents = base.standardizedFileURL.pathComponents
        guard urlComponents.starts(with: baseComponents) else { return url.path }
        return urlComponents.dropFirst(baseComponents.count).joined(separator: "/")
    }
}
