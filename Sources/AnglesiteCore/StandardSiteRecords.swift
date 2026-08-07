import Foundation

/// Grapheme-limit truncation for Standard.site record text fields. The lexicon caps `title` at
/// 500 graphemes, `description` at 3000, and each `tags` item at 128
/// (https://standard.site/docs/lexicons/document) — `textContent` has no stated limit, so it's
/// left untruncated. `String.count` already counts extended grapheme clusters, so `prefix`
/// truncates on a grapheme boundary without any UTF-16/UTF-8 bookkeeping.
public enum StandardSiteText {
    /// `site.standard.publication`/`site.standard.document` `title` grapheme limit.
    public static let titleGraphemeLimit = 500
    /// `site.standard.document` `description` grapheme limit.
    public static let descriptionGraphemeLimit = 3000
    /// `site.standard.document` `tags` per-item grapheme limit. The lexicon states no limit on
    /// the array's item *count*, only each item's length, so callers aren't expected to cap how
    /// many tags they send.
    public static let tagGraphemeLimit = 128

    /// Truncates `value` to at most `graphemeLimit` graphemes; returns `value` unchanged when
    /// already within the limit.
    public static func truncate(_ value: String, graphemeLimit: Int) -> String {
        guard value.count > graphemeLimit else { return value }
        return String(value.prefix(graphemeLimit))
    }
}

/// `site.standard.publication` record — one per site, describing it for Atmosphere indexers and
/// Bluesky's link-preview enhancement. See https://standard.site/docs/lexicons/publication.
///
/// `name`/`description` are truncated to the lexicon's grapheme limits at construction, so every
/// caller gets a conforming record without repeating the truncation call. Optional properties are
/// omitted from the encoded JSON (not written as `null`) via Swift's synthesized `Encodable`
/// behavior for `Optional` — the same convention `POSSEClients.swift`'s record types already rely
/// on, so no custom `encode(to:)` is needed here either.
public struct StandardSitePublicationRecord: Encodable, Equatable, Sendable {
    let type = "site.standard.publication"
    public let name: String
    public let url: String
    public let description: String?
    /// Square publication icon (≥256×256 recommended, ≤1 MB per the lexicon), uploaded via
    /// `com.atproto.repo.uploadBlob` (v1.1, #1234). `nil` when the site has no installed icon, or
    /// the icon exceeds the size limit.
    public let icon: AtprotoPutRecordClient.BlobRef?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case name, url, description, icon
    }

    /// Memberwise initializer.
    /// - Parameters:
    ///   - name: The site's display name.
    ///   - url: The site's canonical public URL.
    ///   - description: A short description of the site, if any.
    ///   - icon: The site's uploaded icon blob, if any (v1.1, #1234).
    public init(name: String, url: String, description: String?, icon: AtprotoPutRecordClient.BlobRef? = nil) {
        self.name = StandardSiteText.truncate(name, graphemeLimit: StandardSiteText.titleGraphemeLimit)
        self.url = url
        self.description = description.map {
            StandardSiteText.truncate($0, graphemeLimit: StandardSiteText.descriptionGraphemeLimit)
        }
        self.icon = icon
    }
}

/// `site.standard.document` record — one per published post, linking back to the owner's
/// publication record. See https://standard.site/docs/lexicons/document.
///
/// Same truncation-at-construction and optional-omission conventions as
/// ``StandardSitePublicationRecord``.
public struct StandardSiteDocumentRecord: Encodable, Equatable, Sendable {
    let type = "site.standard.document"
    /// The owning publication's at-URI (`at://<did>/site.standard.publication/<rkey>`).
    public let site: String
    public let title: String
    public let description: String?
    /// Joined with the publication's `url` to form the document's canonical URL, e.g. `/blog/hello/`.
    public let path: String?
    /// ISO 8601 timestamp string.
    public let publishedAt: String
    /// ISO 8601 timestamp string; `nil` when the source hasn't been edited since `publishedAt`.
    public let updatedAt: String?
    public let tags: [String]
    /// Plain-text render of the body, for indexers; the lexicon's `content` open union is
    /// deliberately left unset (see the design doc — the git repo stays the canonical format).
    public let textContent: String?
    /// Strong reference to the Bluesky post this document was cross-posted as, set on a later
    /// pass once the POSSE pass has published it (v1.1, #1234) — `publishStandardSite` runs
    /// before `syndicate` in `runPostDeploySequencing`, so this is always `nil` on the same pass
    /// a document is first published and filled in on a subsequent deploy.
    public let bskyPostRef: AtprotoPutRecordClient.StrongRef?
    /// Cover image blob (≤1 MB per the lexicon), uploaded from the post's frontmatter `image`
    /// field via `com.atproto.repo.uploadBlob` (v1.1, #1234). `nil` when the post has no cover
    /// image, or it exceeds the size limit.
    public let coverImage: AtprotoPutRecordClient.BlobRef?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case site, title, description, path, publishedAt, updatedAt, tags, textContent, bskyPostRef, coverImage
    }

    /// Memberwise initializer.
    public init(
        site: String,
        title: String,
        description: String?,
        path: String?,
        publishedAt: String,
        updatedAt: String?,
        tags: [String],
        textContent: String?,
        bskyPostRef: AtprotoPutRecordClient.StrongRef? = nil,
        coverImage: AtprotoPutRecordClient.BlobRef? = nil
    ) {
        self.site = site
        self.title = StandardSiteText.truncate(title, graphemeLimit: StandardSiteText.titleGraphemeLimit)
        self.description = description.map {
            StandardSiteText.truncate($0, graphemeLimit: StandardSiteText.descriptionGraphemeLimit)
        }
        self.path = path
        self.publishedAt = publishedAt
        self.updatedAt = updatedAt
        self.tags = tags.map { StandardSiteText.truncate($0, graphemeLimit: StandardSiteText.tagGraphemeLimit) }
        self.textContent = textContent
        self.bskyPostRef = bskyPostRef
        self.coverImage = coverImage
    }
}
