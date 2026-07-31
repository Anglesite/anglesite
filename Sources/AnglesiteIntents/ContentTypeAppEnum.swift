import AppIntents
import AnglesiteCore

/// The typed content kinds a user can filter by (the `.collection`-stored built-ins from
/// `ContentTypeRegistry`). An `AppEnum` so it appears as a typed picker in Shortcuts and in the
/// auto-derived MCP schema. `rawValue` is the registry id; kept in sync by a drift-guard test
/// (`ContentTypeAppEnumTests`) — adding a built-in collection type fails that test until a case
/// is added here. `businessProfile` (page singleton) is intentionally absent (#351 scope).
public enum ContentTypeAppEnum: String, AppEnum, Sendable, CaseIterable {
    // Personal IndieWeb post types (h-entry family, #344).

    /// Short, title-less microblog post — body, date, tags only.
    case note
    /// Long-form titled post with a summary (schema.org `Article`).
    case article
    /// A single image with a caption.
    case photo
    /// An ordered set of images published as one entry.
    case album
    /// A saved external URL (`u-bookmark-of`) with optional commentary.
    case bookmark
    /// A response to an external URL (`u-in-reply-to`). Identified by its target, not a title —
    /// the create UI hides the Title row for it (#916).
    case reply
    /// A lightweight endorsement of an external URL (`u-like-of`); target-identified like
    /// ``reply``, and body-less.
    case like

    // Small-business types (#345).

    /// A dated business news item (schema.org `NewsArticle` — deliberately not the COVID-era
    /// `SpecialAnnouncement`).
    case announcement
    /// A happening with start/end dates and a location (h-event → schema.org `Event`).
    case event
    /// A rated review of a named item (h-review → schema.org `Review`).
    case review

    // Identity and directory types (h-card collections, #462).

    /// A directory entry for a person — name, role, photo, bio (h-card → schema.org `Person`).
    case member

    /// Type name shown in Shortcuts and the derived MCP schema.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Content Type" }

    /// Picker labels, mirroring the registry descriptors' `displayName`s — the drift-guard test
    /// keeps this map total over the cases.
    public static let caseDisplayRepresentations: [ContentTypeAppEnum: DisplayRepresentation] = [
        .note: "Note", .article: "Article", .photo: "Photo", .album: "Album",
        .bookmark: "Bookmark", .reply: "Reply", .like: "Like",
        .announcement: "Announcement", .event: "Event", .review: "Review",
        .member: "Member",
    ]

    /// The Astro content collection backing this type (e.g. `.event` → "events"), via the registry.
    public var collection: String? {
        ContentTypeRegistry.default.descriptor(id: rawValue)?.collection
    }
}
