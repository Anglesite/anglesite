import Foundation

/// What selecting a navigator row does: navigate the preview to a route, open a file in the
/// editor, open a directory's settings, or open the site-wide Website Settings (#714).
public enum NavigatorTarget: Sendable, Equatable {
    /// Navigate the live preview to this route. Content pages and posts use this — selecting
    /// them shows the rendered page, not raw markdown; custom content editors hook this branch.
    case route(String)
    /// Open this file in the source editor. Reserved for files with no rendered form of their
    /// own: components, styles, and metadata.
    case file(FileRef)
    /// Open a content directory's settings. `collection` is the content-collection name when the
    /// directory is one (nil for plain directories); `route` is the listing route to preview.
    case directory(collection: String?, route: String)
    /// Open the site-wide Website Settings pane (#714) — the one target with no per-file subject.
    case websiteSettings
}

/// One selectable row in the navigator sidebar: a stable identity, a display title, and what
/// selecting it does. A plain value so the tree can be rebuilt wholesale on content changes
/// without SwiftUI losing row identity.
public struct NavigatorItem: Sendable, Equatable, Identifiable {
    /// Stable identifier used by SwiftUI to track the row across tree rebuilds.
    public let id: String
    /// The row's display title.
    public let title: String
    /// What selecting the row does — see ``NavigatorTarget``.
    public let target: NavigatorTarget
    /// Memberwise initializer.
    public init(id: String, title: String, target: NavigatorTarget) {
        self.id = id; self.title = title; self.target = target
    }
}

/// Derived preview route for a post. See the plan's documented assumption.
public func postRoute(for post: SiteContentGraph.Post) -> String {
    // Percent-encode each component: a collection/slug with spaces, Unicode, or reserved chars
    // would otherwise produce an invalid URL path and 404 silently in the preview.
    let collection = post.collection.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? post.collection
    let slug = post.slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? post.slug
    return "/\(collection)/\(slug)/"
}
