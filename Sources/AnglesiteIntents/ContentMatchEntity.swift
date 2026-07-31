import AppIntents
import AnglesiteCore

/// The kind of content a search match refers to. An `AppEnum` so it appears as a typed
/// field in the auto-derived MCP/Shortcuts schema (not just a string).
public enum ContentMatchKind: String, AppEnum, Sendable {
    /// The match is a route-addressed page (projected from a ``PageEntity``).
    case page
    /// The match is a collection entry (projected from a ``PostEntity``).
    case post
    /// The match is a media asset (projected from an ``ImageEntity``).
    case image

    /// Type name shown in Shortcuts and the derived MCP schema.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Content Kind" }
    /// Capitalized labels for pickers and result subtitles; the raw values stay lowercase for
    /// the schema.
    public static var caseDisplayRepresentations: [ContentMatchKind: DisplayRepresentation] {
        [.page: "Page", .post: "Post", .image: "Image"]
    }
}

/// A uniform projection of a `PageEntity` / `PostEntity` / `ImageEntity` search hit.
/// `id` is the underlying entity's id ("{siteID}:{kind}:{path}"), so an agent can hand a
/// match straight to any intent that resolves the concrete type. `SearchContentIntent`
/// returns these so an agent can search-then-act across all three content kinds at once.
public struct ContentMatchEntity: AppEntity, Identifiable, Sendable {
    /// The underlying concrete entity's id, unchanged ("{siteID}:{kind}:{path}") — the property
    /// that lets ``ContentMatchEntityQuery`` route resolution back to the concrete queries.
    public let id: String
    /// Which concrete entity type this match projects — the discriminator agents branch on.
    @Property(title: "Kind") public var kind: ContentMatchKind
    /// The entity's display name (page/post title or image filename).
    @Property(title: "Title") public var title: String
    /// Kind-specific locator: a page's route, a post's slug, or an image's relative path.
    @Property(title: "Path") public var path: String
    /// The owning site's id, so a match can be scoped back without re-parsing `id`.
    @Property(title: "Site") public var siteID: String

    /// Type name shown in Shortcuts and the derived MCP schema.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Content Match" }

    /// Title + "kind: path" subtitle, so mixed-kind result lists stay distinguishable at a
    /// glance.
    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(kind.rawValue): \(path)")
    }

    /// Required by `AppEntity`; see ``ContentMatchEntityQuery`` for the id-routing behavior.
    public static let defaultQuery = ContentMatchEntityQuery()

    /// Memberwise. Prefer the projection initializers below when starting from a concrete
    /// entity — they keep the id/kind/path invariants aligned by construction.
    public init(id: String, kind: ContentMatchKind, title: String, path: String, siteID: String) {
        self.id = id; self.kind = kind; self.title = title; self.path = path; self.siteID = siteID
    }

    /// Projects a page hit (`path` = route).
    public init(_ p: PageEntity) {
        self.init(id: p.id, kind: .page, title: p.displayName, path: p.route, siteID: p.siteID)
    }
    /// Projects a post hit (`path` = slug).
    public init(_ p: PostEntity) {
        self.init(id: p.id, kind: .post, title: p.displayName, path: p.slug, siteID: p.siteID)
    }
    /// Projects an image hit (`path` = site-relative file path).
    public init(_ i: ImageEntity) {
        self.init(id: i.id, kind: .image, title: i.displayName, path: i.relativePath, siteID: i.siteID)
    }
}

/// Resolves `ContentMatchEntity` ids by routing each id to the concrete entity query based on
/// its ":page:" / ":post:" / ":image:" segment, then projecting. Input order is preserved.
public struct ContentMatchEntityQuery: EntityQuery {
    /// Stateless — resolution state lives in the concrete queries this delegates to.
    public init() {}

    /// Splits `identifiers` by kind segment, resolves each batch through its concrete query, and
    /// reassembles in the caller's order (ids that no longer resolve are silently dropped).
    public func entities(for identifiers: [String]) async throws -> [ContentMatchEntity] {
        let pages = try await PageEntityQuery()
            .entities(for: identifiers.filter { $0.contains(":page:") }).map(ContentMatchEntity.init)
        let posts = try await PostEntityQuery()
            .entities(for: identifiers.filter { $0.contains(":post:") }).map(ContentMatchEntity.init)
        let images = try await ImageEntityQuery()
            .entities(for: identifiers.filter { $0.contains(":image:") }).map(ContentMatchEntity.init)
        let byID = Dictionary(uniqueKeysWithValues: (pages + posts + images).map { ($0.id, $0) })
        return identifiers.compactMap { byID[$0] }
    }

    /// Deliberately empty: a match only exists relative to a search query, so there is no
    /// sensible standing list for Shortcuts to suggest.
    public func suggestedEntities() async throws -> [ContentMatchEntity] { [] }
}
