import Foundation

/// Reports whether a site's content is loaded into the in-memory graph (the data Siri's
/// search/status intents read). Empty is a warning, not a failure — the user just needs to
/// open the site.
public struct ContentGraphProbe: ReadinessProbe {
    /// Stable probe id, echoed into the finding.
    public let id = "site.graph"
    /// User-facing check title, carried into every finding this probe returns.
    public let title = "Site content index"
    private let siteID: String
    private let graph: SiteContentGraph

    /// Creates the probe for one site's slice of the shared content graph.
    public init(siteID: String, graph: SiteContentGraph) {
        self.siteID = siteID
        self.graph = graph
    }

    /// Counts the site's pages, posts, and images in the graph. Any content at all is ok;
    /// an empty result warns with "open the site" remediation, because the graph is only
    /// populated when a site window opens — emptiness here usually means "not scanned yet",
    /// not "the site has no content".
    public func check() async -> ReadinessFinding {
        let pages = await graph.pages(for: siteID).count
        let posts = await graph.posts(for: siteID).count
        let images = await graph.images(for: siteID).count
        if pages + posts + images > 0 {
            return ReadinessFinding(id: id, title: title, level: .ok,
                detail: "\(pages) pages, \(posts) posts, \(images) images are loaded for Siri to search.")
        }
        return ReadinessFinding(id: id, title: title, level: .warning,
            detail: "No content is loaded for this site yet.",
            remediation: "Open this site's window so Anglesite can index its content.")
    }
}
