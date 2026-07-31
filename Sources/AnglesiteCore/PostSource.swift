import Foundation

/// One blog post loaded for repurposing (#465): frontmatter + plain-text body + where it lives.
public struct PostSource: Sendable, Equatable {
    /// The content-collection directory name the post was found in (e.g. `blog`).
    public let collection: String
    /// The post's file-name slug (no extension); combined with ``collection`` it forms the
    /// published URL path.
    public let slug: String
    /// Frontmatter `title`, falling back to the slug when the frontmatter has none — a post
    /// always has *something* to display and to feed the prompt.
    public let title: String
    /// Frontmatter `description`, when present.
    public let description: String?
    /// Frontmatter `tags`; empty when absent.
    public let tags: [String]
    /// The post body as plain text — markdown syntax already stripped, so prompt character
    /// counts reflect what a reader (and a platform limit) would see.
    public let body: String
    /// Site-relative path of the source file (e.g. `src/content/blog/hello.md`).
    public let filePath: String

    /// Memberwise initializer, public so tests can build fixtures without touching disk.
    public init(collection: String, slug: String, title: String, description: String?,
                tags: [String], body: String, filePath: String) {
        self.collection = collection
        self.slug = slug
        self.title = title
        self.description = description
        self.tags = tags
        self.body = body
        self.filePath = filePath
    }

    /// Finds `src/content/<collection>/<slug>.{md,mdoc}` across all collections.
    /// If the same slug exists in more than one collection, the first collection
    /// alphabetically (by directory name) wins — lookup order is deterministic.
    public static func load(slug: String, sourceDirectory: URL,
                            fileManager: FileManager = .default) -> PostSource? {
        let contentRoot = sourceDirectory.appendingPathComponent("src/content")
        guard let collections = try? fileManager.contentsOfDirectory(
            at: contentRoot, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { return nil }
        let sortedCollections = collections.sorted { $0.lastPathComponent < $1.lastPathComponent }
        for collectionURL in sortedCollections where (try? collectionURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            for ext in ["mdoc", "md"] {
                let url = collectionURL.appendingPathComponent("\(slug).\(ext)")
                guard let contents = try? String(contentsOf: url, encoding: .utf8) else { continue }
                let fields = Frontmatter.parse(contents)
                let collection = collectionURL.lastPathComponent

                var title: String = slug
                if case let .string(value)? = fields["title"] { title = value }

                var description: String?
                if case let .string(value)? = fields["description"] { description = value }

                var tags: [String] = []
                if case let .array(values)? = fields["tags"] { tags = values }

                return PostSource(
                    collection: collection,
                    slug: slug,
                    title: title,
                    description: description,
                    tags: tags,
                    body: SiteContentChunker.plainText(markdown: Frontmatter.body(contents)),
                    filePath: "src/content/\(collection)/\(slug).\(ext)")
            }
        }
        return nil
    }

    /// Canonical published URL for a post: `https://<domain>/<collection>/<slug>/`.
    public static func postURL(domain: String, collection: String, slug: String) -> String {
        var host = domain
        // Case-insensitive match (the domain comes from a free-text wizard field stored
        // verbatim) — drop the same character count from the original string so the rest of
        // the host keeps its original casing.
        for prefix in ["https://", "http://"] where host.lowercased().hasPrefix(prefix) {
            host = String(host.dropFirst(prefix.count))
        }
        host = host.hasSuffix("/") ? String(host.dropLast()) : host
        return "https://\(host)/\(collection)/\(slug)/"
    }
}
