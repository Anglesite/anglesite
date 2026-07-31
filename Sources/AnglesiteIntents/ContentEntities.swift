import AppIntents
import AnglesiteCore
import Foundation

// MARK: - PageEntity

/// An Anglesite page, addressable by Siri/Shortcuts. Backed live by `SiteContentGraph` —
/// no cache, so the entity never goes stale relative to the graph state.
public struct PageEntity: AppEntity, IndexedEntity, Identifiable, Sendable {
    /// Stable identifier `"{siteID}:page:{route}"` — identical to `SiteContentGraph.Page.id`,
    /// so Spotlight results and persisted Shortcuts references round-trip through
    /// ``PageEntityQuery/entities(for:)`` with no mapping table.
    public let id: String
    /// The page's title, falling back to its route when the front matter has none — matching
    /// what Spotlight shows as the result title, so a title-less page is still findable.
    public let displayName: String
    /// Site-relative route (e.g. `/about/`), exposed as a Shortcuts property so workflows can
    /// filter or display it.
    @Property(title: "Route") public var route: String
    /// Owning site's stable UUID string, tying the entity back to its `SiteStore` site and
    /// `SiteContentGraph` partition.
    @Property(title: "Site") public var siteID: String

    /// "Page" — the type name Siri/Shortcuts show in parameter pickers and disambiguation.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Page" }

    /// Title plus route subtitle, so identically-titled pages on different routes stay
    /// distinguishable in Siri's disambiguation list.
    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(displayName)", subtitle: "\(route)")
    }

    /// The query AppIntents uses to resolve `@Parameter` page references and drive Spotlight
    /// indexing for this entity type.
    public static let defaultQuery = PageEntityQuery()

    /// Projects a live graph row into the entity. The title-to-route fallback for
    /// ``displayName`` lives here so every graph-sourced entity gets it consistently.
    public init(_ page: SiteContentGraph.Page) {
        self.id = page.id
        self.displayName = page.title ?? page.route
        self.route = page.route
        self.siteID = page.siteID
    }

    /// Memberwise initializer for callers without a graph row (test fixtures, reconstruction
    /// from a persisted identifier). Applies no fallback logic — values are stored as given.
    public init(id: String, displayName: String, route: String, siteID: String) {
        self.id = id
        self.displayName = displayName
        self.route = route
        self.siteID = siteID
    }
}

/// Resolves `PageEntity` references from `SiteContentGraph`. Used by Siri/Shortcuts for both
/// id round-trip (`entities(for:)`) and natural-language match (`entities(matching:)`).
public struct PageEntityQuery: EntityStringQuery {
    @Dependency private var graph: SiteContentGraph

    /// Required by the AppIntents runtime, which instantiates queries itself; the graph arrives
    /// via `@Dependency` (registered in `AnglesiteIntents.bootstrap(contentGraph:)`), not here.
    public init() {}

    private var resolved: SiteContentGraph {
        // Tests bind ContentGraphOverride.scoped; production goes through @Dependency.
        // The `??` short-circuits, so `graph` is only touched when no override is bound.
        ContentGraphOverride.scoped ?? graph
    }

    /// Round-trips persisted identifiers (Spotlight results, saved Shortcuts) back to live
    /// entities. Unknown ids are silently dropped — a since-deleted page just vanishes from an
    /// old shortcut instead of failing the whole run.
    public func entities(for identifiers: [String]) async throws -> [PageEntity] {
        // Single actor hop for all ids (#170); the graph preserves input order and skips unknowns.
        await resolved.pages(ids: identifiers).map(PageEntity.init)
    }

    /// Natural-language lookup across every loaded site, newest-first with id as the stable
    /// tiebreaker. An empty/whitespace query deliberately returns `[]` — see the guard comment.
    public func entities(matching string: String) async throws -> [PageEntity] {
        // Empty / whitespace-only query → []. The graph's searchPages returns everything on
        // empty input; surfacing that here would double up with suggestedEntities() during
        // AppIntents disambiguation prefetch. Keep the two surfaces distinct.
        guard !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        let g = resolved
        var matches: [SiteContentGraph.Page] = []
        for siteID in await g.knownSiteIDs() {
            matches.append(contentsOf: await g.searchPages(siteID: siteID, matching: string))
        }
        return matches
            .sorted {
                $0.lastModified != $1.lastModified
                    ? $0.lastModified > $1.lastModified
                    : $0.id < $1.id
            }
            .map(PageEntity.init)
    }

    /// Every page across all loaded sites, newest-first — what Shortcuts offers before the user
    /// types anything. Distinct from ``entities(matching:)`` so the two surfaces never overlap
    /// during AppIntents' disambiguation prefetch.
    public func suggestedEntities() async throws -> [PageEntity] {
        let g = resolved
        var all: [SiteContentGraph.Page] = []
        for siteID in await g.knownSiteIDs() {
            all.append(contentsOf: await g.pages(for: siteID))
        }
        return all
            .sorted {
                $0.lastModified != $1.lastModified
                    ? $0.lastModified > $1.lastModified
                    : $0.id < $1.id
            }
            .map(PageEntity.init)
    }

    /// No default: with multiple sites loaded there is no meaningful "first page", so parameter
    /// resolution always prompts rather than silently picking one.
    public func defaultResult() async -> PageEntity? { nil }
}

// MARK: - PostEntity

/// An Anglesite blog post / content-collection entry, addressable by Siri/Shortcuts.
public struct PostEntity: AppEntity, IndexedEntity, Identifiable, Sendable {
    /// Stable identifier `"{siteID}:post:{slug}"` — identical to `SiteContentGraph.Post.id`, so
    /// Spotlight/Shortcuts references round-trip through ``PostEntityQuery/entities(for:)``.
    public let id: String
    /// The post's front-matter title. Unlike ``PageEntity/displayName`` there is no fallback —
    /// a collection entry always has a title in the graph.
    public let displayName: String
    /// URL slug within its collection, exposed as a Shortcuts property for filtering/display.
    @Property(title: "Slug") public var slug: String
    /// Astro content-collection directory name (`blog`, `notes`, …) the entry lives in.
    @Property(title: "Collection") public var collection: String
    /// Human-readable content-type display name (the typed dimension of #351), derived from the
    /// collection via ``contentTypeName(forCollection:)`` — surfaced so Shortcuts/Spotlight show
    /// "Note"/"Recipe" rather than a raw directory name.
    @Property(title: "Type") public var contentType: String
    /// Front-matter draft flag; surfaced in the subtitle so unpublished work is visibly marked
    /// in Siri results before the user acts on it.
    public let isDraft: Bool
    /// Front-matter tags, carried so index/search layers can use them without re-reading the
    /// file. Not a `@Property` today — plain storage keeps adding one later non-breaking.
    public let tags: [String]
    /// Owning site's stable UUID string, tying the entity back to its `SiteStore` site and
    /// `SiteContentGraph` partition.
    @Property(title: "Site") public var siteID: String

    /// "Post" — the type name Siri/Shortcuts show in parameter pickers and disambiguation.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Post" }

    /// Title plus `collection/slug` subtitle, with an explicit "(draft)" marker so drafts are
    /// distinguishable from published entries in Siri's disambiguation list.
    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(displayName)",
            subtitle: "\(collection)/\(slug)\(isDraft ? " (draft)" : "")"
        )
    }

    /// The query AppIntents uses to resolve `@Parameter` post references and drive Spotlight
    /// indexing for this entity type.
    public static let defaultQuery = PostEntityQuery()

    /// Typed dimension (#351): map a post's collection back to its content type's display name via
    /// the registry; fall back to the raw collection for custom/unknown collections. Shared by both
    /// inits (and `AddPostIntent.createdPost`) so the derivation lives in exactly one place.
    public static func contentTypeName(forCollection collection: String) -> String {
        ContentTypeRegistry.default.descriptor(forCollection: collection)?.displayName ?? collection
    }

    /// Projects a live graph row into the entity, deriving ``contentType`` from the collection
    /// so no caller can index a blank "Type" attribute.
    public init(_ post: SiteContentGraph.Post) {
        self.id = post.id
        self.displayName = post.title
        self.isDraft = post.draft
        self.tags = post.tags
        self.slug = post.slug
        self.collection = post.collection
        self.siteID = post.siteID
        self.contentType = Self.contentTypeName(forCollection: post.collection)
    }

    /// Memberwise initializer for callers without a graph row (test fixtures, freshly created
    /// posts — see `AddPostIntent`). Defaults lean conservative: `isDraft` is `true` because the
    /// creation flows that use this init scaffold drafts, and an empty `contentType` is derived
    /// from `collection` at assignment (a default parameter can't reference another parameter).
    public init(id: String, displayName: String, slug: String, collection: String,
                siteID: String, isDraft: Bool = true, tags: [String] = [],
                contentType: String = "") {
        self.id = id
        self.displayName = displayName
        self.isDraft = isDraft
        self.tags = tags
        self.slug = slug
        self.collection = collection
        self.siteID = siteID
        // A default-param can't reference `collection`, so derive when the caller omits it — this
        // keeps the Spotlight "Type" attribute from being indexed blank.
        self.contentType = contentType.isEmpty ? Self.contentTypeName(forCollection: collection) : contentType
    }
}

/// Resolves `PostEntity` references from `SiteContentGraph`. Search covers title, slug, tags,
/// and collection name (delegated to `SiteContentGraph.searchPosts`).
public struct PostEntityQuery: EntityStringQuery {
    @Dependency private var graph: SiteContentGraph

    /// Required by the AppIntents runtime, which instantiates queries itself; the graph arrives
    /// via `@Dependency` (registered in `AnglesiteIntents.bootstrap(contentGraph:)`), not here.
    public init() {}

    private var resolved: SiteContentGraph {
        ContentGraphOverride.scoped ?? graph
    }

    /// Round-trips persisted identifiers back to live entities; unknown ids are silently
    /// dropped. Same contract as ``PageEntityQuery/entities(for:)``.
    public func entities(for identifiers: [String]) async throws -> [PostEntity] {
        // Single actor hop for all ids (#170); the graph preserves input order and skips unknowns.
        await resolved.posts(ids: identifiers).map(PostEntity.init)
    }

    /// Natural-language lookup across every loaded site, newest-first. Matching spans title,
    /// slug, tags, and collection (delegated to the graph's `searchPosts`); an empty query
    /// deliberately returns `[]` — see the guard comment.
    public func entities(matching string: String) async throws -> [PostEntity] {
        // Empty / whitespace-only query → []. The graph's searchPosts returns everything on
        // empty input; surfacing that here would double up with suggestedEntities() during
        // AppIntents disambiguation prefetch. Keep the two surfaces distinct.
        guard !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        let g = resolved
        var matches: [SiteContentGraph.Post] = []
        for siteID in await g.knownSiteIDs() {
            matches.append(contentsOf: await g.searchPosts(siteID: siteID, matching: string))
        }
        return matches
            .sorted {
                $0.lastModified != $1.lastModified
                    ? $0.lastModified > $1.lastModified
                    : $0.id < $1.id
            }
            .map(PostEntity.init)
    }

    /// Every post across all loaded sites, newest-first — kept distinct from
    /// ``entities(matching:)`` so the two surfaces never overlap during disambiguation prefetch.
    public func suggestedEntities() async throws -> [PostEntity] {
        let g = resolved
        var all: [SiteContentGraph.Post] = []
        for siteID in await g.knownSiteIDs() {
            all.append(contentsOf: await g.posts(for: siteID))
        }
        return all
            .sorted {
                $0.lastModified != $1.lastModified
                    ? $0.lastModified > $1.lastModified
                    : $0.id < $1.id
            }
            .map(PostEntity.init)
    }

    /// No default — same multi-site reasoning as ``PageEntityQuery/defaultResult()``.
    public func defaultResult() async -> PostEntity? { nil }
}

// MARK: - ImageEntity

/// An image asset under `public/images/` (or anywhere referenced), addressable by Siri/Shortcuts.
public struct ImageEntity: AppEntity, IndexedEntity, Identifiable, Sendable {
    /// Stable identifier `"{siteID}:image:{relativePath}"` — identical to
    /// `SiteContentGraph.Image.id`, so Spotlight/Shortcuts references round-trip through
    /// ``ImageEntityQuery/entities(for:)``.
    public let id: String
    /// The image's file name (no directory), matching what Spotlight shows as the result title.
    public let displayName: String
    /// Path relative to the site source (e.g. `public/images/hero.jpg`), exposed as a Shortcuts
    /// property; also the subtitle, since file names alone often collide across directories.
    @Property(title: "Path") public var relativePath: String
    /// Project-relative source file paths that reference this image (per `DeadAssetScanner`,
    /// not routes — may include non-page files like `.css`/`.ts` alongside actual pages).
    /// Carried in the struct (not surfaced in `displayRepresentation` today) so adding it later
    /// isn't a source-breaking AppEntity schema change for Shortcuts persistence / donated
    /// interactions.
    public let usedOnPages: [String]
    /// Owning site's stable UUID string, tying the entity back to its `SiteStore` site and
    /// `SiteContentGraph` partition.
    @Property(title: "Site") public var siteID: String

    /// "Image" — the type name Siri/Shortcuts show in parameter pickers and disambiguation.
    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Image" }

    /// File name plus relative-path subtitle, so same-named images in different directories
    /// stay distinguishable in Siri's disambiguation list.
    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(displayName)", subtitle: "\(relativePath)")
    }

    /// The query AppIntents uses to resolve `@Parameter` image references and drive Spotlight
    /// indexing for this entity type.
    public static let defaultQuery = ImageEntityQuery()

    /// Projects a live graph row into the entity. The only initializer — images are never
    /// synthesized outside the graph, so no memberwise variant exists.
    public init(_ image: SiteContentGraph.Image) {
        self.id = image.id
        self.displayName = image.fileName
        self.usedOnPages = image.usedOnPages
        self.relativePath = image.relativePath
        self.siteID = image.siteID
    }
}

/// Resolves `ImageEntity` references from `SiteContentGraph`. Search covers fileName and
/// relativePath (delegated to `SiteContentGraph.searchImages`).
public struct ImageEntityQuery: EntityStringQuery {
    @Dependency private var graph: SiteContentGraph

    /// Required by the AppIntents runtime, which instantiates queries itself; the graph arrives
    /// via `@Dependency` (registered in `AnglesiteIntents.bootstrap(contentGraph:)`), not here.
    public init() {}

    private var resolved: SiteContentGraph {
        ContentGraphOverride.scoped ?? graph
    }

    /// Round-trips persisted identifiers back to live entities; unknown ids are silently
    /// dropped. Same contract as ``PageEntityQuery/entities(for:)``.
    public func entities(for identifiers: [String]) async throws -> [ImageEntity] {
        // Single actor hop for all ids (#170); the graph preserves input order and skips unknowns.
        await resolved.images(ids: identifiers).map(ImageEntity.init)
    }

    /// Natural-language lookup across every loaded site, newest-first. Matching spans file name
    /// and relative path (delegated to the graph's `searchImages`); an empty query deliberately
    /// returns `[]` — see the guard comment.
    public func entities(matching string: String) async throws -> [ImageEntity] {
        // Empty / whitespace-only query → []. The graph's searchImages returns everything on
        // empty input; surfacing that here would double up with suggestedEntities() during
        // AppIntents disambiguation prefetch. Keep the two surfaces distinct.
        guard !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        let g = resolved
        var matches: [SiteContentGraph.Image] = []
        for siteID in await g.knownSiteIDs() {
            matches.append(contentsOf: await g.searchImages(siteID: siteID, matching: string))
        }
        return matches
            .sorted {
                $0.lastModified != $1.lastModified
                    ? $0.lastModified > $1.lastModified
                    : $0.id < $1.id
            }
            .map(ImageEntity.init)
    }

    /// Every image across all loaded sites, newest-first — kept distinct from
    /// ``entities(matching:)`` so the two surfaces never overlap during disambiguation prefetch.
    public func suggestedEntities() async throws -> [ImageEntity] {
        let g = resolved
        var all: [SiteContentGraph.Image] = []
        for siteID in await g.knownSiteIDs() {
            all.append(contentsOf: await g.images(for: siteID))
        }
        return all
            .sorted {
                $0.lastModified != $1.lastModified
                    ? $0.lastModified > $1.lastModified
                    : $0.id < $1.id
            }
            .map(ImageEntity.init)
    }

    /// No default — same multi-site reasoning as ``PageEntityQuery/defaultResult()``.
    public func defaultResult() async -> ImageEntity? { nil }
}
