import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
import os

/// Foundation Models tool that suggests internal pages to link to from a given page. Uses
/// semantic similarity (``SemanticRanker/related(siteID:toDocID:limit:)``) filtered by existing links (``LinkGraph``).
public struct SuggestLinksTool: Tool, Sendable {
    /// Stable tool identifier, exposed as a static so callers (transcript inspection, tool
    /// gating) can reference it without constructing an instance.
    public static let toolName = "suggestLinks"
    /// `Tool` conformance: the name the model calls this tool by.
    public let name = SuggestLinksTool.toolName
    /// `Tool` conformance: tells the model when to invoke this tool — the trigger phrasing
    /// ("improving internal linking or related content") is model-facing prompt text, not UI copy.
    public let description = "Suggest internal pages to link to from a given page. Use when the user asks about improving internal linking or related content."

    /// The model-generated arguments for one call; the `@Guide` description steers the model
    /// toward the site-relative path form the knowledge index keys documents by.
    @Generable
    public struct Arguments {
        /// Relative file path of the page to suggest links for (e.g. `src/pages/about.astro`).
        @Guide(description: "The relative file path of the page to suggest links for, e.g. 'src/pages/about.astro'.")
        public var path: String
    }

    private static let log = Logger(subsystem: "io.dwk.anglesite", category: "SuggestLinksTool")

    private let index: SiteKnowledgeIndex
    private let siteID: String
    private let ranker: SemanticRanker?

    /// Creates the tool for one site. `ranker` is optional because the on-device embedding model
    /// may be unavailable (device eligibility, model download state) — without it the tool
    /// degrades to an honest "unavailable" reply rather than guessing at relevance.
    public init(index: SiteKnowledgeIndex, siteID: String, ranker: SemanticRanker? = nil) {
        self.index = index
        self.siteID = siteID
        self.ranker = ranker
    }

    /// `Tool` conformance: resolves the page, ranks semantically related documents, filters out
    /// pages already linked (via `LinkGraph`), and returns a numbered Markdown list. Always
    /// returns model-readable prose — bad input (empty/unknown path) or a missing ranker is
    /// reported as a plain sentence the model can relay, never thrown.
    public func call(arguments: Arguments) async throws -> String {
        let path = arguments.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return "Provide a file path (e.g. src/pages/about.astro)." }

        let documents = await index.documents(siteID: siteID)
        let docID = SiteKnowledgeIndex.documentID(siteID: siteID, relativePath: path)

        guard documents.contains(where: { $0.path == path }) else {
            return "No indexed document at '\(path)'."
        }

        let related: [SemanticRanker.Ranked]
        if let ranker {
            related = await ranker.related(siteID: siteID, toDocID: docID, limit: 20)
        } else {
            Self.log.notice("no semantic ranker available; suggest_links cannot rank")
            return "Semantic ranking is unavailable — link suggestions require the on-device embedding model."
        }

        let suggestions = LinkGraph.suggestLinks(
            forDocumentAt: path,
            in: documents,
            rankedRelated: related,
            limit: 8
        )

        guard !suggestions.isEmpty else {
            return "No new internal link suggestions for '\(path)' — it already links to all semantically related pages."
        }

        var lines = ["Suggested internal links for \(path):"]
        for (i, s) in suggestions.enumerated() {
            let title = s.title ?? s.path
            let pct = Int(s.confidence * 100)
            lines.append("\(i + 1). [\(title)](\(s.route)) — \(pct)% relevance")
        }
        return lines.joined(separator: "\n")
    }
}
#endif
