import Testing
import Foundation
@testable import AnglesiteCore

/// Tests the deploy-orchestration business logic extracted from `DeployModel.runDeploy` (#825):
/// worker-activation planning, worker-name resolution precedence, provisioned-resource
/// persistence, and post-deploy webmention/POSSE sequencing — none of it previously had coverage
/// because it was trapped inside an app-target `@MainActor` view model that only a hosted
/// `xcodebuild test` can exercise, and that doesn't run on CI (see this repo's CLAUDE.md build
/// notes). Mirrors `TokenOnboardingTests`'s approach of driving the extracted type directly.
@Suite("DeployCoordinator")
struct DeployCoordinatorTests {
    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployCoordinatorTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func descriptor(
        id: String, group: String = "social", binding: WorkerDescriptor.Binding
    ) -> WorkerDescriptor {
        WorkerDescriptor(
            id: id, displayName: id, description: "d", group: group, binding: binding,
            resources: .init(needsD1: false, needsKV: false, needsR2: false)
        )
    }

    // MARK: - planWorkerActivation

    @Test("a headless/unpopulated content graph contributes no component-tied workers, but settings-activated ones still apply")
    func planWorkerActivationWithoutPopulatedGraph() async throws {
        let catalog = [
            descriptor(id: "webmention", binding: .componentTied(componentIDs: ["webmention-form"])),
            descriptor(id: "indieauth", binding: .settingsActivated)
        ]
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])
        let dir = try temporaryDirectory()
        let contentGraph = SiteContentGraph()

        let plan = await DeployCoordinator.planWorkerActivation(
            siteID: "site-1", siteDirectory: dir, settings: settings, catalog: catalog, contentGraph: contentGraph
        )

        #expect(plan.effectiveActiveIDs == ["indieauth"])
        #expect(plan.workers.map(\.id) == ["indieauth"])
        #expect(plan.unresolvedIDs.isEmpty)
    }

    @Test("a populated content graph activates a component-tied worker whose component a page imports")
    func planWorkerActivationWithPopulatedGraph() async throws {
        // `SiteGraphExplorer.build` ids a discovered component file as "<siteID>:file:<relative
        // path>" (see its `kind(for:)`/`resolveImport` — anything under `src/components/` is a
        // `.component` node) — the catalog's componentIDs must match that scheme exactly.
        let componentID = "site-1:file:src/components/webmention-form.astro"
        let catalog = [descriptor(id: "webmention", binding: .componentTied(componentIDs: [componentID]))]
        let dir = try temporaryDirectory()
        let contentGraph = SiteContentGraph()
        let page = SiteContentGraph.Page(
            id: "site-1:page:/", siteID: "site-1", route: "/",
            filePath: "src/pages/index.astro", title: "Home", lastModified: .now
        )
        try FileManager.default.createDirectory(
            at: dir.appendingPathComponent("src/pages"), withIntermediateDirectories: true)
        try "import WebmentionForm from '../components/webmention-form.astro';\n".write(
            to: dir.appendingPathComponent("src/pages/index.astro"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(
            at: dir.appendingPathComponent("src/components"), withIntermediateDirectories: true)
        try "<div></div>\n".write(
            to: dir.appendingPathComponent("src/components/webmention-form.astro"), atomically: true, encoding: .utf8)
        await contentGraph.load(siteID: "site-1", pages: [page], posts: [], images: [])

        let plan = await DeployCoordinator.planWorkerActivation(
            siteID: "site-1", siteDirectory: dir, settings: SiteSettings(), catalog: catalog, contentGraph: contentGraph
        )

        #expect(plan.effectiveActiveIDs == ["webmention"])
    }

    @Test("an active id with no catalog entry resolves to an empty workers list and is reported as unresolved")
    func planWorkerActivationReportsUnresolvedIDs() async throws {
        // Empty catalog: `WorkerActivation.effectiveActiveIDs` trusts `activeWorkerIDs` verbatim
        // in this case (no successful fetch/cache — see its doc comment), so the id is still
        // "active" but has nothing to resolve a `WorkerDescriptor` against.
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])
        let dir = try temporaryDirectory()
        let contentGraph = SiteContentGraph()

        let plan = await DeployCoordinator.planWorkerActivation(
            siteID: "site-1", siteDirectory: dir, settings: settings, catalog: [], contentGraph: contentGraph
        )

        #expect(plan.effectiveActiveIDs == ["indieauth"])
        #expect(plan.workers.isEmpty)
        #expect(plan.unresolvedIDs == ["indieauth"])
    }

    @Test("removedIDs reports the last-deployed baseline minus the new effective set")
    func planWorkerActivationComputesRemovedIDs() async throws {
        let catalog = [descriptor(id: "indieauth", binding: .settingsActivated)]
        let settings = SiteSettings(activeWorkerIDs: [], lastDeployedWorkerIDs: ["indieauth", "websub"])
        let dir = try temporaryDirectory()
        let contentGraph = SiteContentGraph()

        let plan = await DeployCoordinator.planWorkerActivation(
            siteID: "site-1", siteDirectory: dir, settings: settings, catalog: catalog, contentGraph: contentGraph
        )

        #expect(plan.effectiveActiveIDs.isEmpty)
        #expect(plan.removedIDs == ["indieauth", "websub"])
    }

    // MARK: - resolveWorkerSiteName

    @Test("an established CF_PROJECT_NAME wins over the siteName/siteID derivation")
    func resolveWorkerSiteNamePrefersEstablishedName() throws {
        let dir = try temporaryDirectory()
        try "CF_PROJECT_NAME=already-taken-name\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let name = DeployCoordinator.resolveWorkerSiteName(siteDirectory: dir, siteID: "site-1", siteName: "My Cool Site")

        #expect(name == "already-taken-name")
    }

    @Test("with no established name, the site's display name is derived into a slug")
    func resolveWorkerSiteNameDerivesFromSiteName() throws {
        let dir = try temporaryDirectory()

        let name = DeployCoordinator.resolveWorkerSiteName(siteDirectory: dir, siteID: "site-1", siteName: "My Cool Site")

        #expect(name == SiteSlug.derive(from: "My Cool Site"))
    }

    @Test("with no established name and no siteName, the siteID is derived into a slug")
    func resolveWorkerSiteNameFallsBackToSiteID() throws {
        let dir = try temporaryDirectory()

        let name = DeployCoordinator.resolveWorkerSiteName(siteDirectory: dir, siteID: "site-1", siteName: nil)

        #expect(name == SiteSlug.derive(from: "site-1"))
    }

    // MARK: - resolveSiteURL

    @Test("resolveSiteURL prefers DOMAIN over everything else")
    func resolveSiteURLPrefersDomain() throws {
        let dir = try temporaryDirectory()
        try "DOMAIN=example.com\nSITE_URL=https://my-site.workers.dev\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveSiteURL(siteDirectory: dir) == "https://example.com")
    }

    @Test("resolveSiteURL falls back to the persisted SITE_URL when no custom domain is set")
    func resolveSiteURLFallsBackToSiteURL() throws {
        let dir = try temporaryDirectory()
        try "SITE_URL=https://my-site.workers.dev\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveSiteURL(siteDirectory: dir) == "https://my-site.workers.dev")
    }

    @Test("resolveSiteURL returns nil before any deploy has ever persisted a host")
    func resolveSiteURLNilBeforeFirstDeploy() throws {
        let dir = try temporaryDirectory()

        #expect(DeployCoordinator.resolveSiteURL(siteDirectory: dir) == nil)
    }

    // MARK: - persistProvisionedResources

    @Test("persists the sorted effective active set and the provisioned resources")
    func persistProvisionedResourcesWritesSettings() async throws {
        let dir = try temporaryDirectory()
        let configStore = SiteConfigStore(configDirectory: dir)
        let resources = WorkerComposition.ProvisionedResources(d1DatabaseID: "d1-1", kvNamespaceID: "kv-1", r2BucketName: nil)

        await DeployCoordinator.persistProvisionedResources(
            configStore: configStore,
            settings: SiteSettings(displayName: "Keep Me"),
            effectiveActiveIDs: ["websub", "indieauth"],
            resources: resources
        )

        let saved = try await configStore.load()
        #expect(saved.lastDeployedWorkerIDs == ["indieauth", "websub"])
        #expect(saved.provisionedWorkerResources == resources)
        // Unrelated fields on the passed-in settings are preserved, not clobbered.
        #expect(saved.displayName == "Keep Me")
    }

    // MARK: - runPostDeploySequencing

    /// Not an actor: `runPostDeploySequencing` calls `onMilestone` synchronously and awaits
    /// `sendWebmentions`/`syndicate` in sequence on the calling task, with no concurrent access —
    /// a plain recorder keeps the assertion a simple, unambiguous array equality instead of an
    /// actor hop whose Task-scheduling order isn't guaranteed to match call order.
    private final class CallRecorder: @unchecked Sendable {
        private(set) var calls: [String] = []
        func record(_ name: String) { calls.append(name) }
    }

    @Test("runs webmention-send, syndication, then subscriber notify in order, with a milestone immediately before each")
    func postDeploySequencingRunsInOrder() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { progress in recorder.record("milestone:\(progress.phase)") },
            sendWebmentions: { recorder.record("send") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") }
        )
        #expect(recorder.calls == [
            "milestone:webmentions", "send",
            "milestone:syndicating", "syndicate",
            "milestone:websubPing", "notify",
            "milestone:activityPubBackfill",
        ])
    }

    @Test("all passes still run even when the caller's onMilestone closure does nothing observable")
    func postDeploySequencingRunsBothPassesRegardless() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { _ in },
            sendWebmentions: { recorder.record("send") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") }
        )
        #expect(recorder.calls == ["send", "syndicate", "notify"])
    }

    @Test("notifySubscribers defaults to a no-op so callers without a hub change nothing")
    func postDeploySequencingDefaultsNotifyToNoOp() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { progress in recorder.record("milestone:\(progress.phase)") },
            sendWebmentions: { recorder.record("send") },
            syndicate: { recorder.record("syndicate") }
        )
        #expect(recorder.calls == [
            "milestone:webmentions", "send",
            "milestone:syndicating", "syndicate",
            "milestone:websubPing",
            "milestone:activityPubBackfill",
        ])
    }

    @Test("backfillActivityPubOutbox runs last, after webmention-send, syndication, and subscriber notify, with a milestone immediately before it")
    func postDeploySequencingRunsBackfillLast() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { progress in recorder.record("milestone:\(progress.phase)") },
            sendWebmentions: { recorder.record("send") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") },
            backfillActivityPubOutbox: { recorder.record("backfill") }
        )
        #expect(recorder.calls == [
            "milestone:webmentions", "send",
            "milestone:syndicating", "syndicate",
            "milestone:websubPing", "notify",
            "milestone:activityPubBackfill", "backfill",
        ])
    }

    @Test("backfillActivityPubOutbox defaults to a no-op, so existing call sites without it still compile and run")
    func postDeploySequencingDefaultsBackfillToNoOp() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { _ in },
            sendWebmentions: { recorder.record("send") },
            syndicate: { recorder.record("syndicate") }
        )
        #expect(recorder.calls == ["send", "syndicate"])
    }
}
