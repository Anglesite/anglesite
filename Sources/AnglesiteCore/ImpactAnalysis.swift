import Foundation

/// Deterministic project impact analysis (#309) over a `SiteGraphExplorerSnapshot`.
///
/// Given a target node (component, layout, style, asset, page, or content entry), computes the
/// **transitive reverse closure** of the graph's dependency edges — `imports`, `usesLayout`, and
/// `referencesAsset`, each meaning "source depends on target" — to answer "what on this site
/// changes if I edit this file?" before the edit happens. `contains` edges (collection → entry)
/// are membership, not dependency: they never propagate impact, and are only used to map affected
/// entries back to the collections that include them.
///
/// Pure over an in-memory snapshot — no I/O, no model calls — so it is exactly as fresh (and
/// exactly as approximate) as `SiteGraphExplorer.build`'s regex-based extraction. Unresolved
/// references never appear in the snapshot at all, so this analysis inherits the graph's
/// under-reporting bias: it may miss an affected page, but never invents one.
public enum ImpactAnalysis {
    /// Everything affected by editing one target node, grouped by kind and sorted by title for
    /// stable presentation. All dependent groups are *transitive* (a page that reaches the target
    /// through two layers of components is still affected); `referencedAssets` is the one
    /// forward-looking group — the assets the target itself directly references.
    public struct Report: Sendable, Equatable {
        /// The analyzed node's id, echoed back so a report stays self-describing when it is
        /// passed around or cached apart from the request that produced it.
        public let targetID: String
        /// Pages whose rendered output could change.
        public let affectedPages: [SiteGraphNode]
        /// Content-collection entries whose rendered output could change.
        public let affectedEntries: [SiteGraphNode]
        /// Collections containing at least one affected entry (or the target itself, when the
        /// target is an entry).
        public let affectedCollections: [SiteGraphNode]
        /// Layouts that (transitively) depend on the target.
        public let dependentLayouts: [SiteGraphNode]
        /// Components that (transitively) depend on the target.
        public let dependentComponents: [SiteGraphNode]
        /// Stylesheets that (transitively) depend on the target.
        public let dependentStyles: [SiteGraphNode]
        /// Assets the target itself directly references.
        public let referencedAssets: [SiteGraphNode]

        /// True when anything on the site depends on the target — the "this edit has blast
        /// radius" signal.
        public var hasDependents: Bool {
            !affectedPages.isEmpty || !affectedEntries.isEmpty || !dependentLayouts.isEmpty
                || !dependentComponents.isEmpty || !dependentStyles.isEmpty
        }
    }

    /// Analyzes the impact of editing `targetID`. Returns `nil` when the snapshot has no such
    /// node. Cycle-safe: a visited set guarantees termination and counts each dependent once.
    public static func analyze(snapshot: SiteGraphExplorerSnapshot, targetID: String) -> Report? {
        var nodesByID: [String: SiteGraphNode] = [:]
        for node in snapshot.nodes { nodesByID[node.id] = node }
        guard nodesByID[targetID] != nil else { return nil }

        // Reverse adjacency over dependency edges only: dependents[X] = nodes that depend on X.
        var dependents: [String: [String]] = [:]
        for edge in snapshot.edges where edge.kind != .contains {
            dependents[edge.targetID, default: []].append(edge.sourceID)
        }

        // Iterative reverse reachability from the target. `popLast()` makes `frontier` a stack,
        // so this walks depth-first — traversal order is irrelevant to the output (the visited
        // set counts each dependent exactly once, and groups are title-sorted before returning).
        var visited: Set<String> = [targetID]
        var frontier = [targetID]
        var affected: [SiteGraphNode] = []
        while let current = frontier.popLast() {
            for dependentID in dependents[current] ?? [] where !visited.contains(dependentID) {
                visited.insert(dependentID)
                frontier.append(dependentID)
                if let node = nodesByID[dependentID] { affected.append(node) }
            }
        }

        var pages: [SiteGraphNode] = []
        var entries: [SiteGraphNode] = []
        var layouts: [SiteGraphNode] = []
        var components: [SiteGraphNode] = []
        var styles: [SiteGraphNode] = []
        for node in affected {
            switch node.kind {
            case .page: pages.append(node)
            case .contentEntry: entries.append(node)
            case .layout: layouts.append(node)
            case .component: components.append(node)
            case .style: styles.append(node)
            case .collection, .asset: break  // Neither can depend on anything (no outgoing deps).
            }
        }

        // Collections that include an affected entry — or the target itself when it is an entry,
        // so editing an entry still reports where it lives.
        var entryIDs = Set(entries.map(\.id))
        if nodesByID[targetID]?.kind == .contentEntry { entryIDs.insert(targetID) }
        var collectionIDs: Set<String> = []
        for edge in snapshot.edges
        where edge.kind == .contains && entryIDs.contains(edge.targetID) {
            collectionIDs.insert(edge.sourceID)
        }
        let collections = collectionIDs.compactMap { nodesByID[$0] }

        // Forward direct references from the target to assets ("References 12 images").
        var assetIDs: Set<String> = []
        for edge in snapshot.edges
        where edge.sourceID == targetID && nodesByID[edge.targetID]?.kind == .asset {
            assetIDs.insert(edge.targetID)
        }
        let assets = assetIDs.compactMap { nodesByID[$0] }

        return Report(
            targetID: targetID,
            affectedPages: sorted(pages),
            affectedEntries: sorted(entries),
            affectedCollections: sorted(collections),
            dependentLayouts: sorted(layouts),
            dependentComponents: sorted(components),
            dependentStyles: sorted(styles),
            referencedAssets: sorted(assets)
        )
    }

    /// Title-sorted (id tiebreak) for stable, deterministic presentation.
    private static func sorted(_ nodes: [SiteGraphNode]) -> [SiteGraphNode] {
        nodes.sorted {
            let byTitle = $0.title.localizedStandardCompare($1.title)
            if byTitle != .orderedSame { return byTitle == .orderedAscending }
            return $0.id < $1.id
        }
    }
}
