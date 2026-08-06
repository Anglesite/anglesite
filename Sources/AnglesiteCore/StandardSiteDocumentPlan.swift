import Foundation

/// Network-free planning for `site.standard.document` records: enumerates every publishable
/// content-collection entry under `src/content` — the same "posts" domain `SocialPublishPlan`
/// walks — independent of any `posse:`/`syndicateTo` opt-in, since a Standard.site document is
/// Atmosphere presence, not a cross-post. Reuses `SocialPublishPlan`'s file-walk, draft, and
/// date-parsing helpers so the two planners can't drift on what counts as "published."
public enum StandardSiteDocumentPlan {
    /// One document-eligible content entry.
    public struct Entry: Equatable, Sendable {
        /// Project-relative POSIX path of the source markdown file.
        public let sourceFile: String
        /// URL path (leading and trailing slash, no host) joined with the publication's `url`
        /// to form the document's canonical URL, e.g. `/blog/hello-world/`.
        public let path: String
        public let title: String
        public let description: String?
        public let tags: [String]
        /// Frontmatter publish date, falling back to the source file's modification date when
        /// the frontmatter has none — the record's `publishedAt` is required by the lexicon, so
        /// there must always be a value.
        public let publishedAt: Date
        /// The source file's modification date, when it's after `publishedAt` — signals the post
        /// was edited since it was first published. `nil` otherwise (nothing to report).
        public let updatedAt: Date?
        /// Plain-text render of the body.
        public let textContent: String

        /// Memberwise initializer, public for tests.
        public init(
            sourceFile: String, path: String, title: String, description: String?, tags: [String],
            publishedAt: Date, updatedAt: Date?, textContent: String
        ) {
            self.sourceFile = sourceFile
            self.path = path
            self.title = title
            self.description = description
            self.tags = tags
            self.publishedAt = publishedAt
            self.updatedAt = updatedAt
            self.textContent = textContent
        }
    }

    /// The whole site's document plan for one deploy.
    public struct Plan: Equatable, Sendable {
        /// The plan's entries, sorted by source file for stable output.
        public let entries: [Entry]

        /// Memberwise initializer, public for tests.
        public init(entries: [Entry]) { self.entries = entries }
    }

    /// Builds the document plan for a site's Astro project root (`Source/`): every non-draft,
    /// non-future-dated entry under `src/content`.
    public static func build(projectRoot: URL, referenceDate: Date = Date()) -> Plan {
        let contentRoot = projectRoot.appendingPathComponent("src/content", isDirectory: true)
        let files = SocialPublishPlan.walk(contentRoot)
            .filter { SocialPublishPlan.entryExtensions.contains($0.pathExtension.lowercased()) }
        let entries = files.compactMap { file -> Entry? in
            guard let source = try? String(contentsOf: file, encoding: .utf8) else { return nil }
            let frontmatter = Frontmatter.parse(source)
            guard !SocialPublishPlan.isDraft(frontmatter["draft"]) else { return nil }

            let relPath = SocialPublishPlan.relativePosix(file, from: projectRoot)
            guard let path = documentPath(for: relPath, frontmatter: frontmatter) else { return nil }

            let mtime = mtime(file)
            let publishedAt = SocialPublishPlan.parseDate(
                SocialPublishPlan.string(frontmatter["publishDate"])
                    ?? SocialPublishPlan.string(frontmatter["pubDate"])
                    ?? SocialPublishPlan.string(frontmatter["date"])
            ) ?? mtime
            guard publishedAt <= referenceDate else { return nil }
            let updatedAt = mtime > publishedAt ? mtime : nil

            let title = SocialPublishPlan.string(frontmatter["title"]) ?? fallbackTitle(path)
            let description = SocialPublishPlan.string(frontmatter["description"])
            let tags: [String]
            if case let .array(values)? = frontmatter["tags"] { tags = values } else { tags = [] }
            let textContent = SiteContentChunker.plainText(markdown: Frontmatter.body(source))

            return Entry(
                sourceFile: relPath, path: path, title: title, description: description, tags: tags,
                publishedAt: publishedAt, updatedAt: updatedAt, textContent: textContent
            )
        }
        return Plan(entries: entries.sorted { $0.sourceFile < $1.sourceFile })
    }

    /// `/<collection>/<slug>/` for a `src/content/<collection>/...` relative path — the same
    /// collection/slug derivation `SocialPublishPlan.canonicalURL` uses, minus the host join.
    private static func documentPath(for relPath: String, frontmatter: [String: FrontmatterValue]) -> String? {
        let parts = relPath.split(separator: "/").map(String.init)
        guard parts.count >= 4, parts[0] == "src", parts[1] == "content" else { return nil }
        let collection = parts[2]
        let collectionRelParts = Array(parts.dropFirst(3))
        guard let lastPart = collectionRelParts.last else { return nil }
        let fallbackSlug = (collectionRelParts.dropLast() + [basenameWithoutExtension(lastPart)])
            .joined(separator: "/")
        let slug = SocialPublishPlan.string(frontmatter["slug"]) ?? fallbackSlug
        return "/\(collection)/\(slug)/"
    }

    private static func basenameWithoutExtension(_ fileName: String) -> String {
        guard let dot = fileName.lastIndex(of: ".") else { return fileName }
        return String(fileName[..<dot])
    }

    private static func fallbackTitle(_ path: String) -> String {
        let slug = path.split(separator: "/").last.map(String.init) ?? "New post"
        return slug.replacing("-", with: " ")
    }

    private static func mtime(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
            ?? Date(timeIntervalSince1970: 0)
    }
}
