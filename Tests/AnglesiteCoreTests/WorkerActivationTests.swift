import Testing
import Foundation
@testable import AnglesiteCore

@Suite("WorkerActivation")
struct WorkerActivationTests {
    private func descriptor(
        id: String, group: String = "social", binding: WorkerDescriptor.Binding
    ) -> WorkerDescriptor {
        WorkerDescriptor(
            id: id, displayName: id, description: "d", group: group, binding: binding,
            resources: .init(needsD1: false, needsKV: false, needsR2: false)
        )
    }

    private func pageNode(id: String) -> SiteGraphNode {
        SiteGraphNode(id: id, kind: .page, title: id, detail: nil, filePath: nil, route: "/\(id)")
    }

    private func componentNode(id: String) -> SiteGraphNode {
        SiteGraphNode(id: id, kind: .component, title: id, detail: nil, filePath: nil, route: nil)
    }

    @Test("a component-tied worker is active when its component is used by a page")
    func componentTiedActiveWhenPageUsesIt() {
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        let graph = SiteGraphExplorerSnapshot(
            nodes: [pageNode(id: "page:home"), componentNode(id: "webmention-form")],
            edges: [SiteGraphEdge(sourceID: "page:home", targetID: "webmention-form", kind: .imports)]
        )
        let active = WorkerActivation.effectiveActiveIDs(settings: SiteSettings(), catalog: catalog, graph: graph)
        #expect(active == ["webmention"])
    }

    @Test("a component-tied worker is inactive when its component is unused")
    func componentTiedInactiveWhenUnused() {
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        let graph = SiteGraphExplorerSnapshot(
            nodes: [pageNode(id: "page:home"), componentNode(id: "webmention-form")],
            edges: []
        )
        let active = WorkerActivation.effectiveActiveIDs(settings: SiteSettings(), catalog: catalog, graph: graph)
        #expect(active.isEmpty)
    }

    @Test("a component-tied worker is inactive when the graph is nil (headless deploy)")
    func componentTiedInactiveWhenGraphIsNil() {
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        let active = WorkerActivation.effectiveActiveIDs(settings: SiteSettings(), catalog: catalog, graph: nil)
        #expect(active.isEmpty)
    }

    @Test("a component used only by another (page-unreachable) component does not count")
    func componentTiedRequiresAffectedPageNotJustAnyDependent() {
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        // "wrapper" imports "webmention-form", but nothing imports "wrapper" — no page is affected.
        let graph = SiteGraphExplorerSnapshot(
            nodes: [componentNode(id: "wrapper"), componentNode(id: "webmention-form")],
            edges: [SiteGraphEdge(sourceID: "wrapper", targetID: "webmention-form", kind: .imports)]
        )
        let active = WorkerActivation.effectiveActiveIDs(settings: SiteSettings(), catalog: catalog, graph: graph)
        #expect(active.isEmpty)
    }

    @Test("a settings-activated worker is active when its id is in activeWorkerIDs")
    func settingsActivatedFromSettings() {
        let catalog = [descriptor(id: "solid-pod", group: "storage", binding: .settingsActivated)]
        let settings = SiteSettings(activeWorkerIDs: ["solid-pod"])
        let active = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: nil)
        #expect(active == ["solid-pod"])
    }

    @Test("a stale activeWorkerIDs entry no longer in the catalog is dropped")
    func staleActiveIDDropped() {
        let catalog = [descriptor(id: "solid-pod", group: "storage", binding: .settingsActivated)]
        let settings = SiteSettings(activeWorkerIDs: ["solid-pod", "retired-worker"])
        let active = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: nil)
        #expect(active == ["solid-pod"])
    }

    @Test("an activeWorkerIDs entry for a componentTied catalog id does not activate it directly")
    func activeWorkerIDsIgnoredForComponentTiedEntries() {
        // Defensive: activeWorkerIDs should only ever contain settingsActivated ids in practice,
        // but a componentTied id ending up there (e.g. stale data) must not bypass usage detection.
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        let settings = SiteSettings(activeWorkerIDs: ["webmention"])
        let active = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: catalog, graph: nil)
        #expect(active.isEmpty)
    }

    @Test("an empty catalog trusts activeWorkerIDs verbatim rather than deactivating everything")
    func emptyCatalogTrustsActiveWorkerIDs() {
        let settings = SiteSettings(activeWorkerIDs: ["solid-pod", "webdav"])
        let active = WorkerActivation.effectiveActiveIDs(settings: settings, catalog: [], graph: nil)
        #expect(active == ["solid-pod", "webdav"])
    }

    @Test("removedIDs is the previous set minus the next set")
    func removedIDsIsSetDifference() {
        let removed = WorkerActivation.removedIDs(previous: ["webmention", "indieauth"], next: ["indieauth"])
        #expect(removed == ["webmention"])
        #expect(WorkerActivation.removedIDs(previous: ["a"], next: ["a", "b"]).isEmpty)
    }

    @Test("activeDescriptors resolves known ids against the catalog")
    func activeDescriptorsKnownIDs() {
        let webmention = descriptor(id: "webmention", binding: .settingsActivated)
        let indieauth = descriptor(id: "indieauth", binding: .settingsActivated)
        let resolved = WorkerActivation.activeDescriptors(
            catalog: [webmention, indieauth], activeIDs: ["indieauth", "webmention"])
        #expect(Set(resolved.map(\.id)) == ["indieauth", "webmention"])
    }

    @Test("activeDescriptors drops ids with no matching catalog entry")
    func activeDescriptorsDropsUnknownIDs() {
        let indieauth = descriptor(id: "indieauth", binding: .settingsActivated)
        let resolved = WorkerActivation.activeDescriptors(
            catalog: [indieauth], activeIDs: ["indieauth", "solid-pod"])
        #expect(resolved.map(\.id) == ["indieauth"])
    }

    @Test("activeDescriptors of an empty id set is empty")
    func activeDescriptorsEmpty() {
        let indieauth = descriptor(id: "indieauth", binding: .settingsActivated)
        #expect(WorkerActivation.activeDescriptors(catalog: [indieauth], activeIDs: []).isEmpty)
    }

    @Test("unresolvedActiveIDs is empty when every active id resolved")
    func unresolvedActiveIDsEmptyWhenFullyResolved() {
        let indieauth = descriptor(id: "indieauth", binding: .settingsActivated)
        let unresolved = WorkerActivation.unresolvedActiveIDs(activeIDs: ["indieauth"], resolved: [indieauth])
        #expect(unresolved.isEmpty)
    }

    @Test("unresolvedActiveIDs catches a fully-empty catalog")
    func unresolvedActiveIDsFullyEmptyCatalog() {
        let unresolved = WorkerActivation.unresolvedActiveIDs(activeIDs: ["indieauth", "webmention"], resolved: [])
        #expect(unresolved == ["indieauth", "webmention"])
    }

    @Test("unresolvedActiveIDs catches a partial mismatch, not just a fully-empty catalog")
    func unresolvedActiveIDsPartialMismatch() {
        let indieauth = descriptor(id: "indieauth", binding: .settingsActivated)
        // "webmention" is active but has no catalog entry — the catalog isn't empty, so a
        // catalog.isEmpty check alone would miss this.
        let unresolved = WorkerActivation.unresolvedActiveIDs(
            activeIDs: ["indieauth", "webmention"], resolved: [indieauth])
        #expect(unresolved == ["webmention"])
    }

    @Test("missingDescriptorWarning is nil when nothing is unresolved")
    func missingDescriptorWarningNilWhenResolved() {
        #expect(WorkerActivation.missingDescriptorWarning(unresolvedIDs: []) == nil)
    }

    @Test("missingDescriptorWarning names every unresolved id, sorted")
    func missingDescriptorWarningNamesUnresolvedIDs() {
        let warning = WorkerActivation.missingDescriptorWarning(unresolvedIDs: ["webmention", "indieauth"])
        #expect(warning?.contains("indieauth, webmention") == true)
    }

    @Test("conformanceAdvisory reports blocked packages for an active phase-gated worker")
    func advisoryReportsBlockedPackages() {
        let status = try! WorkersConformanceReader.parse("""
        { "packages": { "@dwk/webmention": { "standard": "Webmention", "suites": {}, "integration": { "status": "pending" } } } }
        """.data(using: .utf8)!)
        let advisory = WorkerActivation.conformanceAdvisory(activeIDs: ["webmention"], conformance: status)
        #expect(advisory != nil)
        #expect(advisory!.contains("@dwk/webmention"))
    }

    @Test("conformanceAdvisory is nil when nothing phase-gated is active")
    func advisoryNilWithoutRelevantWorkers() {
        let status = WorkersConformanceStatus(packages: [:])
        #expect(WorkerActivation.conformanceAdvisory(activeIDs: ["solid-pod"], conformance: status) == nil)
    }

    @Test("componentNodeIDs resolves a catalog componentID to a real prefixed component node by filename stem")
    func componentNodeIDsResolvesRealGraphNode() {
        let snapshot = SiteGraphExplorerSnapshot(
            nodes: [
                SiteGraphNode(
                    id: "site1:file:src/components/WebmentionForm.astro", kind: .component,
                    title: "WebmentionForm.astro", detail: nil,
                    filePath: "src/components/WebmentionForm.astro", route: nil),
                SiteGraphNode(
                    id: "site1:file:src/components/Nav.astro", kind: .component,
                    title: "Nav.astro", detail: nil,
                    filePath: "src/components/Nav.astro", route: nil),
                SiteGraphNode(
                    id: "site1:page:index", kind: .page, title: "Home", detail: nil,
                    filePath: "src/pages/index.astro", route: "/"),
            ],
            edges: [])

        #expect(WorkerActivation.componentNodeIDs(for: "webmention-form", in: snapshot)
            == ["site1:file:src/components/WebmentionForm.astro"])
        // Exact-id matching still works (unprefixed fixture graphs, existing tests).
        #expect(WorkerActivation.componentNodeIDs(for: "site1:page:index", in: snapshot)
            == ["site1:page:index"])
        #expect(WorkerActivation.componentNodeIDs(for: "no-such-component", in: snapshot).isEmpty)
    }

    @Test("componentTied activates through a stem-resolved node with an affected page")
    func componentTiedActivatesThroughResolvedNode() {
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"]))]
        let snapshot = SiteGraphExplorerSnapshot(
            nodes: [
                SiteGraphNode(
                    id: "site1:file:src/components/WebmentionForm.astro", kind: .component,
                    title: "WebmentionForm.astro", detail: nil,
                    filePath: "src/components/WebmentionForm.astro", route: nil),
                SiteGraphNode(
                    id: "site1:page:index", kind: .page, title: "Home", detail: nil,
                    filePath: "src/pages/index.astro", route: "/"),
            ],
            edges: [
                SiteGraphEdge(
                    sourceID: "site1:page:index",
                    targetID: "site1:file:src/components/WebmentionForm.astro",
                    kind: .imports)
            ])

        let active = WorkerActivation.effectiveActiveIDs(
            settings: SiteSettings(), catalog: catalog, graph: snapshot)
        #expect(active == ["webmention"])
    }

    @Test("activating a worker with requires also activates the required id")
    func requiresResolvesTransitively() {
        let indieauth = WorkerDescriptor(
            id: "indieauth", displayName: "IndieAuth", description: "test fixture", group: "identity",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: false))
        let micropub = WorkerDescriptor(
            id: "micropub", displayName: "Micropub", description: "test fixture", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: true),
            requires: ["indieauth"])
        var settings = SiteSettings()
        settings.activeWorkerIDs = ["micropub"]

        let active = WorkerActivation.effectiveActiveIDs(
            settings: settings, catalog: [indieauth, micropub], graph: nil)

        #expect(active == ["micropub", "indieauth"])
    }

    @Test("a required id not present in the catalog is silently dropped, not invented")
    func requiresIgnoresUnknownID() {
        let micropub = WorkerDescriptor(
            id: "micropub", displayName: "Micropub", description: "test fixture", group: "publishing",
            binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: true),
            requires: ["indieauth"])
        var settings = SiteSettings()
        settings.activeWorkerIDs = ["micropub"]

        let active = WorkerActivation.effectiveActiveIDs(
            settings: settings, catalog: [micropub], graph: nil)

        #expect(active == ["micropub"])
    }

    @Test("a requires cycle terminates instead of looping forever")
    func requiresCycleTerminates() {
        let a = WorkerDescriptor(
            id: "a", displayName: "A", description: "test fixture", group: "test",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false),
            requires: ["b"])
        let b = WorkerDescriptor(
            id: "b", displayName: "B", description: "test fixture", group: "test",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false),
            requires: ["a"])
        var settings = SiteSettings()
        settings.activeWorkerIDs = ["a"]

        let active = WorkerActivation.effectiveActiveIDs(
            settings: settings, catalog: [a, b], graph: nil)

        #expect(active == ["a", "b"])
    }
}
