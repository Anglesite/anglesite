import Foundation

/// What the unified inspector shows for a selected directory/collection sidebar row (#714 §6) —
/// assembled by the site window from the navigator node, the content graph, the feed probe, and
/// the content-type registry. Read-mostly v1: pure display data, no write-back.
public struct CollectionInspection: Sendable, Equatable {
    /// Display title for the inspector header — the sidebar row's label, not a slug.
    public let title: String
    /// The row's site route (e.g. `/posts`), shown so the owner can connect the sidebar
    /// grouping to the published URL.
    public let route: String
    /// The `src/content` collection name; nil for a plain nested page folder.
    public let collection: String?
    /// Entries in the collection (graph posts), or child pages for a plain folder.
    public let entryCount: Int
    /// Feeds the feed probe detected for this route (RSS/Atom/JSON), listed so the owner can see
    /// what's already syndicated without hunting through files.
    public let feeds: [SiteFileTree.DetectedFeed]
    /// Registered content type's `displayName` (e.g. "Notes"); nil when unregistered.
    public let contentTypeName: String?
    /// Root microformats2 class the type projects (e.g. "h-entry") — the template's static
    /// dispatch picks the matching layout, so this names the template in use.
    public let microformat: String?

    /// Memberwise initializer — the site window assembles this from its several sources
    /// (navigator node, content graph, feed probe, content-type registry); no single one of them
    /// could construct it alone.
    public init(
        title: String, route: String, collection: String?, entryCount: Int,
        feeds: [SiteFileTree.DetectedFeed], contentTypeName: String?, microformat: String?
    ) {
        self.title = title
        self.route = route
        self.collection = collection
        self.entryCount = entryCount
        self.feeds = feeds
        self.contentTypeName = contentTypeName
        self.microformat = microformat
    }
}
