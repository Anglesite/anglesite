import Foundation

/// Computes which `@dwk/workers` catalog workers are active for a site right now, and diffs
/// that against the last-deployed set. Pure — no I/O, no actor isolation — so every input
/// (settings, catalog, graph snapshot) must be gathered by the caller first (#709 design §4).
public enum WorkerActivation {
    /// The effective active worker-id set: component-tied workers with at least one
    /// `ImpactAnalysis`-affected page, unioned with settings-activated workers the user toggled
    /// on. `graph` is `nil` for a headless deploy with no populated `SiteContentGraph` — in that
    /// case component-tied workers contribute nothing (`ImpactAnalysis` "never invents, may
    /// under-report" bias), while `activeWorkerIDs` still applies. If `catalog` is empty (no
    /// successful fetch, no cache — `WorkerCatalogFetcher` already degrades to cache on failure,
    /// so this is a fresh-install-with-no-network edge case), `activeWorkerIDs` is trusted
    /// verbatim instead of being intersected away, so a transient fetch failure can't silently
    /// deactivate every settings-activated worker.
    public static func effectiveActiveIDs(
        settings: SiteSettings,
        catalog: [WorkerDescriptor],
        graph: SiteGraphExplorerSnapshot?
    ) -> Set<String> {
        var active: Set<String> = []

        if let graph {
            for descriptor in catalog {
                guard case .componentTied(let componentIDs) = descriptor.binding else { continue }
                let isUsed = componentIDs.contains { componentID in
                    componentNodeIDs(for: componentID, in: graph).contains { nodeID in
                        guard let report = ImpactAnalysis.analyze(snapshot: graph, targetID: nodeID) else {
                            return false
                        }
                        return !report.affectedPages.isEmpty
                    }
                }
                if isUsed { active.insert(descriptor.id) }
            }
        }

        let requested = Set(settings.activeWorkerIDs ?? [])
        if catalog.isEmpty {
            active.formUnion(requested)
        } else {
            let settingsActivatedIDs = Set(catalog.compactMap { descriptor -> String? in
                guard case .settingsActivated = descriptor.binding else { return nil }
                return descriptor.id
            })
            active.formUnion(requested.intersection(settingsActivatedIDs))
        }

        // Resolve `requires` to a fixed point: an active descriptor's required ids become active
        // too, which may in turn have their own `requires`. `visited` guards a future catalog
        // entry with a `requires` cycle from looping forever — today's catalog has none, this is
        // defense-in-depth, not a currently-reachable case. An id a descriptor `requires` but
        // that isn't in `catalog` is silently dropped, matching this function's existing "never
        // invents" posture for component-tied workers.
        let byID = Dictionary(uniqueKeysWithValues: catalog.map { ($0.id, $0) })
        var visited: Set<String> = []
        var frontier = active
        while !frontier.isEmpty {
            var next: Set<String> = []
            for id in frontier {
                guard visited.insert(id).inserted, let descriptor = byID[id] else { continue }
                for required in descriptor.requires ?? [] where byID[required] != nil {
                    next.insert(required)
                }
            }
            active.formUnion(next)
            frontier = next.subtracting(visited)
        }

        return active
    }

    /// Graph node IDs matching one catalog `componentID`. Catalog componentIDs are logical,
    /// cross-site identifiers ("webmention-form"); real Site Graph node IDs are site-scoped file
    /// paths ("<siteID>:file:src/components/WebmentionForm.astro" — `SiteGraphExplorer.build`),
    /// so the two can never be compared directly. The coordinated convention (workers-repo
    /// spec/catalog.md: componentID values are "coordinated with the app, not invented here"): a
    /// componentID matches a `.component` node whose file basename stem equals it after
    /// normalization (lowercased, non-alphanumerics stripped) — plus exact node-id equality,
    /// which keeps unprefixed fixture graphs and any future catalog that publishes full node IDs
    /// working.
    public static func componentNodeIDs(
        for componentID: String, in snapshot: SiteGraphExplorerSnapshot
    ) -> [String] {
        let target = normalizedComponentKey(componentID)
        return snapshot.nodes.filter { node in
            if node.id == componentID { return true }
            guard node.kind == .component, let filePath = node.filePath,
                  let basename = filePath.split(separator: "/").last else { return false }
            let stem = basename.split(separator: ".").first.map(String.init) ?? String(basename)
            return normalizedComponentKey(stem) == target
        }.map(\.id)
    }

    /// "WebmentionForm" and "webmention-form" both normalize to "webmentionform".
    private static func normalizedComponentKey(_ raw: String) -> String {
        String(raw.lowercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0)
        })
    }

    /// Worker ids present in `previous` but absent from `next` — used only to log what a deploy
    /// is tearing down (#709 design §7); the removal itself happens by omission from the newly
    /// generated `wrangler.toml`, not a separate API call.
    public static func removedIDs(previous: Set<String>, next: Set<String>) -> Set<String> {
        previous.subtracting(next)
    }

    /// The effective active worker set as full `WorkerDescriptor`s, resolved by id against
    /// `catalog` — what `WorkerComposition.generateWranglerToml` and
    /// `SocialWorkerProvisionCommand.provision` need now that composition is descriptor-driven
    /// (#708). An id present in `activeIDs` but absent from `catalog` (a stale id, or a catalog
    /// fetch that hasn't happened yet) is silently dropped — there is no descriptor data to
    /// compose it with. Mirrors `WorkerRouteClaims.activeClaims(catalog:activeIDs:)`'s shape.
    public static func activeDescriptors(catalog: [WorkerDescriptor], activeIDs: Set<String>) -> [WorkerDescriptor] {
        catalog.sorted(by: { $0.id < $1.id }).filter { activeIDs.contains($0.id) }
    }

    /// Active ids `activeDescriptors` couldn't resolve against the catalog — a fully-empty
    /// catalog (no fetch has ever succeeded) is the common case, but a *partial* catalog missing
    /// just one active id (a stale id, or an entry a newer `catalog.json` removed) hits this too.
    /// Both deploy paths (`DeployModel.runDeploy`, `SiteOperations.deployWithWorkerComposition`)
    /// check this — not just `catalog.isEmpty` — so a partial mismatch isn't silent either.
    public static func unresolvedActiveIDs(activeIDs: Set<String>, resolved: [WorkerDescriptor]) -> Set<String> {
        activeIDs.subtracting(Set(resolved.map(\.id)))
    }

    /// The shared debug-pane warning text for `unresolvedActiveIDs`, so the wording can't drift
    /// between `DeployModel.swift` and `SiteOperations.swift` the way it already had once (#708
    /// review feedback). `nil` when there's nothing to warn about.
    public static func missingDescriptorWarning(unresolvedIDs: Set<String>) -> String? {
        guard !unresolvedIDs.isEmpty else { return nil }
        return "no catalog entry for active worker(s) \(unresolvedIDs.sorted().joined(separator: ", ")) — deploying with no resource bindings or route claims for them; wrangler.toml composition will be incomplete until a catalog fetch resolves them"
    }

    /// Advisory-only (#359): reports which required `@dwk/*` packages for an active worker's
    /// gated phase aren't release-ready yet, per `WorkersConformanceStatus.gateStatus`. Never
    /// blocks activation or deploy — `conformance/status.json` reporting a package `"pending"`
    /// is expected during active development (verified live 2026-07-21: V-3's packages are all
    /// `"pending"` even though #887's webmention receiver already ships and works). This exists
    /// purely so the debug pane surfaces "you're running ahead of conformance certification"
    /// rather than the app silently having no opinion. `nil` when nothing to report.
    public static func conformanceAdvisory(
        activeIDs: Set<String>, conformance: WorkersConformanceStatus
    ) -> String? {
        var messages: [String] = []
        for phase in [WorkersConformanceStatus.Phase.v2, .v3, .v4] {
            let required = WorkersConformanceStatus.phaseRequirements[phase] ?? []
            // Only advise about a phase if one of its required packages corresponds to an
            // active worker id — npm package names are "@dwk/<id>", matching WorkerDescriptor.id.
            let relevantActive = required.contains { activeIDs.contains(String($0.dropFirst("@dwk/".count))) }
            guard relevantActive else { continue }
            let gate = conformance.gateStatus(for: phase)
            guard !gate.isUnblocked else { continue }
            messages.append("conformance: \(gate.blocked.joined(separator: ", ")) not yet release-ready for this phase")
        }
        return messages.isEmpty ? nil : messages.joined(separator: "; ")
    }
}
