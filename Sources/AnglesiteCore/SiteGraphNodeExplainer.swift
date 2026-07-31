import Foundation

/// AI explanation of a Site Graph node (#614): turns the deterministic facts the explorer already
/// computes — the node's identity, its direct neighbors, and its `ImpactAnalysis.Report` — into a
/// short plain-language summary of the node's role on the site.
///
/// Per the LLM policy (#459), this is on-device-only: the default backend is Apple's
/// FoundationModels via `FoundationModelAssistant`, there is no network fallback, and hosts
/// without a usable model surface ``AssistantError/unavailable(_:)`` instead of degrading to a
/// cloud call.
public protocol SiteGraphNodeExplaining: Sendable {
    /// Streams the explanation text for a prompt built by ``SiteGraphExplainPrompt``. Throws
    /// ``AssistantError/unavailable(_:)`` before the stream opens when the on-device model can't
    /// run on this host.
    func explain(prompt: String, siteID: String, siteDirectory: URL) async throws -> AsyncThrowingStream<String, Error>
}

/// Chooses the node explainer for the current toolchain. Non-gated so `SiteGraphExplorerModel`
/// can default its dependency without importing FoundationModels; `nil` on toolchains without
/// FoundationModels means "no backend exists" (hide the feature), distinct from the runtime
/// ``AssistantError/unavailable(_:)`` ("backend exists, Apple Intelligence is off").
public enum SiteGraphExplainerFactory {
    /// `FoundationModelSiteGraphExplainer` on a FoundationModels-capable toolchain, `nil`
    /// otherwise. Callers treat `nil` as "hide the Explain button entirely" — see the enum doc
    /// for how that differs from the runtime unavailable error.
    public static func makeDefault() -> (any SiteGraphNodeExplaining)? {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return FoundationModelSiteGraphExplainer()
        #else
        return nil
        #endif
    }
}

/// Deterministic grounding-prompt builder for ``SiteGraphNodeExplaining``. The model is given
/// only facts the explorer already computed — never asked to guess about the site — so the
/// explanation can't outrun the graph's own accuracy.
public enum SiteGraphExplainPrompt {
    /// Cap per impact group so a site-wide component (used by hundreds of pages) can't flood the
    /// on-device model's small context window; the remainder is summarized as "and N more".
    public static let maxListedNames = 12

    static func facts(
        node: SiteGraphNode,
        impact: ImpactAnalysis.Report,
        dependsOn: [SiteGraphNode],
        referencedBy: [SiteGraphNode]
    ) -> [String] {
        // A neighbor reachable through several edge kinds (e.g. both `imports` and `usesLayout`)
        // arrives once per edge — list it once, or the capped fact list fills with duplicates.
        let uniqueDependsOn = deduplicated(dependsOn)
        let uniqueReferencedBy = deduplicated(referencedBy)
        var facts: [String] = []
        facts.append("- This file: \(node.title) (a \(kindLabel(node.kind)) on the site)")
        if let route = node.route { facts.append("- Its page address: \(route)") }
        if let filePath = node.filePath { facts.append("- Its source file: \(filePath)") }
        if !uniqueDependsOn.isEmpty {
            facts.append("- Depends on: \(nameList(uniqueDependsOn, withKinds: true))")
        }
        if !uniqueReferencedBy.isEmpty {
            facts.append("- Referenced by: \(nameList(uniqueReferencedBy, withKinds: true))")
        }
        facts.append(contentsOf: impactFacts(impact))
        return facts
    }

    /// The complete explain prompt: a non-developer-audience instruction preamble wrapping the
    /// deterministic fact list for `node`. Instructs the model to synthesize (not restate) the
    /// facts and to invent nothing beyond them — the grounding contract described on the enum.
    ///
    /// - Parameters:
    ///   - node: The node being explained.
    ///   - impact: The node's precomputed ``ImpactAnalysis/Report``; its groups become the
    ///     "editing it would affect …" facts.
    ///   - dependsOn: The node's one-hop outgoing neighbors (deduplicated internally — a
    ///     neighbor reachable via several edge kinds is listed once).
    ///   - referencedBy: The node's one-hop incoming neighbors, deduplicated the same way.
    public static func prompt(
        node: SiteGraphNode,
        impact: ImpactAnalysis.Report,
        dependsOn: [SiteGraphNode],
        referencedBy: [SiteGraphNode]
    ) -> String {
        let factLines = facts(node: node, impact: impact, dependsOn: dependsOn, referencedBy: referencedBy)
        return """
        You are explaining one file in a static website's dependency graph to the site's owner, \
        who is not a developer. Using only the facts below, write a short plain-language \
        explanation (2 to 4 sentences) of this file's role on the site and what editing it would \
        affect. Do not invent details that are not in the facts, and do not repeat the facts as a \
        list — synthesize them.

        Facts:
        \(factLines.joined(separator: "\n"))
        """
    }

    private static func impactFacts(_ impact: ImpactAnalysis.Report) -> [String] {
        var facts: [String] = []
        appendGroup(&facts, impact.affectedPages, "Editing it would affect", "page")
        appendGroup(&facts, impact.affectedEntries, "Editing it would affect", "content entry", plural: "content entries")
        appendGroup(&facts, impact.affectedCollections, "It belongs to", "collection")
        appendGroup(&facts, impact.dependentLayouts, "It is used by", "layout")
        appendGroup(&facts, impact.dependentComponents, "It is used by", "component")
        appendGroup(&facts, impact.dependentStyles, "It is used by", "stylesheet")
        appendGroup(&facts, impact.referencedAssets, "It references", "asset")
        if facts.isEmpty {
            facts.append("- Nothing else on the site depends on this file.")
        }
        return facts
    }

    private static func appendGroup(
        _ facts: inout [String],
        _ nodes: [SiteGraphNode],
        _ verb: String,
        _ singular: String,
        plural: String? = nil
    ) {
        guard !nodes.isEmpty else { return }
        let noun = nodes.count == 1 ? singular : (plural ?? singular + "s")
        facts.append("- \(verb) \(nodes.count) \(noun): \(nameList(nodes, withKinds: false))")
    }

    private static func deduplicated(_ nodes: [SiteGraphNode]) -> [SiteGraphNode] {
        var seen = Set<String>()
        return nodes.filter { seen.insert($0.id).inserted }
    }

    private static func nameList(_ nodes: [SiteGraphNode], withKinds: Bool) -> String {
        let listed = nodes.prefix(maxListedNames).map {
            withKinds ? "\($0.title) (\(kindLabel($0.kind)))" : $0.title
        }
        let overflow = nodes.count - maxListedNames
        return listed.joined(separator: ", ") + (overflow > 0 ? ", and \(overflow) more" : "")
    }

    private static func kindLabel(_ kind: SiteGraphNodeKind) -> String {
        switch kind {
        case .page: return "page"
        case .layout: return "layout"
        case .component: return "component"
        case .collection: return "collection"
        case .contentEntry: return "content entry"
        case .asset: return "asset"
        case .style: return "stylesheet"
        }
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
// See FoundationModelAssistant.swift for the pattern.
#if compiler(>=6.4) && canImport(FoundationModels)
/// On-device explainer: streams ``FoundationModelAssistant``'s one-shot `generate` output. A host
/// without Apple Intelligence throws ``AssistantError/unavailable(_:)`` from `generate` before
/// the stream opens — surfaced by the UI as its "unavailable" state, never a cloud fallback.
public struct FoundationModelSiteGraphExplainer: SiteGraphNodeExplaining {
    /// Stateless — each `explain` call builds its own ``FoundationModelAssistant``, so there is
    /// nothing to configure here.
    public init() {}

    /// Streams an on-device (`.onDevice` tier, never Private Cloud Compute) explanation for a
    /// prompt built by ``SiteGraphExplainPrompt``. `siteID`/`siteDirectory` only populate the
    /// ``AssistantContext``; the prompt already carries every fact the model may use.
    public func explain(prompt: String, siteID: String, siteDirectory: URL) async throws -> AsyncThrowingStream<String, Error> {
        try await FoundationModelAssistant(tier: .onDevice).generate(
            prompt: prompt,
            context: AssistantContext(siteID: siteID, siteDirectory: siteDirectory)
        )
    }
}
#endif
