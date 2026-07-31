import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// A FoundationModels `Tool` that lets the on-device model search the current site's pages and
/// posts (by title, route, slug, collection, or tag) via ``SiteContentGraph`` — local RAG with no
/// network call.
public struct SearchContentTool: Tool, Sendable {
    /// The tool's stable name. Exposed statically so callers (e.g. `FoundationModelAssistant`'s
    /// `.started` event) can report the attached tools without constructing an instance.
    public static let toolName = "searchContent"
    /// `Tool` conformance — always ``SearchContentTool/toolName``.
    public let name = SearchContentTool.toolName
    /// The tool card the model reads. Deliberately warns that this is a convenience lookup, not
    /// the source of truth: without that framing the model treats a search miss as proof the
    /// content doesn't exist and refuses to call slug/route-based tools it could have used
    /// directly.
    public let description = "Search the current site's pages and posts by title, route, slug, tag, or collection. This is a convenience lookup, not the source of truth: if you already know a post's slug or a page's route (e.g. the user stated it), call the tool for that slug/route directly instead of searching first — a search miss does not prove the content doesn't exist."

    /// The model-supplied search input.
    @Generable
    public struct Arguments {
        /// Free-text query matched against page/post metadata (title, route, slug, tag,
        /// collection) — not body text; that's `SearchKnowledgeTool`'s job.
        @Guide(description: "What to search for — words from a page title, route, post slug, tag, or collection.")
        public var query: String
    }

    /// Largest site without flooding the small on-device context window. Truncation is surfaced
    /// in the output trailer (never silent).
    private static let resultCap = 20

    private let contentGraph: SiteContentGraph
    private let siteID: String

    /// Binds the tool to one site's content graph; the model never supplies (and so can never
    /// misdirect) the site it searches.
    public init(contentGraph: SiteContentGraph, siteID: String) {
        self.contentGraph = contentGraph
        self.siteID = siteID
    }

    /// Runs the search and returns one `PAGE`/`POST` line per hit. Empty results distinguish an
    /// index that's loaded (miss is reliable) from one that isn't (miss proves nothing), so the
    /// model doesn't conclude content is missing just because indexing hasn't run. Output is
    /// capped via `fairBudget` with an explicit per-category truncation trailer — never silent.
    public func call(arguments: Arguments) async throws -> String {
        let query = arguments.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return "Provide a search term — a word from a page title, route, post slug, or tag."
        }
        let pages = await contentGraph.searchPages(siteID: siteID, matching: query).sorted { $0.route < $1.route }
        let posts = await contentGraph.searchPosts(siteID: siteID, matching: query).sorted { $0.slug < $1.slug }

        let pageLines = pages.map { "PAGE  \($0.route)  (\($0.filePath))" }
        let postLines = posts.map { post -> String in
            let draft = post.draft ? " [draft]" : ""
            return "POST  \(post.slug)\(draft)  (\(post.filePath))"
        }

        if pageLines.isEmpty && postLines.isEmpty {
            if await contentGraph.isPopulated(siteID: siteID) {
                return """
                    No matching pages or posts in the search index (the index is loaded and \
                    current, so this result is reliable). If you know the exact slug or route \
                    anyway, calling the relevant tool (e.g. repurposePost, reviewCopy) directly \
                    will still work — it doesn't depend on this index.
                    """
            }
            return """
                No matching pages or posts — but the search index for this site hasn't been \
                loaded yet, so this result is NOT reliable and does not mean the content \
                doesn't exist. If you know the exact slug or route, call the relevant tool \
                (e.g. repurposePost, reviewCopy) with it directly rather than concluding the \
                content is missing.
                """
        }

        // Budget the combined cap across both categories so a flood of one can't crowd the other
        // out of the results entirely (a model that only sees pages can't learn there were posts).
        let (pageTake, postTake) = Self.fairBudget(pages: pageLines.count, posts: postLines.count)
        var out = (pageLines.prefix(pageTake) + postLines.prefix(postTake)).joined(separator: "\n")

        // Surface truncation per-category so the model knows what kind of result it's missing.
        let hiddenPages = pageLines.count - pageTake
        let hiddenPosts = postLines.count - postTake
        var hidden: [String] = []
        if hiddenPages > 0 { hidden.append("+\(hiddenPages) more page\(hiddenPages == 1 ? "" : "s")") }
        if hiddenPosts > 0 { hidden.append("+\(hiddenPosts) more post\(hiddenPosts == 1 ? "" : "s")") }
        if !hidden.isEmpty {
            out += "\n… " + hidden.joined(separator: ", ") + " — refine your query to narrow results."
        }
        return out
    }

    /// Split ``resultCap`` between pages and posts so a flood of one category can't hide the other.
    /// Each category is guaranteed up to half the budget; whatever half a smaller category leaves
    /// unused is lent to the larger one. Returns how many of each to show.
    static func fairBudget(pages: Int, posts: Int) -> (pages: Int, posts: Int) {
        let cap = resultCap
        guard pages + posts > cap else { return (pages, posts) }
        let postFloor = min(posts, cap / 2)
        let pageTake = min(pages, cap - postFloor)
        let postTake = min(posts, cap - pageTake)
        return (pageTake, postTake)
    }
}
#endif
