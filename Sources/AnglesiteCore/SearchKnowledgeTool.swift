import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
import os

/// FoundationModels tool for retrieving ranked excerpts from the current site's local knowledge
/// index. Complements ``SearchContentTool``: content graph search finds known pages/posts by
/// metadata, while this searches file contents across pages, components, layouts, config, and copy.
public struct SearchKnowledgeTool: Tool, Sendable {
    /// The tool's stable name. Exposed statically so callers (e.g. `FoundationModelAssistant`'s
    /// `.started` event) can report the attached tools without constructing an instance.
    public static let toolName = "searchKnowledge"
    /// `Tool` conformance — always ``SearchKnowledgeTool/toolName``.
    public let name = SearchKnowledgeTool.toolName
    /// The tool card the model reads: nudges it to ground answers and edits in retrieved
    /// project context rather than guessing at file contents.
    public let description = "Search the current Astro project for relevant files and excerpts before answering or editing."

    /// The model-supplied search input.
    @Generable
    public struct Arguments {
        /// Free-text query matched against file *contents* (pages, components, layouts, config,
        /// copy) — metadata lookup by title/route/slug is ``SearchContentTool``'s job.
        @Guide(description: "Natural-language query or keywords to search for in the current project.")
        public var query: String
    }

    private static let log = Logger(subsystem: "io.dwk.anglesite", category: "SearchKnowledgeTool")

    private let index: SiteKnowledgeIndex
    private let siteID: String
    private let ranker: SemanticRanker?

    /// Binds the tool to one site's knowledge index. Pass a ``SemanticRanker`` to rerank the
    /// lexical candidate pool by blended lexical+semantic score; `nil` keeps pure lexical
    /// ranking (the tool degrades to that at call time anyway when the ranker has no vectors).
    public init(index: SiteKnowledgeIndex, siteID: String, ranker: SemanticRanker? = nil) {
        self.index = index
        self.siteID = siteID
        self.ranker = ranker
    }

    /// Returns up to six results, each a `KIND path:line - title` header plus a lexical excerpt.
    /// With a ranker, a wider lexical pool is reranked by ``SemanticRanker/blend(lexical:semantic:semanticWeight:)``
    /// so an on-topic-but-weak-keyword doc can surface — but a doc with zero lexical overlap
    /// never does, because this tool's contract is *cited* excerpts (see the body comment).
    public func call(arguments: Arguments) async throws -> String {
        let query = arguments.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return "Provide a project search query."
        }
        let resultLimit = 6
        // Pull a wider lexical candidate pool than we display, then semantically rerank *within
        // that pool*: a weak-keyword-but-on-topic doc ranked, say, #25 lexically can be lifted into
        // the visible 6. A doc with *zero* lexical overlap is deliberately NOT surfaced here —
        // results carry a lexical excerpt + line range, so synthesizing excerpt-less semantic-only
        // hits belongs to the Related-Pages panel (Plan B), not this cited-excerpt tool.
        let candidatePool = ranker == nil ? resultLimit : 30
        var results = await index.search(siteID: siteID, query: query, options: .init(limit: candidatePool))
        if let ranker, !results.isEmpty {
            // Score broadly, then keep only the lexical candidates' scores — no throwaway work on
            // semantic hits that can't be surfaced anyway.
            let semantic = await ranker.search(siteID: siteID, queryText: query, limit: 200)
            if semantic.isEmpty {
                // No on-device model, or nothing synced yet: degrade to lexical — but say so, since
                // silently dropping ranking quality would violate the project's "logs are sacred".
                Self.log.notice("semantic ranking returned no vectors; using lexical order")
            } else {
                let lexicalScores = Dictionary(results.map { ($0.document.id, $0.score) }, uniquingKeysWith: max)
                let semanticScores = semantic.reduce(into: [String: Double]()) { acc, ranked in
                    if lexicalScores[ranked.docID] != nil { acc[ranked.docID] = Double(ranked.score) }
                }
                let blended = SemanticRanker.blend(lexical: lexicalScores, semantic: semanticScores, semanticWeight: 0.6)
                results = results.sorted {
                    let lhs = blended[$0.document.id] ?? 0, rhs = blended[$1.document.id] ?? 0
                    return lhs != rhs ? lhs > rhs : $0.document.path < $1.document.path
                }
            }
        }
        results = Array(results.prefix(resultLimit))
        guard !results.isEmpty else { return "No matching project context." }

        return results.map { result in
            let lineLabel: String
            if let range = result.lineRange {
                lineLabel = ":\(range.lowerBound)"
            } else {
                lineLabel = ""
            }
            let title = result.document.title.map { " - \($0)" } ?? ""
            return """
            \(result.document.kind.rawValue.uppercased())  \(result.document.path)\(lineLabel)\(title)
            \(result.excerpt)
            """
        }.joined(separator: "\n\n")
    }
}
#endif
