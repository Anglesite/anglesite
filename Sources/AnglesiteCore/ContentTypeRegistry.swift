// Sources/AnglesiteCore/ContentTypeRegistry.swift
import Foundation

/// The registry of typed content objects (V-1.1, epic #334 / #343).
///
/// A content type is declared **once** as a `ContentTypeDescriptor` and projects three ways —
/// its frontmatter schema (what the editor and Astro content collection see), its microformats2
/// mapping (what Webmention/federation consume), and its schema.org mapping (what search
/// rich-results consume). This is the "one schema, three projections" principle from the pivot
/// plan: there is a single source of truth per type, and downstream consumers read from it.
///
/// This file is **pure value data with no I/O** — it is the vocabulary, not the machinery.
/// Scaffolding (`ContentScaffold`), the content graph (`SiteContentGraph`), per-type editors,
/// and template generation are layered on top in later V-1 tasks (#344–#352); each reads
/// descriptors from here rather than hard-coding type knowledge.

/// One field in a content type's frontmatter schema.
public struct ContentTypeField: Sendable, Equatable {
    /// The shape of a field's value. Maps to an editor control and to a Zod type at the
    /// template layer (#351); kept deliberately small.
    public enum Kind: Sendable, Equatable {
        case string        // single-line text
        case text          // multi-line plain text
        case markdown      // multi-line rich body
        case bool
        case date          // calendar date, no time
        case datetime      // ISO 8601 date-time with time + timezone (mf2 `dt-*` properties)
        case url
        case image         // a site-relative media path
        case number
        case stringArray   // e.g. tags
        case imageArray    // an ordered list of site-relative media paths (e.g. album photos)
        /// A repeating group of small structured records (e.g. h-resume `experience`/`education`
        /// entries) — an ordered list of member fields, each an existing scalar `Kind`. By
        /// convention `fields` excludes `.markdown`, `.stringArray`, `.imageArray`, and nested
        /// `.objectArray` — enforced by review/tests, not the type system, matching this registry's
        /// existing preference for documented invariants over new type machinery. First declared
        /// by the built-in `resume` descriptor's `experience`/`education` fields (#964).
        ///
        /// **Hand-authored keys inside a record are not preserved across an edit.**
        /// `FrontmatterDocument` promises that form-only editing never silently drops a
        /// hand-authored key — but that promise stops at the top level. One level down, inside a
        /// record, `TypedContentEditor.decode`/`encode` only round-trip the member fields declared
        /// here: an extra key a person wrote into one record item survives an *unedited*
        /// round-trip (the whole field is still verbatim), and is dropped the moment that field is
        /// edited through the app, because `encode` re-emits records from `fields` alone.
        /// Accepted for `resume` — but preserving unknown per-record keys needs its own design
        /// (records would have to carry their unparsed extras through the editor), so weigh it
        /// before a second adopter ships.
        case objectArray(fields: [ContentTypeField])
    }

    public let name: String
    public let kind: Kind
    public let required: Bool

    public init(_ name: String, _ kind: Kind, required: Bool = false) {
        self.name = name
        self.kind = kind
        self.required = required
    }
}

/// How a content type projects to microformats2 and schema.org. Field-name keys reference
/// `ContentTypeField.name` values on the same descriptor.
public struct ContentTypeProjections: Sendable, Equatable {
    /// The root microformats2 class for instances of this type (e.g. `h-entry`, `h-event`,
    /// `h-review`, `h-card`).
    public let microformat: String

    /// Maps a frontmatter field name → its microformats2 property (e.g. `"title"` → `"p-name"`,
    /// `"publishDate"` → `"dt-published"`, `"body"` → `"e-content"`). Fields absent from this map
    /// carry no mf2 property.
    public let microformatProperties: [String: String]

    /// The schema.org `@type` emitted as JSON-LD (e.g. `Article`, `Event`, `Review`,
    /// `LocalBusiness`). `nil` means this type emits no schema.org node.
    ///
    /// **Object-valued property contract.** Some schema.org properties expect a nested `Thing`
    /// rather than a literal (e.g. `Review.itemReviewed`). A string-typed field mapped to such a
    /// property is emitted by the JSON-LD layer (#347–#351) as a minimal node
    /// `{ "@type": "Thing", "name": <value> }`. This is the settled vocabulary-level contract so
    /// the template layer never has to guess; richer typing can be added per-field later.
    public let schemaType: String?

    public init(
        microformat: String,
        microformatProperties: [String: String],
        schemaType: String?
    ) {
        self.microformat = microformat
        self.microformatProperties = microformatProperties
        self.schemaType = schemaType
    }

    /// The raw mf2 property name `@dwk/micropub` stores for `fieldName` — `microformatProperties`
    /// with its mf2 prefix class (`p-`/`e-`/`u-`/`dt-`) stripped. `nil` if `fieldName` has no mf2
    /// mapping (e.g. `draft`, which is derived from the Post Status extension's `post-status`
    /// property rather than its own mf2 property). Used by the Micropub content-sync bridge
    /// (#912) to read a post's raw property map — bare names, no prefix — for a given
    /// `ContentTypeField`.
    public func rawMf2Property(forField fieldName: String) -> String? {
        microformatProperties[fieldName].map(Self.stripMf2Prefix)
    }

    private static func stripMf2Prefix(_ mfProperty: String) -> String {
        for prefix in ["p-", "e-", "u-", "dt-"] where mfProperty.hasPrefix(prefix) {
            return String(mfProperty.dropFirst(prefix.count))
        }
        return mfProperty
    }
}

/// Where instances of a content type live on disk, mirroring the Astro layout `ContentScaffold`
/// already uses: route-addressed pages under `src/pages`, or slug-addressed entries in a content
/// collection under `src/content/<collection>`.
public enum ContentStorage: Sendable, Equatable {
    case page
    case collection(String)
    /// One record per site, stored as a data module (not a route, not a collection). The
    /// associated value is the shared slot name; descriptors that share a slot are mutually
    /// exclusive (one identity file per site).
    case singleton(String)
}

/// A registered content type — pure declarative data, no behavior.
public struct ContentTypeDescriptor: Sendable, Equatable, Identifiable {
    /// Stable lowerCamelCase key (e.g. `note`, `article`, `businessProfile`). The registry's key
    /// and the identity used by editors/intents; never localized.
    public let id: String
    /// Human-facing label (e.g. `Business Profile`).
    public let displayName: String
    public let storage: ContentStorage
    public let fields: [ContentTypeField]
    public let projections: ContentTypeProjections

    public init(
        id: String,
        displayName: String,
        storage: ContentStorage,
        fields: [ContentTypeField],
        projections: ContentTypeProjections
    ) {
        self.id = id
        self.displayName = displayName
        self.storage = storage
        self.fields = fields
        self.projections = projections
    }

    /// The default collection name for `.collection`-stored types; `nil` for pages.
    public var collection: String? {
        if case let .collection(name) = storage { return name }
        return nil
    }

    /// The shared slot name for `.singleton`-stored types; `nil` otherwise.
    public var singletonSlot: String? {
        if case let .singleton(name) = storage { return name }
        return nil
    }

    /// Field names treated as a type's human-facing title, in no particular order. A descriptor
    /// declares at most one of these; `ContentScaffold` fills whichever it declares from the
    /// caller-supplied title (#386).
    static let titleLikeFieldNames: Set<String> = ["title", "name", "itemReviewed"]

    /// The field carrying this type's human-facing title, or `nil` when it has none. `reply` and
    /// `like` have none — they are identified by their target URL, not by a name — so the create
    /// UI hides the Title row for them and derives a slug from that URL instead (#916).
    public var titleField: ContentTypeField? {
        fields.first { Self.titleLikeFieldNames.contains($0.name) }
    }

    /// Whether this type's title field, if it has one, is required by the schema. `bookmark`'s
    /// `title` is `z.string().optional()` — present, but not required — so the create UI must gate
    /// on this rather than on `titleField != nil` (#1011).
    public var titleIsRequired: Bool {
        titleField?.required ?? false
    }

    /// Required `.url` fields, in declaration order. The template schemas these project to are
    /// `z.string().url()`, which rejects an empty string, so the create path must collect a value
    /// for each one before writing rather than scaffolding a placeholder (#916).
    public var requiredURLFields: [ContentTypeField] {
        fields.filter { $0.kind == .url && $0.required }
    }
}

/// An ordered, lookup-by-id catalog of content types. Value type so it composes cleanly into the
/// (actor-isolated) graph and the app's environment; built-ins are registered at init and custom
/// types can be added with `register(_:)`.
public struct ContentTypeRegistry: Sendable, Equatable {
    private var byID: [String: ContentTypeDescriptor]
    private var order: [String]
    /// collection name → type id, for `.collection`-stored types only. Built at insert time
    /// so reverse lookups are O(1) and stay in sync with `byID`.
    private var collectionToID: [String: String]

    /// Builds a registry from the given descriptors (default: the built-in catalog). Later
    /// descriptors with a duplicate `id` override earlier ones while keeping first-seen order —
    /// the same last-wins/stable-order contract as `register(_:)`.
    public init(types: [ContentTypeDescriptor] = ContentTypeRegistry.builtIns) {
        byID = [:]
        order = []
        collectionToID = [:]
        for descriptor in types { insert(descriptor) }
    }

    private mutating func insert(_ descriptor: ContentTypeDescriptor) {
        if byID[descriptor.id] == nil { order.append(descriptor.id) }
        // A replaced descriptor may have changed collection; drop any stale reverse entry first.
        if let old = byID[descriptor.id]?.collection { collectionToID.removeValue(forKey: old) }
        byID[descriptor.id] = descriptor
        if let collection = descriptor.collection { collectionToID[collection] = descriptor.id }
    }

    /// Registers (or replaces) a content type. Replacing keeps the type's existing position in
    /// `all`; a new type appends. If two descriptors declare the *same* collection name (under
    /// different ids), the later registration wins the `descriptor(forCollection:)` reverse lookup —
    /// the same last-wins contract as duplicate ids. The built-in catalog has unique collection
    /// names, so this only matters for custom types registered via this method.
    public mutating func register(_ descriptor: ContentTypeDescriptor) {
        insert(descriptor)
    }

    public func descriptor(id: String) -> ContentTypeDescriptor? {
        byID[id]
    }

    /// Reverse of `descriptor(id:)`: the `.collection`-stored type whose collection is `collection`.
    public func descriptor(forCollection collection: String) -> ContentTypeDescriptor? {
        guard let id = collectionToID[collection] else { return nil }
        return byID[id]
    }

    /// Ids of the `.collection`-stored types, in registration order. Page-stored types are excluded.
    public var collectionBackedTypeIDs: [String] {
        order.compactMap { byID[$0] }.filter { $0.collection != nil }.map(\.id)
    }

    /// Shared built-in registry. Lets value-type consumers resolve types without rebuilding it.
    public static let `default` = ContentTypeRegistry()

    /// All registered types in registration order.
    public var all: [ContentTypeDescriptor] {
        order.compactMap { byID[$0] }
    }

    public var ids: [String] { order }
}

// MARK: - Built-in catalog

extension ContentTypeRegistry {
    /// The built-in content types: the personal IndieWeb post types (#344) and the small-business
    /// types (#345), declared as data here in V-1.1. Templates and editors for them land in their
    /// own tasks; this is the shared vocabulary they consume.
    public static let builtIns: [ContentTypeDescriptor] = personalTypes + identityTypes + resumeTypes + businessTypes + identityAndDirectoryTypes

    // MARK: Personal (h-entry family)

    static let personalTypes: [ContentTypeDescriptor] = [note, article, photo, album, bookmark, reply, like]

    static let note = ContentTypeDescriptor(
        id: "note",
        displayName: "Note",
        storage: .collection("notes"),
        fields: [
            ContentTypeField("body", .markdown, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("audience", .url),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "body": "e-content",
                "publishDate": "dt-published",
                "tags": "p-category",
            ],
            schemaType: "SocialMediaPosting"
        )
    )

    static let article = ContentTypeDescriptor(
        id: "article",
        displayName: "Article",
        storage: .collection("articles"),
        fields: [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("summary", .text),
            ContentTypeField("body", .markdown, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("updated", .datetime),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("audience", .url),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "title": "p-name",
                "summary": "p-summary",
                "body": "e-content",
                "publishDate": "dt-published",
                "updated": "dt-updated",
                "tags": "p-category",
            ],
            schemaType: "Article"
        )
    )

    static let photo = ContentTypeDescriptor(
        id: "photo",
        displayName: "Photo",
        storage: .collection("photos"),
        fields: [
            ContentTypeField("image", .image, required: true),
            ContentTypeField("caption", .text),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "image": "u-photo",
                "caption": "p-summary",
                "publishDate": "dt-published",
                "tags": "p-category",
            ],
            schemaType: "Photograph"
        )
    )

    static let album = ContentTypeDescriptor(
        id: "album",
        displayName: "Album",
        storage: .collection("albums"),
        fields: [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("images", .imageArray, required: true),
            ContentTypeField("body", .markdown),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "title": "p-name",
                "images": "u-photo",
                "body": "e-content",
                "publishDate": "dt-published",
                "tags": "p-category",
            ],
            schemaType: "ImageGallery"
        )
    )

    static let bookmark = ContentTypeDescriptor(
        id: "bookmark",
        displayName: "Bookmark",
        storage: .collection("bookmarks"),
        fields: [
            ContentTypeField("bookmarkOf", .url, required: true),
            ContentTypeField("title", .string),
            ContentTypeField("body", .markdown),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("tags", .stringArray),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "bookmarkOf": "u-bookmark-of",
                "title": "p-name",
                "body": "e-content",
                "publishDate": "dt-published",
                "tags": "p-category",
            ],
            schemaType: nil
        )
    )

    static let reply = ContentTypeDescriptor(
        id: "reply",
        displayName: "Reply",
        storage: .collection("replies"),
        fields: [
            ContentTypeField("inReplyTo", .url, required: true),
            ContentTypeField("body", .markdown, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "inReplyTo": "u-in-reply-to",
                "body": "e-content",
                "publishDate": "dt-published",
            ],
            schemaType: "Comment"
        )
    )

    static let like = ContentTypeDescriptor(
        id: "like",
        displayName: "Like",
        storage: .collection("likes"),
        fields: [
            ContentTypeField("likeOf", .url, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
            ContentTypeField("draft", .bool),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "likeOf": "u-like-of",
                "publishDate": "dt-published",
            ],
            schemaType: nil
        )
    )

    // MARK: Site identity (h-card singletons, #388)

    /// The two representative-h-card types. They share the `"profile"` slot, so a site has at most
    /// one identity — personal or business — enforced at scaffold time by the single slot file.
    static let identityTypes: [ContentTypeDescriptor] = [businessProfile, personalProfile]

    static let businessProfile = ContentTypeDescriptor(
        id: "businessProfile",
        displayName: "Business Profile",
        storage: .singleton("profile"),
        fields: [
            ContentTypeField("name", .string, required: true),
            ContentTypeField("description", .text),
            ContentTypeField("telephone", .string),
            ContentTypeField("email", .string),
            ContentTypeField("streetAddress", .string),
            ContentTypeField("locality", .string),
            ContentTypeField("region", .string),
            ContentTypeField("postalCode", .string),
            ContentTypeField("hours", .stringArray),
            ContentTypeField("url", .url),
        ],
        // `hours` is intentionally unmapped: h-card has no normative opening-hours property, so
        // hours are carried by schema.org (`LocalBusiness.openingHours`) only, not microformats2.
        projections: ContentTypeProjections(
            microformat: "h-card",
            microformatProperties: [
                "name": "p-name",
                "description": "p-note",
                "telephone": "p-tel",
                "email": "u-email",
                "streetAddress": "p-street-address",
                "locality": "p-locality",
                "region": "p-region",
                "postalCode": "p-postal-code",
                "url": "u-url",
            ],
            schemaType: "LocalBusiness"
        )
    )

    static let personalProfile = ContentTypeDescriptor(
        id: "personalProfile",
        displayName: "Personal Profile",
        storage: .singleton("profile"),
        fields: [
            ContentTypeField("name", .string, required: true),
            ContentTypeField("description", .text),
            ContentTypeField("email", .string),
            ContentTypeField("url", .url),
            ContentTypeField("photo", .image),
        ],
        projections: ContentTypeProjections(
            microformat: "h-card",
            microformatProperties: [
                "name": "p-name",
                "description": "p-note",
                "email": "u-email",
                "url": "u-url",
                "photo": "u-photo",
            ],
            schemaType: "Person"
        )
    )

    // MARK: Resume (h-resume singleton, #964)

    static let resumeTypes: [ContentTypeDescriptor] = [resume]

    /// The site owner's professional history — the first built-in user of `.objectArray`
    /// (#1117). A singleton, not a collection: a resume is inherently one-per-site, same
    /// storage shape as the identity types above (but its own `"resume"` slot, so it coexists
    /// with either `businessProfile` or `personalProfile` rather than competing for `"profile"`).
    ///
    /// `experience`/`education` carry no entry in `microformatProperties` — mf2 has no flat
    /// property for a repeating structured record. `Hresume.astro` nests each row as its own
    /// `p-experience h-event` / `p-education h-event` compound microformat instead, the same way
    /// `businessProfile.hours` above renders outside this projection's flat-property contract.
    ///
    /// Deliberately out of scope: mf2's `p-contact` (nested nested h-card) and `p-affiliation`.
    /// The site's own identity h-card (`personalProfile`/`businessProfile`, rendered by
    /// `Hcard.astro`) already carries the owner's contact info and is discoverable from every
    /// page footer; duplicating it as a nested h-card inside the resume adds real complexity
    /// (the app has no existing "one h-card links to related content" wiring to copy) for a
    /// property mf2 doesn't require a resume to carry.
    static let resume = ContentTypeDescriptor(
        id: "resume",
        displayName: "Resume",
        storage: .singleton("resume"),
        fields: [
            ContentTypeField("name", .string, required: true),
            ContentTypeField("summary", .text, required: true),
            ContentTypeField("experience", .objectArray(fields: [
                ContentTypeField("title", .string, required: true),
                ContentTypeField("organization", .string, required: true),
                ContentTypeField("startDate", .date, required: true),
                ContentTypeField("endDate", .date),
                ContentTypeField("description", .text),
            ])),
            ContentTypeField("education", .objectArray(fields: [
                ContentTypeField("degree", .string, required: true),
                ContentTypeField("institution", .string, required: true),
                ContentTypeField("startDate", .date, required: true),
                ContentTypeField("endDate", .date),
                ContentTypeField("description", .text),
            ])),
            ContentTypeField("skills", .stringArray),
        ],
        projections: ContentTypeProjections(
            microformat: "h-resume",
            microformatProperties: [
                "name": "p-name",
                "summary": "p-summary",
                "skills": "p-skill",
            ],
            schemaType: "Person"
        )
    )

    // MARK: Business (collection types, #345 / §4.1)

    static let businessTypes: [ContentTypeDescriptor] = [announcement, event, review]

    static let announcement = ContentTypeDescriptor(
        id: "announcement",
        displayName: "Announcement",
        storage: .collection("announcements"),
        fields: [
            ContentTypeField("title", .string, required: true),
            ContentTypeField("body", .markdown, required: true),
            ContentTypeField("publishDate", .datetime, required: true),
        ],
        projections: ContentTypeProjections(
            microformat: "h-entry",
            microformatProperties: [
                "title": "p-name",
                "body": "e-content",
                "publishDate": "dt-published",
            ],
            // Not schema.org `SpecialAnnouncement` — that is a COVID-era crisis type requiring
            // crisis-specific properties. A general business announcement is editorial news.
            schemaType: "NewsArticle"
        )
    )

    static let event = ContentTypeDescriptor(
        id: "event",
        displayName: "Event",
        storage: .collection("events"),
        fields: [
            ContentTypeField("name", .string, required: true),
            ContentTypeField("body", .markdown),
            ContentTypeField("start", .datetime, required: true),
            ContentTypeField("end", .datetime),
            ContentTypeField("location", .string),
        ],
        projections: ContentTypeProjections(
            microformat: "h-event",
            microformatProperties: [
                "name": "p-name",
                "body": "e-content",
                "start": "dt-start",
                "end": "dt-end",
                "location": "p-location",
            ],
            schemaType: "Event"
        )
    )

    static let review = ContentTypeDescriptor(
        id: "review",
        displayName: "Review",
        storage: .collection("reviews"),
        fields: [
            // String name of the item; the JSON-LD layer wraps it as a `{@type: Thing, name}` node
            // for schema.org `Review.itemReviewed` per the object-valued-property contract on
            // `ContentTypeProjections.schemaType`.
            ContentTypeField("itemReviewed", .string, required: true),
            ContentTypeField("rating", .number, required: true),
            ContentTypeField("body", .markdown),
            ContentTypeField("publishDate", .datetime, required: true),
        ],
        projections: ContentTypeProjections(
            microformat: "h-review",
            microformatProperties: [
                "itemReviewed": "p-item",
                "rating": "p-rating",
                "body": "e-content",
                "publishDate": "dt-published",
            ],
            schemaType: "Review"
        )
    )

    // MARK: Identity and directory (h-card collections, #462)

    static let identityAndDirectoryTypes: [ContentTypeDescriptor] = [member]

    static let member = ContentTypeDescriptor(
        id: "member",
        displayName: "Member",
        storage: .collection("members"),
        fields: [
            ContentTypeField("name", .string, required: true),
            ContentTypeField("role", .string),
            ContentTypeField("joinedDate", .date, required: true),
            ContentTypeField("photo", .image),
            ContentTypeField("links", .stringArray),
            ContentTypeField("bio", .markdown),
        ],
        projections: ContentTypeProjections(
            microformat: "h-card",
            microformatProperties: [
                "name": "p-name",
                "role": "p-job-title",
                "photo": "u-photo",
                "links": "u-url",
                "bio": "p-note",
            ],
            schemaType: "Person"
        )
    )
}
