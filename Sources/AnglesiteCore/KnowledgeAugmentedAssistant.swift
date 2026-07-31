import Foundation

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels
#endif

/// Decorates any assistant backend with project-local retrieval context before each turn.
public actor KnowledgeAugmentedAssistant: ConversationalAssistant {
    private let base: any ConversationalAssistant
    private let index: SiteKnowledgeIndex

    /// Wraps `base` so every call is preceded by a retrieval pass against `index`.
    ///
    /// - Parameters:
    ///   - base: The backend all calls forward to after enrichment.
    ///   - index: The per-site retrieval index searched before each turn.
    public init(base: any ConversationalAssistant, index: SiteKnowledgeIndex) {
        self.base = base
        self.index = index
    }

    /// Forwards the base backend's capabilities unchanged — retrieval adds context to prompts,
    /// not abilities to the backend.
    public nonisolated var capabilities: AssistantCapabilities {
        base.capabilities
    }

    /// Streams a conversational turn with the prompt enriched by retrieved site context.
    ///
    /// When retrieval matched anything, a single ``AssistantEvent/citations(_:)`` event is
    /// prepended before the base backend's own events, so the chat panel can render source
    /// chips before the first token arrives. When nothing matched, the base stream is returned
    /// untouched — no relay task, no extra hop.
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

    /// Plain text generation with the same retrieval enrichment as
    /// ``KnowledgeAugmentedAssistant/converse(prompt:context:)``. Citations are computed and
    /// discarded: this stream carries only text chunks, with no event channel to surface them.
    public func generate(prompt: String, context: AssistantContext) async throws -> AsyncThrowingStream<String, Error> {
        let (enriched, _) = await enrichedContext(prompt, context: context)
        return try await base.generate(prompt: enriched, context: context)
    }

    #if compiler(>=6.4) && canImport(FoundationModels)
    /// Guided generation with the same retrieval enrichment as the other entry points.
    /// Gated with the rest of the FoundationModels surface (the `Generable` constraint only
    /// exists on the Xcode-27 toolchain), matching the gate on the `ContentAssistant`
    /// requirement it satisfies.
    public func generateStructured<T: Generable & Sendable>(
        prompt: String,
        context: AssistantContext,
        resultType: T.Type
    ) async throws -> T {
        let (enriched, _) = await enrichedContext(prompt, context: context)
        return try await base.generateStructured(
            prompt: enriched,
            context: context,
            resultType: resultType
        )
    }
    #endif

    /// Forwards cancellation to the base backend, which owns the live generation; the citation
    /// relay stream ends when the base stream does.
    public func cancel() async {
        await base.cancel()
    }

    /// Resets the base backend's session. Retrieval itself is stateless per turn, so there is
    /// nothing local to clear.
    public func resetSession() async {
        await base.resetSession()
    }

    private func enrichedContext(_ prompt: String, context: AssistantContext) async -> (prompt: String, citations: [RetrievedCitation]) {
        guard let (block, citations) = await Self.contentBlock(prompt: prompt, context: context, index: index) else {
            return (prompt, [])
        }
        let enriched = """
        \(block)

        User request:
        \(prompt)
        """
        return (enriched, citations)
    }

    /// Builds the content-search block and citations for `prompt`, or `nil` when nothing
    /// matches. Exposed (not `private`) so ``CombinedAugmentedAssistant`` can run this retrieval
    /// directly against the original user question instead of a prompt another decorator already
    /// rewrote (#314).
    static func contentBlock(
        prompt: String,
        context: AssistantContext,
        index: SiteKnowledgeIndex
    ) async -> (block: String, citations: [RetrievedCitation])? {
        let results = await index.search(
            siteID: context.siteID,
            query: prompt,
            options: context.searchOptions
        )
        guard !results.isEmpty else { return nil }
        return (formatContext(results), results.map(RetrievedCitation.init))
    }

    private static func formatContext(_ results: [SiteKnowledgeIndex.SearchResult]) -> String {
        var lines = [
            "Relevant project context retrieved from this Astro site:",
            "Use this context when it is relevant. Cite file paths when answering.",
        ]
        for result in results {
            let lineLabel = result.lineRange.map { range in
                range.lowerBound == range.upperBound
                    ? "line \(range.lowerBound)"
                    : "lines \(range.lowerBound)-\(range.upperBound)"
            } ?? "excerpt"
            let title = result.document.title.map { " - \($0)" } ?? ""
            lines.append("\n[\(result.document.path):\(lineLabel)]\(title)")
            lines.append(result.excerpt)
        }
        return lines.joined(separator: "\n")
    }
}
