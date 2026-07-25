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
