import Foundation

/// What the unified inspector shows for a selected directory/collection sidebar row (#714 §6) —
/// assembled by the site window from the navigator node, the content graph, the feed probe, and
/// the content-type registry. Read-mostly v1: pure display data, no write-back.
public struct CollectionInspection: Sendable, Equatable {
    public let title: String
    public let route: String
    /// The `src/content` collection name; nil for a plain nested page folder.
    public let collection: String?
    /// Entries in the collection (graph posts), or child pages for a plain folder.
    public let entryCount: Int
    public let feeds: [SiteFileTree.DetectedFeed]
    /// Registered content type's `displayName` (e.g. "Notes"); nil when unregistered.
    public let contentTypeName: String?
    /// Root microformats2 class the type projects (e.g. "h-entry") — the template's static
    /// dispatch picks the matching layout, so this names the template in use.
    public let microformat: String?
    /// Whether the site ships `src/pages/sitemap.xml.ts` (`SiteFileTree.hasSitemap`). Site-wide
    /// state, not per-collection — probed and surfaced here anyway (same as every other row)
    /// because the inspector's collection context is the only place this reads today; a directory
    /// selection doesn't imply anything about the sitemap specifically.
    public let sitemapConfigured: Bool

    public init(
        title: String, route: String, collection: String?, entryCount: Int,
        feeds: [SiteFileTree.DetectedFeed], contentTypeName: String?, microformat: String?,
        sitemapConfigured: Bool
    ) {
        self.title = title
        self.route = route
        self.collection = collection
        self.entryCount = entryCount
        self.feeds = feeds
        self.contentTypeName = contentTypeName
        self.microformat = microformat
        self.sitemapConfigured = sitemapConfigured
    }
}
