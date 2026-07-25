import Foundation

/// Enumerates a site's existing content-collection posts and maps each to the AS2 shape
/// `ActivityPubOutboxBackfill` (#926) needs to backfill into the ActivityPub outbox. Mirrors
/// `SocialPublishPlan`'s filesystem-walk pattern but does NOT apply its "has outbound social
/// work" filter (`SocialPublishPlan.build`'s `guard !targets.isEmpty || !posseTargets.isEmpty`)
/// — every publishable entry qualifies for backfill regardless of outbound links.
///
/// See design doc §4 (`docs/superpowers/specs/2026-07-24-activitypub-outbox-backfill-design.md`)
/// for the collection → AS2 kind mapping table this implements.
public enum OutboxBackfillPlan {
    public enum AS2Kind: String, Equatable, Sendable {
        case note = "Note"
        case article = "Article"
    }

    public struct Attachment: Equatable, Sendable {
        public let url: String
        public let mediaType: String?

        public init(url: String, mediaType: String? = nil) {
            self.url = url
            self.mediaType = mediaType
        }
    }

    public struct Entry: Equatable, Sendable {
        public let sourceFile: String
        public let canonicalURL: URL
        public let kind: AS2Kind
        public let name: String?
        public let content: String
        public let publishedAt: Date
        public let inReplyTo: String?
        public let attachments: [Attachment]

        public init(
            sourceFile: String,
            canonicalURL: URL,
            kind: AS2Kind,
            name: String?,
            content: String,
            publishedAt: Date,
            inReplyTo: String? = nil,
            attachments: [Attachment] = []
        ) {
            self.sourceFile = sourceFile
            self.canonicalURL = canonicalURL
            self.kind = kind
            self.name = name
            self.content = content
            self.publishedAt = publishedAt
            self.inReplyTo = inReplyTo
            self.attachments = attachments
        }
    }

    public struct Plan: Equatable, Sendable {
        public let entries: [Entry]
        public init(entries: [Entry]) { self.entries = entries }
    }

    /// How a collection's "target" frontmatter field (if any) becomes part of the AS2 object.
    private enum TargetTreatment {
        /// No target field on this collection.
        case none
        /// A real AS2 `inReplyTo` property, read from the named frontmatter key.
        case asReplyTo(key: String)
        /// Not a real AS2 property — the target URL is prefixed onto `content` as plain text
        /// (design doc D4: `likeOf`/`bookmarkOf` targets usually aren't resolvable AP objects).
        case asContentPrefix(key: String, label: String)
    }

    private struct CollectionSpec {
        let name: String
        let kind: AS2Kind
        /// Frontmatter key for the AS2 `name` (title); `nil` if this collection has no title field.
        let titleKey: String?
        /// Date frontmatter keys to try, in order — passed straight to `SocialPublishPlan.parseDate`.
        let dateKeys: [String]
        let target: TargetTreatment
        /// Frontmatter key for a single-image field (photos) or an image-array field (albums);
        /// `nil` for collections with no images.
        let imageKey: String?
        /// Whether `imageKey`'s value is a `.array` (albums) rather than a `.string` (photos).
        let imageIsArray: Bool

        init(
            _ name: String, kind: AS2Kind, titleKey: String? = nil, dateKeys: [String],
            target: TargetTreatment = .none, imageKey: String? = nil, imageIsArray: Bool = false
        ) {
            self.name = name
            self.kind = kind
            self.titleKey = titleKey
            self.dateKeys = dateKeys
            self.target = target
            self.imageKey = imageKey
            self.imageIsArray = imageIsArray
        }
    }

    private static let collections: [CollectionSpec] = [
        CollectionSpec("blog", kind: .article, titleKey: "title", dateKeys: ["pubDate"]),
        CollectionSpec("articles", kind: .article, titleKey: "title", dateKeys: ["publishDate"]),
        CollectionSpec("notes", kind: .note, dateKeys: ["publishDate"]),
        CollectionSpec("replies", kind: .note, dateKeys: ["publishDate"], target: .asReplyTo(key: "inReplyTo")),
        CollectionSpec("bookmarks", kind: .note, titleKey: "title", dateKeys: ["publishDate"],
                        target: .asContentPrefix(key: "bookmarkOf", label: "Bookmarked")),
        CollectionSpec("likes", kind: .note, dateKeys: ["publishDate"],
                        target: .asContentPrefix(key: "likeOf", label: "Liked")),
        CollectionSpec("photos", kind: .note, dateKeys: ["publishDate"], imageKey: "image"),
        CollectionSpec("albums", kind: .note, titleKey: "title", dateKeys: ["publishDate"],
                        imageKey: "images", imageIsArray: true),
        CollectionSpec("events", kind: .note, titleKey: "name", dateKeys: ["start"]),
        CollectionSpec("announcements", kind: .note, titleKey: "title", dateKeys: ["publishDate"]),
        CollectionSpec("reviews", kind: .note, dateKeys: ["publishDate"]),
    ]

    /// The 11 in-scope collection names (design doc D3) — exposed for a coverage test guarding
    /// against silently dropping one.
    public static var collectionNames: Set<String> { Set(collections.map(\.name)) }

    private static let excerptMaxLength = 500

    static func excerpt(_ body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > excerptMaxLength else { return trimmed }
        return String(trimmed.prefix(excerptMaxLength)) + "…"
    }

    /// Tries each of `keys` in order against `frontmatter`, returning the first one that parses
    /// as a date — `SocialPublishPlan.parseDate(_:)` only ever takes a single already-resolved
    /// string, so the multi-key fallback lives here rather than in that shared helper.
    private static func date(in frontmatter: [String: FrontmatterValue], keys: [String]) -> Date? {
        for key in keys {
            if let date = SocialPublishPlan.parseDate(SocialPublishPlan.string(frontmatter[key])) {
                return date
            }
        }
        return nil
    }

    /// Builds the backfill plan by walking each in-scope collection directory under
    /// `<projectRoot>/src/content/`, parsing frontmatter, filtering drafts/future-dated entries
    /// (same rule as `SocialPublishPlan`), and mapping each surviving file to an `Entry`.
    public static func build(
        projectRoot: URL,
        siteBase: URL,
        referenceDate: Date = Date()
    ) -> Plan {
        let contentRoot = projectRoot.appendingPathComponent("src/content", isDirectory: true)
        var entries: [Entry] = []

        for spec in collections {
            let collectionRoot = contentRoot.appendingPathComponent(spec.name, isDirectory: true)
            let files = SocialPublishPlan.walk(collectionRoot)
                .filter { SocialPublishPlan.entryExtensions.contains($0.pathExtension.lowercased()) }

            for file in files {
                guard let source = try? String(contentsOf: file, encoding: .utf8) else { continue }
                let frontmatter = Frontmatter.parse(source)

                if SocialPublishPlan.isDraft(frontmatter["draft"]) { continue }
                guard let publishedAt = date(in: frontmatter, keys: spec.dateKeys) else { continue }
                guard publishedAt <= referenceDate else { continue }

                let relPath = SocialPublishPlan.relativePosix(file, from: projectRoot)
                guard let canonical = canonicalURL(for: relPath, frontmatter: frontmatter, siteBase: siteBase) else {
                    continue
                }

                let body = Frontmatter.body(source)
                let name = spec.titleKey.flatMap { SocialPublishPlan.string(frontmatter[$0]) }

                var content = excerpt(body)
                var inReplyTo: String?
                switch spec.target {
                case .none:
                    break
                case .asReplyTo(let key):
                    inReplyTo = SocialPublishPlan.string(frontmatter[key])
                case .asContentPrefix(let key, let label):
                    if let target = SocialPublishPlan.string(frontmatter[key]) {
                        content = content.isEmpty ? "\(label): \(target)" : "\(label): \(target)\n\n\(content)"
                    }
                }

                var attachments: [Attachment] = []
                if let imageKey = spec.imageKey {
                    if spec.imageIsArray, case let .array(images)? = frontmatter[imageKey] {
                        attachments = images.compactMap { attachmentURL($0, siteBase: siteBase) }
                    } else if let image = SocialPublishPlan.string(frontmatter[imageKey]) {
                        attachments = [attachmentURL(image, siteBase: siteBase)].compactMap { $0 }
                    }
                }

                entries.append(Entry(
                    sourceFile: relPath, canonicalURL: canonical, kind: spec.kind, name: name,
                    content: content, publishedAt: publishedAt, inReplyTo: inReplyTo, attachments: attachments
                ))
            }
        }

        return Plan(entries: entries.sorted { $0.sourceFile < $1.sourceFile })
    }

    private static func attachmentURL(_ raw: String, siteBase: URL) -> Attachment? {
        guard let url = URL(string: raw, relativeTo: siteBase)?.absoluteURL else { return nil }
        return Attachment(url: url.absoluteString)
    }

    /// Same `/<collection>/<slug>/` scheme as `SocialPublishPlan.canonicalURL` (kept separate
    /// rather than reused since this version doesn't need `SocialPublishPlan`'s webmention-target
    /// scanning and operates on an already-known collection name from `CollectionSpec`, not a
    /// parsed path).
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
        let basename = (lastPart as NSString).deletingPathExtension
        let fallbackSlug = (collectionRelParts.dropLast() + [basename]).joined(separator: "/")
        let slug = SocialPublishPlan.string(frontmatter["slug"]) ?? fallbackSlug
        return URL(string: "/\(collection)/\(slug)/", relativeTo: siteBase)?.absoluteURL
    }
}
