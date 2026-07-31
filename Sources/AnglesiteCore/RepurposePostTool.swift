import Foundation

/// Pure chat rendering of repurposed variants, non-gated for CI tests.
public enum RepurposeReply {
    /// Prepended to the reply when the site has no configured domain — links would be wrong.
    public static let missingDomainWarning = "Note: this site has no domain configured, so links below use example.com — set your domain before posting."

    /// Renders the variants as one copy-pasteable chat reply. Per-platform failures are shown
    /// inline rather than dropped, and the framing reiterates that Anglesite never posts on the
    /// owner's behalf — publishing stays a human act (the POSSE model, #465).
    public static func text(postTitle: String, variants: [PlatformPostVariant]) -> String {
        var lines = ["Platform posts for \"\(postTitle)\" — copy-paste what you like (Anglesite never posts for you):", ""]
        for v in variants {
            if let text = v.text {
                lines.append("\(v.platform):")
                lines.append(text)
            } else {
                lines.append("\(v.platform): \(v.failure ?? "unavailable")")
            }
            lines.append("")
        }
        lines.append("After you publish, tell me the published URLs and I'll record them on the post with saveSyndication.")
        return lines.joined(separator: "\n")
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Chat front-door for repurposing one post into per-platform variants (#465).
public struct RepurposePostTool: Tool, Sendable {
    /// Stable wire name, kept as a static so registration/telemetry sites can reference it
    /// without constructing the tool.
    public static let toolName = "repurposePost"
    /// `Tool` conformance: the name the model calls this tool by.
    public let name = RepurposePostTool.toolName
    /// `Tool` conformance: model-facing usage guidance. The "do not search first" instruction
    /// exists because models otherwise chain a content search before calling, and a stale/empty
    /// search result talks them out of a call that would have succeeded.
    public let description = "Turn one published blog post into ready-to-paste social posts for each platform (Instagram, Facebook, Google Business, Nextdoor, X, Bluesky), respecting each platform's length rules. If the user gives you a slug, call this directly with it — do not search for the post first; this tool reads the post from disk and will find it even if a prior search came back empty."

    /// Model-generated arguments; the `@Guide` text is what steers the model, this is just its shape.
    @Generable
    public struct Arguments {
        /// The post's content-collection slug (filename without extension).
        @Guide(description: "The post's slug, e.g. 'coast-trip' for src/content/posts/coast-trip.mdoc.")
        public var slug: String
    }

    private let repurposer: any PostRepurposing
    private let conventionsStore: ProjectConventionsStore?
    private let siteID: String
    private let siteDirectory: URL

    /// Creates the tool. `repurposer` is a protocol seam so tests exercise the tool without
    /// on-device inference; `conventionsStore` is optional because a site may not have learned
    /// conventions yet — the brand-voice preamble degrades to defaults rather than blocking.
    public init(repurposer: any PostRepurposing, conventionsStore: ProjectConventionsStore?,
                siteID: String, siteDirectory: URL) {
        self.repurposer = repurposer
        self.conventionsStore = conventionsStore
        self.siteID = siteID
        self.siteDirectory = siteDirectory
    }

    /// Loads the post from disk, resolves the site's domain from `.site-config`, and renders
    /// every platform variant as one copy-pasteable reply. With no domain configured, links fall
    /// back to example.com behind an explicit warning — never silently wrong URLs. Failures are
    /// conversational strings, not thrown errors: a throw would surface to the model, not the
    /// owner.
    public func call(arguments: Arguments) async throws -> String {
        guard let post = PostSource.load(slug: arguments.slug, sourceDirectory: siteDirectory) else {
            return "I couldn't find a post with the slug \"\(arguments.slug)\"."
        }
        let configURL = siteDirectory.appendingPathComponent(".site-config")
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let domain = WebsiteAnalyticsAsset.bestHost(from: config, fallback: "")
        let postURL = PostSource.postURL(
            domain: domain.isEmpty ? "example.com" : domain,
            collection: post.collection, slug: post.slug)
        let conventions = await conventionsStore?.load()
        let preamble = BrandVoiceGuidance.preamble(
            conventions: conventions, businessType: SiteBusinessType.read(sourceDirectory: siteDirectory))
        let variants = await repurposer.variants(
            post: post, postURL: postURL, specs: RepurposePlatformSpecs.all,
            preamble: preamble, siteID: siteID, siteDirectory: siteDirectory)
        let reply = RepurposeReply.text(postTitle: post.title, variants: variants)
        return domain.isEmpty ? RepurposeReply.missingDomainWarning + "\n\n" + reply : reply
    }
}

/// Deterministic POSSE write-back (#465): records published-copy URLs into the post's
/// `syndication:` frontmatter. No FM involved.
public struct SaveSyndicationTool: Tool, Sendable {
    /// Stable wire name, kept as a static so registration/telemetry sites can reference it
    /// without constructing the tool.
    public static let toolName = "saveSyndication"
    /// `Tool` conformance: the name the model calls this tool by.
    public let name = SaveSyndicationTool.toolName
    /// `Tool` conformance: model-facing usage guidance. "Call after the owner has posted" is
    /// load-bearing — publishing itself stays a human act (the POSSE model, #465); this tool
    /// only records the trail.
    public let description = "Record the published social-post URLs on a blog post's syndication list (POSSE trail). Call after the owner has posted and shared the URLs."

    /// Model-generated arguments; the `@Guide` text is what steers the model, this is just
    /// its shape.
    @Generable
    public struct Arguments {
        /// The post's content-collection slug (filename without extension).
        @Guide(description: "The post's slug.")
        public var slug: String
        /// The published URLs, comma-separated; split leniently on the model's behalf via
        /// `BrandVoiceInterview.list`.
        @Guide(description: "The published URLs, comma-separated.")
        public var urls: String
    }

    private let siteDirectory: URL
    /// Creates the tool for one site's `Source/` tree.
    public init(siteDirectory: URL) { self.siteDirectory = siteDirectory }

    /// Appends the URLs to the post's `syndication:` frontmatter on disk (via
    /// `SyndicationFrontmatter.adding`). Replies — including failures — are conversational
    /// strings rather than thrown errors, because they reach the owner through the model.
    public func call(arguments: Arguments) async throws -> String {
        guard let post = PostSource.load(slug: arguments.slug, sourceDirectory: siteDirectory) else {
            return "I couldn't find a post with the slug \"\(arguments.slug)\"."
        }
        let urls = BrandVoiceInterview.list(arguments.urls)
        guard !urls.isEmpty else { return "I need at least one published URL." }
        let fileURL = siteDirectory.appendingPathComponent(post.filePath)
        do {
            let contents = try String(contentsOf: fileURL, encoding: .utf8)
            try SyndicationFrontmatter.adding(urls: urls, to: contents)
                .write(to: fileURL, atomically: true, encoding: .utf8)
            return "Recorded \(urls.count) syndication URL\(urls.count == 1 ? "" : "s") on \"\(post.title)\"."
        } catch {
            return "Couldn't update the post: \(error.localizedDescription)"
        }
    }
}
#endif
