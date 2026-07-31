import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
#endif

/// Free-form, cross-node grounding for the Chat panel (#314). Mirrors
/// ``KnowledgeAugmentedAssistant``'s content-search enrichment, but grounds on the Site Graph
/// Explorer's dependency graph and ``ImpactAnalysis`` instead of file text — the facts needed to
/// answer structural questions ("how is navigation generated", "why does this image appear
/// here") that a text search over file contents can't answer.
///
/// Reuses #614's per-node fact list (`SiteGraphExplainPrompt.facts(node:impact:dependsOn:referencedBy:)`)
/// for up to `SiteGraphAugmentedAssistant.maxSeedNodes` nodes matched against the question's
/// words. Contributes nothing when no node matches, so unrelated chat turns are unaffected.
public actor SiteGraphAugmentedAssistant: ConversationalAssistant {
    /// Largest number of matched nodes to ground a single question in — keeps the prompt within
    /// the small on-device context window, matching the philosophy of
    /// `SiteGraphExplainPrompt.maxListedNames`.
    static let maxSeedNodes = 3

    private let base: any ConversationalAssistant
    private let snapshotProvider: @Sendable () async -> SiteGraphExplorerSnapshot

    /// Wraps `base` with graph grounding.
    ///
    /// - Parameters:
    ///   - base: The assistant that actually answers; this decorator only rewrites its prompt
    ///     and prepends citations.
    ///   - snapshotProvider: Queried fresh on every turn (not captured once) so the grounding
    ///     always reflects the current graph, even as the explorer rebuilds it behind us.
    public init(
        base: any ConversationalAssistant,
        snapshotProvider: @escaping @Sendable () async -> SiteGraphExplorerSnapshot
    ) {
        self.base = base
        self.snapshotProvider = snapshotProvider
    }

    /// Passes through the wrapped assistant's capabilities unchanged — grounding rewrites
    /// prompts, it doesn't add or remove what the backend can do.
    public nonisolated var capabilities: AssistantCapabilities {
        base.capabilities
    }

    /// Streams the wrapped assistant's conversation over a graph-enriched prompt, prepending a
    /// single `.citations` event for the matched nodes' files. When no node matches the
    /// question, the base stream is returned untouched — unrelated chat turns pay nothing.
    public func converse(prompt: String, context: AssistantContext) async throws -> AsyncStream<AssistantEvent> {
        let (enriched, citations) = await enrichedContext(prompt)
        let baseStream = try await base.converse(prompt: enriched, context: context)
        guard !citations.isEmpty else { return baseStream }
        // Prepended ahead of whatever `base` itself yields. Note: the production chat path no
        // longer composes this decorator around `KnowledgeAugmentedAssistant` — it uses
        // `CombinedAugmentedAssistant`, which runs both retrievals against the same original
        // prompt and merges into a single `.citations` event (#314). This instance-level
        // `converse` stays correct for standalone use (as its own tests exercise it), but if you
        // do nest another decorator as `base` here, its citations still arrive as a second,
        // separate event — that combination is untested and not the shipped composition.
        return AsyncStream { continuation in
            let task = Task {
                continuation.yield(.citations(citations))
                for await event in baseStream {
                    continuation.yield(event)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// One-shot generation over the same graph-enriched prompt. Citations are discarded — the
    /// plain text stream has no event channel to carry them, and generate callers (e.g. inline
    /// rewrite) have no citations UI anyway.
    public func generate(prompt: String, context: AssistantContext) async throws -> AsyncThrowingStream<String, Error> {
        let (enriched, _) = await enrichedContext(prompt)
        return try await base.generate(prompt: enriched, context: context)
    }

    #if compiler(>=6.4) && canImport(FoundationModels)
    /// Structured generation over the graph-enriched prompt; the `Generable` decoding itself is
    /// entirely the wrapped assistant's job. Citations are discarded, as in `generate`.
    public func generateStructured<T: Generable & Sendable>(
        prompt: String,
        context: AssistantContext,
        resultType: T.Type
    ) async throws -> T {
        let (enriched, _) = await enrichedContext(prompt)
        return try await base.generateStructured(prompt: enriched, context: context, resultType: resultType)
    }
    #endif

    /// Forwards cancellation to the wrapped assistant — the decorator holds no in-flight work of
    /// its own (enrichment is synchronous once the snapshot arrives), so there is nothing else to
    /// stop.
    public func cancel() async {
        await base.cancel()
    }

    /// Forwards the session reset to the wrapped assistant. Grounding is recomputed per turn from
    /// `snapshotProvider`, so this decorator carries no session state of its own to clear.
    public func resetSession() async {
        await base.resetSession()
    }

    private func enrichedContext(_ prompt: String) async -> (prompt: String, citations: [RetrievedCitation]) {
        let snapshot = await snapshotProvider()
        guard let (block, citations) = Self.graphBlock(prompt: prompt, snapshot: snapshot) else {
            return (prompt, [])
        }
        let enriched = """
        \(block)

        User request:
        \(prompt)
        """
        return (enriched, citations)
    }

    /// Builds the graph-facts block and citations for `prompt` against `snapshot`, or `nil` when
    /// no node matches. Exposed (not `private`) so ``CombinedAugmentedAssistant`` can run this
    /// retrieval directly against the original user question instead of a prompt another
    /// decorator already rewrote (#314).
    static func graphBlock(
        prompt: String,
        snapshot: SiteGraphExplorerSnapshot
    ) -> (block: String, citations: [RetrievedCitation])? {
        let seeds = seedNodes(for: prompt, in: snapshot)
        guard !seeds.isEmpty else { return nil }

        var blocks: [String] = []
        var citations: [RetrievedCitation] = []
        // Two distinct seed nodes could in principle share a `filePath` (e.g. a future graph
        // builder change producing a duplicate node) — dedup here rather than assume the snapshot
        // never does, so one `.citations` event never lists the same file twice.
        var citedPaths: Set<String> = []
        for node in seeds {
            guard let impact = ImpactAnalysis.analyze(snapshot: snapshot, targetID: node.id) else { continue }
            let (dependsOn, referencedBy) = neighbors(of: node, in: snapshot)
            let facts = SiteGraphExplainPrompt.facts(node: node, impact: impact, dependsOn: dependsOn, referencedBy: referencedBy)
            blocks.append("Facts about \(node.title):\n" + facts.joined(separator: "\n"))
            if let citation = citation(for: node), citedPaths.insert(citation.path).inserted {
                citations.append(citation)
            }
        }
        guard !blocks.isEmpty else { return nil }

        let instructions = """
        You are answering a question about how this Astro website is built, using only the \
        facts below about specific files in its dependency graph. Do not invent details that \
        are not in the facts, and cite file paths when you use a fact.
        """
        return (instructions + "\n\n" + blocks.joined(separator: "\n\n"), citations)
    }

    /// Scores every node's title/route/filePath against the question's words (case-insensitive
    /// substring match, matching `SiteKnowledgeIndex`'s keyword-search style rather than
    /// embeddings), and returns the top ``maxSeedNodes`` by match count. Ties break by title
    /// (matching `ImpactAnalysis`'s stable sort), then id.
    static func seedNodes(for question: String, in snapshot: SiteGraphExplorerSnapshot) -> [SiteGraphNode] {
        let terms = queryTerms(question)
        guard !terms.isEmpty else { return [] }
        let scored: [(node: SiteGraphNode, score: Int)] = snapshot.nodes.compactMap { node in
            let score = matchScore(node: node, terms: terms)
            return score > 0 ? (node, score) : nil
        }
        return scored
            .sorted { lhs, rhs in
                if lhs.score != rhs.score { return lhs.score > rhs.score }
                let byTitle = lhs.node.title.localizedStandardCompare(rhs.node.title)
                if byTitle != .orderedSame { return byTitle == .orderedAscending }
                return lhs.node.id < rhs.node.id
            }
            .prefix(maxSeedNodes)
            .map(\.node)
    }

    /// Direct neighbors of `node` (one hop each direction), matching what #614's
    /// `SiteGraphExplorerModel.explainSelectedNode()` computes for the single-node case.
    static func neighbors(
        of node: SiteGraphNode,
        in snapshot: SiteGraphExplorerSnapshot
    ) -> (dependsOn: [SiteGraphNode], referencedBy: [SiteGraphNode]) {
        let nodesByID = Dictionary(snapshot.nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var dependsOn: [SiteGraphNode] = []
        var referencedBy: [SiteGraphNode] = []
        for edge in snapshot.edges {
            if edge.sourceID == node.id, let target = nodesByID[edge.targetID] { dependsOn.append(target) }
            if edge.targetID == node.id, let source = nodesByID[edge.sourceID] { referencedBy.append(source) }
        }
        return (dependsOn, referencedBy)
    }

    /// `nil` when the node has no file path (e.g. a `.collection` node, which represents a
    /// grouping rather than a single file) — it still grounds the answer via its facts block,
    /// but there is nothing sensible to cite or open.
    static func citation(for node: SiteGraphNode) -> RetrievedCitation? {
        guard let path = node.filePath else { return nil }
        return RetrievedCitation(
            id: node.id,
            path: path,
            kind: documentKind(for: node.kind),
            title: node.title,
            lineRange: nil,
            score: 1
        )
    }

    static func documentKind(for kind: SiteGraphNodeKind) -> SiteKnowledgeIndex.Document.Kind {
        switch kind {
        case .page: return .page
        case .layout: return .layout
        case .component: return .component
        case .collection, .contentEntry: return .content
        case .asset: return .other
        case .style: return .style
        }
    }

    private static func matchScore(node: SiteGraphNode, terms: [String]) -> Int {
        let haystack = [node.title, node.route, node.filePath]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        return terms.reduce(0) { count, term in haystack.contains(term) ? count + 1 : count }
    }

    /// Words of 3+ characters — short words ("is", "the", "of") match nearly every node and add
    /// noise rather than signal.
    private static func queryTerms(_ question: String) -> [String] {
        question
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 2 }
    }
}
