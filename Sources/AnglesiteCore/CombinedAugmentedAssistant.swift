import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
#endif

/// Combines graph-structure grounding (``SiteGraphAugmentedAssistant``) and content-search
/// grounding (``KnowledgeAugmentedAssistant``) into a single enrichment pass, both run against
/// the same, untouched user prompt (#314).
///
/// Nesting the two decorators (each rewriting `prompt` and forwarding to the next) was the
/// original approach and was rejected: the inner decorator's retrieval search then runs against
/// the OUTER decorator's already-enriched prompt — a blob of instructions and fact lines, not
/// the user's actual question — degrading exactly the citations this feature is meant to
/// produce. Running both retrievals here, against the same original `prompt`, avoids that.
public actor CombinedAugmentedAssistant: ConversationalAssistant {
    private let base: any ConversationalAssistant
    private let index: SiteKnowledgeIndex
    private let graphSnapshotProvider: @Sendable () async -> SiteGraphExplorerSnapshot

    /// Wraps `base` with combined graph + content-search enrichment.
    ///
    /// - Parameters:
    ///   - base: The assistant that actually talks to the model; this decorator only rewrites the
    ///     prompt it forwards.
    ///   - index: Content-search index queried per turn for the knowledge block.
    ///   - graphSnapshotProvider: Async closure (not a captured snapshot) so each turn reads the
    ///     *current* site graph — the graph changes as the user edits.
    public init(
        base: any ConversationalAssistant,
        index: SiteKnowledgeIndex,
        graphSnapshotProvider: @escaping @Sendable () async -> SiteGraphExplorerSnapshot
    ) {
        self.base = base
        self.index = index
        self.graphSnapshotProvider = graphSnapshotProvider
    }

    /// Pass-through to `base` — prompt enrichment adds no capability of its own, so advertising
    /// anything beyond the wrapped backend's surface would mislead routing.
    public nonisolated var capabilities: AssistantCapabilities {
        base.capabilities
    }

    /// Runs both retrievals against the untouched `prompt`, then forwards the enriched prompt to
    /// `base`. When retrieval found anything, the returned stream is re-wrapped to yield one
    /// leading `AssistantEvent.citations` event before the base events, so the chat panel can
    /// show citation chips for the turn; with no hits, the base stream is returned as-is.
    public func converse(prompt: String, context: AssistantContext) async throws -> AsyncStream<AssistantEvent> {
        let (enriched, citations) = await enrichedContext(prompt, context: context)
        let baseStream = try await base.converse(prompt: enriched, context: context)
        guard !citations.isEmpty else { return baseStream }
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

    /// Same enrichment as ``converse(prompt:context:)``, but the citations are discarded — the
    /// plain-text stream has no event channel to carry them.
    public func generate(prompt: String, context: AssistantContext) async throws -> AsyncThrowingStream<String, Error> {
        let (enriched, _) = await enrichedContext(prompt, context: context)
        return try await base.generate(prompt: enriched, context: context)
    }

    #if compiler(>=6.4) && canImport(FoundationModels)
    /// Enriches the prompt exactly like the streaming paths before delegating the guided
    /// generation (`Generable`) call to `base` — structured output benefits from the same
    /// grounding, it just has nowhere to surface citations.
    public func generateStructured<T: Generable & Sendable>(
        prompt: String,
        context: AssistantContext,
        resultType: T.Type
    ) async throws -> T {
        let (enriched, _) = await enrichedContext(prompt, context: context)
        return try await base.generateStructured(prompt: enriched, context: context, resultType: resultType)
    }
    #endif

    /// Forwards to `base` — the decorator holds no in-flight work of its own to cancel (its
    /// retrieval awaits complete before the base call starts).
    public func cancel() async {
        await base.cancel()
    }

    /// Forwards to `base`; enrichment is stateless per turn, so only the wrapped backend has
    /// session state to reset.
    public func resetSession() async {
        await base.resetSession()
    }

    private func enrichedContext(_ prompt: String, context: AssistantContext) async -> (prompt: String, citations: [RetrievedCitation]) {
        // The graph snapshot read and the content-index search are independent — only
        // `graphBlock`'s synchronous computation actually depends on the snapshot — so run both
        // `await`s concurrently instead of paying their latencies back-to-back on every turn.
        async let snapshotTask = graphSnapshotProvider()
        async let contentTask = KnowledgeAugmentedAssistant.contentBlock(prompt: prompt, context: context, index: index)
        let snapshot = await snapshotTask
        let graph = SiteGraphAugmentedAssistant.graphBlock(prompt: prompt, snapshot: snapshot)
        let content = await contentTask

        var blocks: [String] = []
        var citations: [RetrievedCitation] = []
        if let graph {
            blocks.append(graph.block)
            citations.append(contentsOf: graph.citations)
        }
        if let content {
            blocks.append(content.block)
            // A file that's both a matched graph node and a content-search hit is cited once —
            // the graph citation (added first, above) already covers it and carries the more
            // specific `SiteGraphNodeKind`-derived kind mapping.
            let citedPaths = Set(citations.map(\.path))
            citations.append(contentsOf: content.citations.filter { !citedPaths.contains($0.path) })
        }
        guard !blocks.isEmpty else { return (prompt, []) }

        let enriched = """
        \(blocks.joined(separator: "\n\n"))

        User request:
        \(prompt)
        """
        return (enriched, citations)
    }
}
