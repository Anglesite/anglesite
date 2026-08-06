import Foundation

/// Grapheme-limit truncation for Standard.site record text fields. The lexicon caps `title` at
/// 500 graphemes and `description` at 3000 (https://standard.site/docs/lexicons/document).
/// `String.count` already counts extended grapheme clusters, so `prefix` truncates on a grapheme
/// boundary without any UTF-16/UTF-8 bookkeeping.
public enum StandardSiteText {
    /// `site.standard.publication`/`site.standard.document` `title` grapheme limit.
    public static let titleGraphemeLimit = 500
    /// `site.standard.document` `description` grapheme limit.
    public static let descriptionGraphemeLimit = 3000

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

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case name, url, description
    }

    /// Memberwise initializer.
    /// - Parameters:
    ///   - name: The site's display name.
    ///   - url: The site's canonical public URL.
    ///   - description: A short description of the site, if any.
    public init(name: String, url: String, description: String?) {
        self.name = StandardSiteText.truncate(name, graphemeLimit: StandardSiteText.titleGraphemeLimit)
        self.url = url
        self.description = description.map {
            StandardSiteText.truncate($0, graphemeLimit: StandardSiteText.descriptionGraphemeLimit)
        }
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

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case site, title, description, path, publishedAt, updatedAt, tags, textContent
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
        textContent: String?
    ) {
        self.site = site
        self.title = StandardSiteText.truncate(title, graphemeLimit: StandardSiteText.titleGraphemeLimit)
        self.description = description.map {
            StandardSiteText.truncate($0, graphemeLimit: StandardSiteText.descriptionGraphemeLimit)
        }
        self.path = path
        self.publishedAt = publishedAt
        self.updatedAt = updatedAt
        self.tags = tags
        self.textContent = textContent
    }
}
