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

    // MARK: - deployLogSources

    @Test("deployLogSources includes worker-provision:<siteID> so SocialWorkerProvisionCommand's wrangler output reaches the drawer")
    func deployLogSourcesIncludesWorkerProvision() {
        let sources = DeployCoordinator.deployLogSources(siteID: "site-1")

        #expect(sources.contains("worker-provision:site-1"))
        #expect(sources.contains("deploy:site-1"))
        #expect(sources.contains("deploy:site-1:build"))
    }

    @Test("deployLogSources scopes each source to the given siteID, not a different one")
    func deployLogSourcesScopedToSiteID() {
        let sources = DeployCoordinator.deployLogSources(siteID: "site-1")

        #expect(!sources.contains("worker-provision:site-2"))
        #expect(!sources.contains("deploy:site-2"))
    }

    // MARK: - resolveSiteURL

    @Test("resolveSiteURL prefers the persisted SITE_URL over an unverified custom domain (#1085)")
    func resolveSiteURLPrefersSiteURLOverDomain() throws {
        let dir = try temporaryDirectory()
        try "DOMAIN=example.com\nSITE_URL=https://my-site.workers.dev\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveSiteURL(siteDirectory: dir) == "https://my-site.workers.dev")
    }

    @Test("resolveSiteURL falls back to DOMAIN before any deploy has ever persisted SITE_URL")
    func resolveSiteURLFallsBackToDomain() throws {
        let dir = try temporaryDirectory()
        try "DOMAIN=example.com\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveSiteURL(siteDirectory: dir) == "https://example.com")
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

    // MARK: - ActivityPub handle resolution (#1239)

    @Test("defaultActivityPubUsername strips a leading www. from the resolved site URL's host")
    func defaultActivityPubUsernameStripsWWW() throws {
        let dir = try temporaryDirectory()
        try "SITE_URL=https://www.example.com\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.defaultActivityPubUsername(siteDirectory: dir) == "example.com")
    }

    @Test("defaultActivityPubUsername is nil before any deploy has ever persisted a host")
    func defaultActivityPubUsernameNilBeforeFirstDeploy() throws {
        let dir = try temporaryDirectory()

        #expect(DeployCoordinator.defaultActivityPubUsername(siteDirectory: dir) == nil)
    }

    @Test("isValidActivityPubUsername accepts the RFC 7565 ∩ Mastodon grammar and rejects everything else")
    func isValidActivityPubUsernameGrammar() {
        for valid in ["example.com", "alice", "alice_bob", "a", "a.b-c_d9"] {
            #expect(DeployCoordinator.isValidActivityPubUsername(valid), "expected \(valid) to be valid")
        }
        for invalid in ["", "-alice", "alice-", ".alice", "alice.", "ali ce", "alice!", "@lice"] {
            #expect(!DeployCoordinator.isValidActivityPubUsername(invalid), "expected \(invalid) to be invalid")
        }
    }

    @Test("resolveEffectiveActivityPubUsername prefers a valid override over the hostname default")
    func resolveEffectiveActivityPubUsernamePrefersValidOverride() throws {
        let dir = try temporaryDirectory()
        try "SITE_URL=https://example.com\nAP_USERNAME=alice\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveEffectiveActivityPubUsername(siteDirectory: dir) == "alice")
    }

    @Test("resolveEffectiveActivityPubUsername lowercases a mixed-case override, matching worker.ts's case-insensitive grammar")
    func resolveEffectiveActivityPubUsernameLowercasesOverride() throws {
        let dir = try temporaryDirectory()
        try "SITE_URL=https://example.com\nAP_USERNAME=Alice\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveEffectiveActivityPubUsername(siteDirectory: dir) == "alice")
    }

    @Test("resolveEffectiveActivityPubUsername falls back to the hostname default when the override is invalid")
    func resolveEffectiveActivityPubUsernameFallsBackOnInvalidOverride() throws {
        let dir = try temporaryDirectory()
        try "SITE_URL=https://example.com\nAP_USERNAME=-not valid-\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveEffectiveActivityPubUsername(siteDirectory: dir) == "example.com")
    }

    @Test("resolveEffectiveActivityPubUsername falls back to the hostname default when no override is set")
    func resolveEffectiveActivityPubUsernameFallsBackWhenUnset() throws {
        let dir = try temporaryDirectory()
        try "SITE_URL=https://example.com\n".write(
            to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        #expect(DeployCoordinator.resolveEffectiveActivityPubUsername(siteDirectory: dir) == "example.com")
    }

    @Test("activityPubHandleRenameNeedsConfirmation is false when the actor isn't locked, even if the handle changed")
    func activityPubHandleRenameNeedsConfirmationFalseWhenUnlocked() {
        #expect(!DeployCoordinator.activityPubHandleRenameNeedsConfirmation(
            lastDeployedUsername: "site", resolvedUsername: "example.com", isLocked: false))
    }

    @Test("activityPubHandleRenameNeedsConfirmation is false on a first-ever deploy (no baseline yet)")
    func activityPubHandleRenameNeedsConfirmationFalseWithNoBaseline() {
        #expect(!DeployCoordinator.activityPubHandleRenameNeedsConfirmation(
            lastDeployedUsername: nil, resolvedUsername: "example.com", isLocked: true))
    }

    @Test("activityPubHandleRenameNeedsConfirmation is false when the handle hasn't actually changed")
    func activityPubHandleRenameNeedsConfirmationFalseWhenUnchanged() {
        #expect(!DeployCoordinator.activityPubHandleRenameNeedsConfirmation(
            lastDeployedUsername: "example.com", resolvedUsername: "example.com", isLocked: true))
    }

    @Test("activityPubHandleRenameNeedsConfirmation is true when a locked actor's resolved handle changed")
    func activityPubHandleRenameNeedsConfirmationTrueWhenLockedAndChanged() {
        #expect(DeployCoordinator.activityPubHandleRenameNeedsConfirmation(
            lastDeployedUsername: "site", resolvedUsername: "example.com", isLocked: true))
    }

    @Test("activityPubHandleRenameNeedsConfirmation is false once the owner has acknowledged switching to this exact handle")
    func activityPubHandleRenameNeedsConfirmationFalseWhenAcknowledged() {
        #expect(!DeployCoordinator.activityPubHandleRenameNeedsConfirmation(
            lastDeployedUsername: "site", resolvedUsername: "example.com", isLocked: true,
            acknowledgedUsername: "example.com"))
    }

    @Test("activityPubHandleRenameNeedsConfirmation is true again for a different handle even after an earlier one was acknowledged")
    func activityPubHandleRenameNeedsConfirmationTrueForADifferentHandleThanAcknowledged() {
        #expect(DeployCoordinator.activityPubHandleRenameNeedsConfirmation(
            lastDeployedUsername: "site", resolvedUsername: "bob.example.com", isLocked: true,
            acknowledgedUsername: "example.com"))
    }

    @Test("isActivityPubHandleLocked is true from a non-empty outbox ledger even with no resolvable site URL")
    func isActivityPubHandleLockedTrueFromLedgerWithNoSiteURL() async throws {
        let dir = try temporaryDirectory()
        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(canonicalURL: "https://example.com/posts/1", activityID: "https://example.com/activity/1", syncedAt: .now))
        try ledger.save(to: dir)

        let locked = await DeployCoordinator.isActivityPubHandleLocked(siteURL: nil, configDirectory: dir)

        #expect(locked)
    }

    @Test("isActivityPubHandleLocked is false when the outbox ledger is empty and there's no site URL to check followers")
    func isActivityPubHandleLockedFalseWithNoLedgerAndNoSiteURL() async throws {
        let dir = try temporaryDirectory()

        let locked = await DeployCoordinator.isActivityPubHandleLocked(siteURL: nil, configDirectory: dir)

        #expect(!locked)
    }

    @Test("persistProvisionedResources advances the ActivityPub handle baseline when a handle is supplied")
    func persistProvisionedResourcesAdvancesAPUsernameBaseline() async throws {
        let dir = try temporaryDirectory()
        let configStore = SiteConfigStore(configDirectory: dir)
        let resources = WorkerComposition.ProvisionedResources()

        await DeployCoordinator.persistProvisionedResources(
            configStore: configStore,
            settings: SiteSettings(),
            effectiveActiveIDs: [],
            resources: resources,
            apUsername: "example.com"
        )

        let saved = try await configStore.load()
        #expect(saved.lastDeployedAPUsername == "example.com")
    }

    @Test("persistProvisionedResources leaves the ActivityPub handle baseline unchanged when no handle is supplied")
    func persistProvisionedResourcesLeavesAPUsernameBaselineUnchangedWhenNil() async throws {
        let dir = try temporaryDirectory()
        let configStore = SiteConfigStore(configDirectory: dir)
        let resources = WorkerComposition.ProvisionedResources()

        await DeployCoordinator.persistProvisionedResources(
            configStore: configStore,
            settings: SiteSettings(lastDeployedAPUsername: "example.com"),
            effectiveActiveIDs: [],
            resources: resources
        )

        let saved = try await configStore.load()
        #expect(saved.lastDeployedAPUsername == "example.com")
    }

    // MARK: - resolveActiveWorkerIDs (#1172)

    @Test("with no anglesite.json, falls back to Config/'s activeWorkerIDs")
    func resolveActiveWorkerIDsFallsBackWhenFileAbsent() throws {
        let dir = try temporaryDirectory()
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])

        let resolved = DeployCoordinator.resolveActiveWorkerIDs(settings: settings, sourceDirectory: dir)

        #expect(resolved.ids == ["indieauth"])
        #expect(resolved.source == .configFallback(reason: .notDeclared))
    }

    @Test("with anglesite.json present but no workers section, falls back to Config/")
    func resolveActiveWorkerIDsFallsBackWhenWorkersNotDeclared() throws {
        let dir = try temporaryDirectory()
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(hostname: "example.com")))
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])

        let resolved = DeployCoordinator.resolveActiveWorkerIDs(settings: settings, sourceDirectory: dir)

        #expect(resolved.ids == ["indieauth"])
        #expect(resolved.source == .configFallback(reason: .notDeclared))
    }

    @Test("with anglesite.json unparsable, falls back to Config/")
    func resolveActiveWorkerIDsFallsBackWhenUnparsable() throws {
        let dir = try temporaryDirectory()
        try "not json".write(to: dir.appendingPathComponent("anglesite.json"), atomically: true, encoding: .utf8)
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])

        let resolved = DeployCoordinator.resolveActiveWorkerIDs(settings: settings, sourceDirectory: dir)

        #expect(resolved.ids == ["indieauth"])
        #expect(resolved.source == .configFallback(reason: .unparsable))
    }

    @Test("with a declared set in sync with Config/'s recorded migration snapshot, the declaration wins")
    func resolveActiveWorkerIDsUsesDeclaredWhenInSync() throws {
        let dir = try temporaryDirectory()
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(workers: .init(active: ["websub"])))
        let settings = SiteSettings(activeWorkerIDs: ["websub"], activeWorkerIDsMigratedToAnglesiteJSON: ["websub"])

        let resolved = DeployCoordinator.resolveActiveWorkerIDs(settings: settings, sourceDirectory: dir)

        #expect(resolved.ids == ["websub"])
        #expect(resolved.source == .declared)
    }

    @Test("with Config/'s activeWorkerIDs changed since the last successful sync, falls back to Config/ as stale")
    func resolveActiveWorkerIDsFallsBackWhenStaleRelativeToConfig() throws {
        let dir = try temporaryDirectory()
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(workers: .init(active: ["websub"])))
        // Config/'s activeWorkerIDs has moved on to ["indieauth"] since the recorded sync snapshot
        // (["websub"]) — e.g. the write-through failed partway, or an older build wrote Config/
        // directly.
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"], activeWorkerIDsMigratedToAnglesiteJSON: ["websub"])

        let resolved = DeployCoordinator.resolveActiveWorkerIDs(settings: settings, sourceDirectory: dir)

        #expect(resolved.ids == ["indieauth"])
        #expect(resolved.source == .configFallback(reason: .staleRelativeToConfig))
    }

    // MARK: - syncWorkerActivationToAnglesiteJSON (#1172)

    @Test("writes Config/'s activeWorkerIDs into anglesite.json's workers.active and records the sync snapshot")
    func syncWorkerActivationWritesDeclarationAndRecordsSnapshot() async throws {
        let dir = try temporaryDirectory()
        let configStore = SiteConfigStore(configDirectory: dir)
        let settings = SiteSettings(activeWorkerIDs: ["websub", "indieauth"])

        let updated = await DeployCoordinator.syncWorkerActivationToAnglesiteJSON(
            configStore: configStore, sourceDirectory: dir, settings: settings
        )

        #expect(updated.activeWorkerIDsMigratedToAnglesiteJSON == ["websub", "indieauth"])
        let declared = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(declared.workers?.active == ["websub", "indieauth"])
        // The returned settings were also persisted to Config/, not just returned.
        let saved = try await configStore.load()
        #expect(saved.activeWorkerIDsMigratedToAnglesiteJSON == ["websub", "indieauth"])
    }

    @Test("syncing preserves an existing anglesite.json's other declared sections")
    func syncWorkerActivationPreservesOtherSections() async throws {
        let dir = try temporaryDirectory()
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(hostname: "example.com")))
        let configStore = SiteConfigStore(configDirectory: dir)
        let settings = SiteSettings(activeWorkerIDs: ["websub"])

        _ = await DeployCoordinator.syncWorkerActivationToAnglesiteJSON(
            configStore: configStore, sourceDirectory: dir, settings: settings
        )

        let declared = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(declared.domain?.hostname == "example.com")
        #expect(declared.workers?.active == ["websub"])
    }

    // MARK: - toggledActiveWorkerIDs (#1172 review follow-up)

    @Test("toggling on preserves a hand-added id that's only in the trusted declaration, not yet in Config/")
    func toggledActiveWorkerIDsPreservesHandAddedDeclaredID() throws {
        let dir = try temporaryDirectory()
        // A hand edit added "newsletter" to the declaration; Config/'s own activeWorkerIDs and its
        // migration snapshot are still both ["indieauth"] (untouched, so nothing looks stale) —
        // resolveActiveWorkerIDs trusts the declaration in this state.
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(workers: .init(active: ["indieauth", "newsletter"])))
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"], activeWorkerIDsMigratedToAnglesiteJSON: ["indieauth"])

        let ids = DeployCoordinator.toggledActiveWorkerIDs(
            workerID: "websub", isOn: true, settings: settings, sourceDirectory: dir
        )

        #expect(ids == ["indieauth", "newsletter", "websub"])
    }

    @Test("toggling off a hand-added declared id actually removes it, rather than being resurrected")
    func toggledActiveWorkerIDsCanRemoveAHandAddedDeclaredID() throws {
        let dir = try temporaryDirectory()
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(workers: .init(active: ["indieauth", "newsletter"])))
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"], activeWorkerIDsMigratedToAnglesiteJSON: ["indieauth"])

        let ids = DeployCoordinator.toggledActiveWorkerIDs(
            workerID: "newsletter", isOn: false, settings: settings, sourceDirectory: dir
        )

        #expect(ids == ["indieauth"])
    }

    @Test("toggling off a normal (non-hand-edited) worker still deactivates it — guards against a naive union fix")
    func toggledActiveWorkerIDsDeactivatesNormally() throws {
        let dir = try temporaryDirectory()
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(workers: .init(active: ["indieauth", "websub"])))
        let settings = SiteSettings(activeWorkerIDs: ["indieauth", "websub"], activeWorkerIDsMigratedToAnglesiteJSON: ["indieauth", "websub"])

        let ids = DeployCoordinator.toggledActiveWorkerIDs(
            workerID: "websub", isOn: false, settings: settings, sourceDirectory: dir
        )

        #expect(ids == ["indieauth"])
    }

    @Test("with no anglesite.json declared, toggling behaves exactly as it did against Config/ alone")
    func toggledActiveWorkerIDsFallsBackWhenNotDeclared() throws {
        let dir = try temporaryDirectory()
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])

        let ids = DeployCoordinator.toggledActiveWorkerIDs(
            workerID: "websub", isOn: true, settings: settings, sourceDirectory: dir
        )

        #expect(ids == ["indieauth", "websub"])
    }

    // MARK: - planWorkerActivation reads through anglesite.json (#1172)

    @Test("planWorkerActivation prefers a synced anglesite.json declaration over Config/'s activeWorkerIDs")
    func planWorkerActivationPrefersDeclaredWhenSynced() async throws {
        let catalog = [
            descriptor(id: "websub", binding: .settingsActivated),
            descriptor(id: "indieauth", binding: .settingsActivated),
        ]
        let dir = try temporaryDirectory()
        // A hand edit added "indieauth" to the file after the last successful sync — Config/'s
        // own activeWorkerIDs ("websub") hasn't moved since that sync, so the declaration (not
        // Config/'s raw value) is what should win.
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(workers: .init(active: ["websub", "indieauth"])))
        let settings = SiteSettings(activeWorkerIDs: ["websub"], activeWorkerIDsMigratedToAnglesiteJSON: ["websub"])
        let contentGraph = SiteContentGraph()

        let plan = await DeployCoordinator.planWorkerActivation(
            siteID: "site-1", siteDirectory: dir, settings: settings, catalog: catalog, contentGraph: contentGraph
        )

        #expect(plan.effectiveActiveIDs == ["indieauth", "websub"])
        #expect(plan.activeWorkerIDsSource == .declared)
    }

    @Test("planWorkerActivation reports the fallback source when anglesite.json has no declaration")
    func planWorkerActivationReportsFallbackSource() async throws {
        let catalog = [descriptor(id: "indieauth", binding: .settingsActivated)]
        let dir = try temporaryDirectory()
        let settings = SiteSettings(activeWorkerIDs: ["indieauth"])
        let contentGraph = SiteContentGraph()

        let plan = await DeployCoordinator.planWorkerActivation(
            siteID: "site-1", siteDirectory: dir, settings: settings, catalog: catalog, contentGraph: contentGraph
        )

        #expect(plan.effectiveActiveIDs == ["indieauth"])
        #expect(plan.activeWorkerIDsSource == .configFallback(reason: .notDeclared))
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

    @Test("runs webmention-send, standard-site publish, syndication, then subscriber notify in order, with a milestone immediately before each")
    func postDeploySequencingRunsInOrder() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { progress in recorder.record("milestone:\(progress.phase)") },
            sendWebmentions: { recorder.record("send") },
            publishStandardSite: { recorder.record("standardsite") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") }
        )
        #expect(recorder.calls == [
            "milestone:webmentions", "send",
            "milestone:standardSitePublishing", "standardsite",
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
            publishStandardSite: { recorder.record("standardsite") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") }
        )
        #expect(recorder.calls == ["send", "standardsite", "syndicate", "notify"])
    }

    @Test("publishStandardSite defaults to a no-op so callers without a Standard.site pass change nothing")
    func postDeploySequencingDefaultsStandardSiteToNoOp() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { progress in recorder.record("milestone:\(progress.phase)") },
            sendWebmentions: { recorder.record("send") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") }
        )
        #expect(recorder.calls == [
            "milestone:webmentions", "send",
            "milestone:standardSitePublishing",
            "milestone:syndicating", "syndicate",
            "milestone:websubPing", "notify",
            "milestone:activityPubBackfill",
        ])
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
            "milestone:standardSitePublishing",
            "milestone:syndicating", "syndicate",
            "milestone:websubPing",
            "milestone:activityPubBackfill",
        ])
    }

    @Test("backfillActivityPubOutbox runs last, after webmention-send, standard-site publish, syndication, and subscriber notify, with a milestone immediately before it")
    func postDeploySequencingRunsBackfillLast() async {
        let recorder = CallRecorder()
        await DeployCoordinator.runPostDeploySequencing(
            onMilestone: { progress in recorder.record("milestone:\(progress.phase)") },
            sendWebmentions: { recorder.record("send") },
            publishStandardSite: { recorder.record("standardsite") },
            syndicate: { recorder.record("syndicate") },
            notifySubscribers: { recorder.record("notify") },
            backfillActivityPubOutbox: { recorder.record("backfill") }
        )
        #expect(recorder.calls == [
            "milestone:webmentions", "send",
            "milestone:standardSitePublishing", "standardsite",
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
