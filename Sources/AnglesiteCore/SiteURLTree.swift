import Foundation

/// One node of the visitor-facing sidebar URL tree (#714): the site as its built, human-visible
/// pages — never source files. Images, CSS, JS, components, and feed routes are excluded by
/// construction because only page/entry routes enter the builder.
public struct URLTreeNode: Identifiable, Sendable, Equatable {
    /// What a row represents, which decides its icon, context menu, and ``target``.
    public enum Kind: Sendable, Equatable {
        /// The pinned first row for the site itself — activates website settings, not a route.
        case website
        /// The home page (`/`), pinned ahead of its top-level siblings.
        case home
        /// Any other single page or collection entry.
        case page
        /// A URL directory. `collection` names the content collection whose entries live here
        /// (`nil` for a directory of plain nested pages); `hasFeed` marks collections that
        /// publish a feed, so the row can badge it.
        case directory(collection: String?, hasFeed: Bool)
    }
    /// Graph entity id for leaves — the rename/context-menu machinery resolves rows via
    /// `graph.page(id:)`/`post(id:)`, so routes can't serve as leaf ids.
    public let id: String
    /// Row label: the page/entry title where one exists, falling back to its route.
    public let title: String
    /// The visitor-facing URL path this row represents (directories keep a trailing slash).
    public let route: String
    /// What the row represents — see ``Kind``.
    public let kind: Kind
    /// nil for leaves so `List`/`OutlineGroup` hides the disclosure chevron.
    public let children: [URLTreeNode]?

    /// Memberwise initializer; `buildSiteURLTree(websiteTitle:pages:posts:feedCollections:contentTypes:)`
    /// is the production constructor — direct use is for tests and previews.
    public init(id: String, title: String, route: String, kind: Kind, children: [URLTreeNode]?) {
        self.id = id; self.title = title; self.route = route; self.kind = kind
        self.children = children
    }

    /// The navigation this row performs when activated, folding ``Kind`` into the shared
    /// ``NavigatorTarget`` vocabulary so URL-tree rows and file-tree rows drive the window
    /// through one selection path.
    public var target: NavigatorTarget {
        switch kind {
        case .website: return .websiteSettings
        case .directory(let collection, _): return .directory(collection: collection, route: route)
        case .home, .page: return .route(route)
        }
    }
}

/// Builds the sidebar tree: website-settings row pinned first, then home (`/`), then other
/// top-level pages by title, then directories by title. Inside a directory: its own index page
/// pinned, then entries newest-first (undated after dated, by title), then subdirectories.
/// Returns [] for a site with no content so the sidebar keeps its "No content yet" empty state.
public func buildSiteURLTree(
    websiteTitle: String?,
    pages: [SiteContentGraph.Page],
    posts: [SiteContentGraph.Post],
    feedCollections: Set<String>,
    contentTypes: ContentTypeRegistry = .default
) -> [URLTreeNode] {
    guard !pages.isEmpty || !posts.isEmpty else { return [] }

    let trimmed = websiteTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
    let websiteNode = URLTreeNode(
        id: "website",
        title: (trimmed?.isEmpty == false ? trimmed! : "Website"),
        route: "/", kind: .website, children: nil)

    let root = DirectoryBuilder(route: "/")
    for page in pages {
        let segments = pathSegments(of: page.route)
        root.insert(page: page, remainingSegments: segments)
    }
    for post in posts {
        // Entries live one level deep: /<collection>/<slug>/.
        root.child(for: post.collection).entries.append(post)
    }
    root.mergeIndexPages()

    var nodes = [websiteNode]
    nodes.append(contentsOf: root.buildTopLevel(feedCollections: feedCollections, contentTypes: contentTypes))
    return nodes
}

/// "/docs/guides/setup" → ["docs", "guides", "setup"]; "/" → [].
private func pathSegments(of route: String) -> [String] {
    route.split(separator: "/").map(String.init)
}

/// Mutable accumulation node; `build*` converts to immutable `URLTreeNode`s.
private final class DirectoryBuilder {
    let route: String
    var indexPage: SiteContentGraph.Page?
    var pages: [SiteContentGraph.Page] = []
    var entries: [SiteContentGraph.Post] = []
    var subdirectories: [String: DirectoryBuilder] = [:]

    init(route: String) {
        self.route = route
    }

    func child(for segment: String) -> DirectoryBuilder {
        if let existing = subdirectories[segment] { return existing }
        // Not percent-encoded: this route is matched against page routes in `mergeIndexPages`,
        // and `SiteContentGraph.Page.route` values (from `ContentScanner.routeFromPagePath`)
        // are never encoded either. Encoding is only needed for entry routes (`postRoute(for:)`),
        // which are built and matched independently of directory routes.
        let child = DirectoryBuilder(route: route + segment + "/")
        subdirectories[segment] = child
        return child
    }

    func insert(page: SiteContentGraph.Page, remainingSegments: [String]) {
        if remainingSegments.isEmpty {
            indexPage = page
        } else if remainingSegments.count == 1 {
            pages.append(page)
        } else {
            child(for: remainingSegments[0])
                .insert(page: page, remainingSegments: Array(remainingSegments.dropFirst()))
        }
    }

    /// A page whose route names a directory (e.g. `/notes` when a `notes` subdirectory exists
    /// from posts or nested pages) lands in `pages` by `insert`'s segment-count routing, but it's
    /// really that directory's own index page. Move it there so it doesn't show up as a
    /// top-level sibling of the directory it indexes (see the `directoryIndexPinned` test).
    func mergeIndexPages() {
        pages.removeAll { page in
            let normalized = page.route.hasSuffix("/") ? String(page.route.dropLast()) : page.route
            for builder in subdirectories.values {
                let dirNormalized = String(builder.route.dropLast())
                if normalized == dirNormalized || page.route == builder.route {
                    builder.indexPage = page
                    return true
                }
            }
            return false
        }
        for builder in subdirectories.values { builder.mergeIndexPages() }
    }

    /// Top level: home first, then pages by title, then directories by title.
    func buildTopLevel(feedCollections: Set<String>, contentTypes: ContentTypeRegistry) -> [URLTreeNode] {
        var nodes: [URLTreeNode] = []
        if let index = indexPage {
            nodes.append(leaf(for: index, kind: .home, route: "/"))
        }
        nodes.append(contentsOf: pages
            .map { leaf(for: $0, kind: .page, route: $0.route) }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending })
        nodes.append(contentsOf: directoryNodes(feedCollections: feedCollections, contentTypes: contentTypes))
        return nodes
    }

    private func directoryNodes(feedCollections: Set<String>, contentTypes: ContentTypeRegistry) -> [URLTreeNode] {
        subdirectories
            .map { segment, builder in
                builder.buildDirectory(segment: segment, feedCollections: feedCollections,
                                       contentTypes: contentTypes)
            }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    private func buildDirectory(segment: String, feedCollections: Set<String>,
                                contentTypes: ContentTypeRegistry) -> URLTreeNode {
        let collectionName = entries.first?.collection
        var children: [URLTreeNode] = []
        if let index = indexPage {
            children.append(leaf(for: index, kind: .page, route: index.route))
        }
        // Entries newest-first; undated entries follow the dated ones, sorted by title.
        // Plain nested pages sort within the same list by the same rule (all undated).
        let dated = entries.filter { $0.publishDate != nil }
            .sorted { $0.publishDate! > $1.publishDate! }
        let undatedEntries = entries.filter { $0.publishDate == nil }
        let undatedLeaves = (undatedEntries.map { entryLeaf(for: $0) }
            + pages.map { leaf(for: $0, kind: .page, route: $0.route) })
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        children.append(contentsOf: dated.map { entryLeaf(for: $0) })
        children.append(contentsOf: undatedLeaves)
        children.append(contentsOf: directoryNodes(feedCollections: feedCollections,
                                                   contentTypes: contentTypes))
        return URLTreeNode(
            id: "dir:\(route)",
            title: directoryTitle(segment: segment, collection: collectionName, contentTypes: contentTypes),
            route: route,
            kind: .directory(collection: collectionName,
                             hasFeed: collectionName.map(feedCollections.contains) ?? false),
            children: children)
    }

    private func leaf(for page: SiteContentGraph.Page, kind: URLTreeNode.Kind, route: String) -> URLTreeNode {
        URLTreeNode(id: page.id, title: page.title ?? page.route, route: route, kind: kind, children: nil)
    }

    private func entryLeaf(for post: SiteContentGraph.Post) -> URLTreeNode {
        URLTreeNode(id: post.id, title: post.title, route: postRoute(for: post), kind: .page, children: nil)
    }
}

/// A collection's registered content-type display name (e.g. "Note" for `notes`), falling back
/// to the capitalized URL segment.
private func directoryTitle(segment: String, collection: String?, contentTypes: ContentTypeRegistry) -> String {
    if let collection, let descriptor = contentTypes.descriptor(forCollection: collection) {
        return descriptor.displayName
    }
    guard let first = segment.first else { return segment }
    return first.uppercased() + segment.dropFirst()
}
