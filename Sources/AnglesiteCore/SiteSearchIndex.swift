import Foundation

/// Computes a UI-navigable route for a `SiteKnowledgeIndex.Document`, when one exists. Pure and
/// stateless — no I/O, no dependency on `SiteKnowledgeIndex` itself, so it's testable directly
/// against arbitrary (kind, path, frontmatter) inputs.
enum ContentRouteResolver {
    static func route(
        kind: SiteKnowledgeIndex.Document.Kind,
        path: String,
        frontmatter: [String: FrontmatterValue]
    ) -> String? {
        switch kind {
        case .page:
            // Dynamic route templates (`[slug]`, `[...rest]`) aren't a single navigable route —
            // `ContentScanner.scanPages` skips these entirely when building `SiteContentGraph`;
            // mirror that here rather than emitting a route with a literal `[...slug]` segment.
            guard !path.contains("[") else { return nil }
            return ContentScanner.routeFromPagePath(path)
        case .post, .content:
            return collectionEntryRoute(path: path, frontmatter: frontmatter)
        case .layout, .config, .style, .script, .component, .other:
            return nil
        }
    }

    /// `src/content/{collection}/{entry}` → `/{collection}/{slug}`, matching the shipped
    /// template's `[collection]/[...slug].astro` catch-all route. `nil` when `path` isn't at
    /// least two segments under `src/content/` (no collection folder to anchor the route on).
    ///
    /// Note: This route is a convention-based best-effort guess. It is valid only when the
    /// collection is actually served by a route in the site's `src/pages/` (e.g., via
    /// `[collection]/[...slug].astro` or a dedicated route like `blog/[...slug].astro`). Not
    /// every `src/content/` collection is necessarily routed — for example, a collection with
    /// no matching page template. A non-nil route is therefore not a guarantee the URL resolves.
    /// Callers should be prepared to fall back gracefully (e.g., open the file, or verify
    /// before navigating) rather than assume every non-nil route is navigable.
    private static func collectionEntryRoute(
        path: String, frontmatter: [String: FrontmatterValue]
    ) -> String? {
        let prefix = "src/content/"
        guard path.hasPrefix(prefix) else { return nil }
        let rest = path.dropFirst(prefix.count)
        let segments = rest.split(separator: "/")
        guard segments.count >= 2, let filename = segments.last else { return nil }
        let collection = segments[0]
        if case let .string(slug)? = frontmatter["slug"], !slug.isEmpty {
            return "/\(collection)/\(slug)"
        }
        let slug = URL(fileURLWithPath: String(filename)).deletingPathExtension().lastPathComponent
        return "/\(collection)/\(slug)"
    }
}

/// UI-facing search over a site's `SiteKnowledgeIndex`, shaped for toolbar-style consumers
/// (#765/#520): ranked hits with kind, title, a navigable route where one exists, and match
/// context. Wraps `SiteKnowledgeIndex.search()` as-is — same lexical ranking, no semantic
/// reranking — since a toolbar search field wants fast literal matching, not RAG recall. Holds
/// no state of its own: every call reads the live index, so results always reflect whatever the
/// file-watcher pipeline (`KnowledgeReindex`) has most recently applied.
public enum SiteSearchIndex {
    public struct Hit: Sendable, Equatable, Identifiable {
        public let id: String
        public let kind: SiteKnowledgeIndex.Document.Kind
        public let title: String?
        public let route: String?
        public let path: String
        public let matchContext: String
        public let score: Double
    }

    /// The hit a submitted search query refers to, or `nil` when the query is blank or nothing
    /// matched.
    ///
    /// Selecting a suggestion row sets the field to that hit's `path` and submits, so an exact
    /// path match means the user picked that row. Anything else is typed text committed with
    /// Return, which activates the top-ranked hit — the only sensible destination when there is
    /// no results pane behind the field.
    public static func hit(forSubmittedQuery query: String, in hits: [Hit]) -> Hit? {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return hits.first { $0.path == query } ?? hits.first
    }

    /// Searches the index for documents matching the query.
    /// - Parameter limit: Maximum number of results to return. Clamped to a minimum of 1 by
    ///   the underlying `SiteKnowledgeIndex.SearchOptions`, so `limit: 0` still returns one hit.
    public static func search(
        _ index: SiteKnowledgeIndex,
        siteID: String,
        query: String,
        limit: Int = 8,
        kinds: Set<SiteKnowledgeIndex.Document.Kind>? = nil
    ) async -> [Hit] {
        let results = await index.search(
            siteID: siteID, query: query, options: .init(limit: limit, kinds: kinds))
        return results.map { result in
            Hit(
                id: result.id,
                kind: result.document.kind,
                title: result.document.title,
                route: ContentRouteResolver.route(
                    kind: result.document.kind,
                    path: result.document.path,
                    frontmatter: result.document.frontmatter
                ),
                path: result.document.path,
                matchContext: result.excerpt,
                score: result.score
            )
        }
    }
}
