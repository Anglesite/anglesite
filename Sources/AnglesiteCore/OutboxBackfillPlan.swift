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
    /// The ActivityStreams object type an entry maps to. Only two of AS2's many types are used:
    /// titled long-form collections become `Article`, everything else (notes, likes, photos,
    /// events, …) degrades to `Note` — the design doc's mapping keeps fediverse rendering
    /// predictable rather than chasing exotic types clients ignore anyway.
    public enum AS2Kind: String, Equatable, Sendable {
        /// Short/untitled content — the safe default every microblogging client renders.
        case note = "Note"
        /// Titled long-form content (`blog`, `articles` collections).
        case article = "Article"
    }

    /// A media attachment for the AS2 object, already resolved to an absolute URL against the
    /// site base (relative frontmatter paths would be meaningless to remote AP servers).
    public struct Attachment: Equatable, Sendable {
        /// Absolute URL of the media file.
        public let url: String
        /// MIME type when known; `nil` lets the consumer omit `mediaType` rather than guess.
        public let mediaType: String?

        /// Creates an attachment; `mediaType` defaults to `nil` because frontmatter image
        /// fields carry no type information.
        public init(url: String, mediaType: String? = nil) {
            self.url = url
            self.mediaType = mediaType
        }
    }

    /// One publishable content file, pre-shaped for the AS2 outbox: target/review frontmatter is
    /// already folded into `content`, dates parsed, and the canonical URL resolved — so the
    /// consumer (`ActivityPubOutboxBackfill`, #926) does no frontmatter interpretation of its own.
    public struct Entry: Equatable, Sendable {
        /// Project-relative POSIX path of the source file — the stable identity used to dedupe
        /// against already-backfilled objects.
        public let sourceFile: String
        /// The post's public permalink (`/<collection>/<slug>/` on the site base); becomes the
        /// AS2 object's `url`/`id` basis.
        public let canonicalURL: URL
        /// The AS2 object type this entry maps to (see ``OutboxBackfillPlan/AS2Kind``).
        public let kind: AS2Kind
        /// AS2 `name` (title); `nil` for collections without a title field (notes, likes, …).
        public let name: String?
        /// Body excerpt (capped at 500 characters), possibly prefixed with the target/review
        /// summary for collections whose target URL isn't a resolvable AP object (design doc D4).
        public let content: String
        /// Publication date from frontmatter; entries dated in the future are filtered out of
        /// the plan entirely, so this is always ≤ the build's reference date.
        public let publishedAt: Date
        /// AS2 `inReplyTo` — populated only for the `replies` collection, whose target genuinely
        /// is another AP-addressable object.
        public let inReplyTo: String?
        /// Image attachments (photos: one; albums: many); empty for all other collections.
        public let attachments: [Attachment]

        /// Memberwise initializer; `inReplyTo` and `attachments` default to absent since most
        /// collections have neither.
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

    /// The complete backfill work list produced by ``OutboxBackfillPlan/build(projectRoot:siteBase:referenceDate:)``.
    public struct Plan: Equatable, Sendable {
        /// All qualifying entries, sorted by ``Entry/sourceFile`` for deterministic output
        /// (filesystem enumeration order isn't stable across runs or platforms).
        public let entries: [Entry]
        /// Wraps an already-built entry list — used directly only by tests; production code
        /// goes through `build`.
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
        /// Reviews (design doc §4: "review text/rating as text") — combines two differently-typed
        /// frontmatter fields (`itemReviewed`: string, `rating`: number) into one content prefix,
        /// degrading gracefully if either is absent rather than requiring both.
        case asReviewSummary(itemKey: String, ratingKey: String)
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
        CollectionSpec("events", kind: .note, titleKey: "name", dateKeys: ["start"],
                        target: .asContentPrefix(key: "location", label: "Location")),
        CollectionSpec("announcements", kind: .note, titleKey: "title", dateKeys: ["publishDate"]),
        CollectionSpec("reviews", kind: .note, dateKeys: ["publishDate"],
                        target: .asReviewSummary(itemKey: "itemReviewed", ratingKey: "rating")),
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

    /// `TypedContentEditor.format()` writes every non-`.date`-kind field (i.e. every in-scope
    /// collection's date field except `blog`'s `pubDate`) as fractional-second ISO8601
    /// (`2026-06-26T12:00:00.000Z`), which `SocialPublishPlan.parseDate(_:)` cannot parse (it
    /// only handles plain ISO8601 or a bare `yyyy-MM-dd`). Mirrors the fractional-then-plain
    /// fallback `ContentScanner.swift` already uses.
    private nonisolated(unsafe) static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Tries each of `keys` in order against `frontmatter`, returning the first one that parses
    /// as a date: fractional-seconds ISO8601 first, then `SocialPublishPlan.parseDate(_:)`
    /// (plain ISO8601 or bare `yyyy-MM-dd`, which covers `blog`'s `pubDate`).
    private static func date(in frontmatter: [String: FrontmatterValue], keys: [String]) -> Date? {
        for key in keys {
            guard let raw = SocialPublishPlan.string(frontmatter[key]) else { continue }
            if let date = isoFractional.date(from: raw) { return date }
            if let date = SocialPublishPlan.parseDate(raw) { return date }
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
                case .asReviewSummary(let itemKey, let ratingKey):
                    let item = SocialPublishPlan.string(frontmatter[itemKey])
                    // `Frontmatter.parse` never produces `.number` (it's write-only — see
                    // `FrontmatterValue`'s doc comment); a numeric `rating:` scalar parses as
                    // `.string`, so try both representations rather than only `.number`.
                    var rating: Double?
                    switch frontmatter[ratingKey] {
                    case .number(let value)?:
                        rating = value
                    case .string(let value)?:
                        rating = Double(value)
                    default:
                        break
                    }
                    let parts: [String] = [
                        item.map { "Reviewed: \($0)" },
                        rating.map { "Rating: \(Self.formatRating($0))/5" },
                    ].compactMap { $0 }
                    if !parts.isEmpty {
                        let summary = parts.joined(separator: " — ")
                        content = content.isEmpty ? summary : "\(summary)\n\n\(content)"
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

    /// Formats a rating without a trailing ".0" for whole numbers (`5` not `5.0`), but keeps a
    /// fractional rating as written (`4.5`).
    private static func formatRating(_ value: Double) -> String {
        guard value.isFinite, value.truncatingRemainder(dividingBy: 1) == 0, let intValue = Int(exactly: value) else {
            return String(value)
        }
        return String(intValue)
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
