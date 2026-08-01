import Foundation

/// Resolves a site, runs a command inside `SiteAccess`, and provides user-facing dialog
/// strings. The App Intent structs are thin adapters over this; this type is fully
/// unit-testable with a fake `CommandFactory`.
///
/// A missing security-scoped grant (MAS) or a not-found site is mapped onto each command's
/// own `.failed` case so callers handle exactly one Result type per operation.
public struct SiteOperations: Sendable {
    typealias SocialWorkerAccess = @Sendable (
        _ site: SiteStore.Site,
        _ store: SiteStore,
        _ body: @Sendable @escaping (URL) async -> SocialWorkerProvisionCommand.Result
    ) async throws -> SocialWorkerProvisionCommand.Result

    private let factory: CommandFactory
    private let store: SiteStore
    private let socialWorkerAccess: SocialWorkerAccess
    /// The on-disk cached `@dwk/workers` catalog, consulted by the headless deploy path for
    /// resource composition and route claims (#708/#746). Injectable so tests can supply fixture
    /// descriptors instead of touching the real `~/Library/Application Support/Anglesite/`
    /// cache file `WorkerCatalogFetcher.cachedCatalog` reads from.
    private let cachedWorkerCatalog: @Sendable () -> [WorkerDescriptor]

    /// Production entry point: live commands, the shared registry, and real security-scoped
    /// access. Tests use the internal initializer instead, which additionally injects the
    /// scoped-access hop and the cached worker catalog.
    public init(factory: CommandFactory = LiveCommandFactory(), store: SiteStore = .shared) {
        self.init(
            factory: factory,
            store: store,
            socialWorkerAccess: { site, store, body in
                try await SiteAccess.withScopedAccess(to: site, in: store, body)
            }
        )
    }

    init(
        factory: CommandFactory,
        store: SiteStore,
        socialWorkerAccess: @escaping SocialWorkerAccess,
        cachedWorkerCatalog: @escaping @Sendable () -> [WorkerDescriptor] = { WorkerCatalogFetcher.cachedCatalog() }
    ) {
        self.factory = factory
        self.store = store
        self.socialWorkerAccess = socialWorkerAccess
        self.cachedWorkerCatalog = cachedWorkerCatalog
    }

    /// Resolve a site id (as carried by `SiteEntity`) to the registry's `Site`.
    public func site(id: String) async -> SiteStore.Site? {
        await store.find(id: id)
    }

    // MARK: Operations

    /// Headless deploy with the same worker composition as the GUI Deploy button (see
    /// `deployWithWorkerComposition` below). Never throws: access and lookup failures are folded
    /// into `DeployCommand.Result.failed`, per the type's one-Result-per-operation contract.
    public func deploy(site: SiteStore.Site, onProgress: ProgressHandler? = nil) async -> DeployCommand.Result {
        do {
            return try await SiteAccess.withScopedAccess(to: site, in: store) { url in
                await self.deployWithWorkerComposition(site: site, siteDirectory: url, onProgress: onProgress)
            }
        } catch let SiteAccess.AccessError.noGrant(message) {
            return .failed(reason: message, exitCode: nil)
        } catch {
            return .failed(reason: error.localizedDescription, exitCode: nil)
        }
    }

    /// Headless-deploy counterpart to `DeployModel.runDeploy`'s worker-composition wiring
    /// (#709 design §5/§8): computes the effective active worker set — settings-activated only,
    /// since this path (App Intents/Shortcuts) has no populated `SiteContentGraph` to derive
    /// component-tied activation from — and routes through `SocialWorkerProvisionCommand.provision`
    /// the same way the main Deploy button does, persisting the result on success.
    ///
    /// `onProgress` fidelity note: `SocialWorkerProvisionCommand.provision` has no milestone hook
    /// of its own (unlike `DeployCommand.deploy`, it's never been wired for one — it had no live
    /// caller before #709), so this emits the same coarse `OperationProgress.deployBuilding` /
    /// `.deployDeploying` milestones `DeployCommand.deploy` would have emitted around the
    /// build/deploy boundary, rather than `DeployCommand`'s finer per-step ones (preflight,
    /// finalizing). `SiteIntents.swift:59` is this path's one real consumer (Siri/Shortcuts
    /// progress) — dropping progress reporting to nothing would regress it; this keeps it coarser
    /// but non-silent without adding an `onProgress` parameter to `SocialWorkerProvisionCommand`
    /// itself, which would ripple into Tasks 3/4's signature and every other call site.
    private func deployWithWorkerComposition(
        site: SiteStore.Site, siteDirectory: URL, onProgress: ProgressHandler?
    ) async -> DeployCommand.Result {
        let configStore = SiteConfigStore(configDirectory: site.configDirectory)
        let settings = (try? await configStore.load()) ?? SiteSettings()
        // Resolves through the same `Source/anglesite.json` declaration (falling back to `Config/`)
        // as `DeployModel.runDeploy`'s `DeployCoordinator.planWorkerActivation` (#1172) — mirrors
        // its call, since this path doesn't otherwise go through `planWorkerActivation` (it has no
        // populated `SiteContentGraph` to build a snapshot from, see the comment above).
        let (resolvedActiveWorkerIDs, activeWorkerIDsSource) = DeployCoordinator.resolveActiveWorkerIDs(
            settings: settings, sourceDirectory: siteDirectory
        )
        var effectiveSettings = settings
        effectiveSettings.activeWorkerIDs = resolvedActiveWorkerIDs
        if let notice = DeployCoordinator.activeWorkerIDsFallbackNotice(source: activeWorkerIDsSource) {
            // Mirrors DeployModel.runDeploy's identical notice — shared text via DeployCoordinator
            // so the two paths can't drift (#708 review feedback's idiom).
            await LogCenter.shared.append(source: "deploy:\(site.id)", stream: .stdout, text: notice)
        }
        let effectiveActiveIDs = WorkerActivation.effectiveActiveIDs(settings: effectiveSettings, catalog: [], graph: nil)

        // Dynamic-route claims (#746) and resource composition (#708) both need real descriptor
        // data, which the `catalog: []` activation call above deliberately doesn't have (matching
        // the effectiveActiveIDs "settings-activated only" comment above). The on-disk cache from
        // a previous GUI fetch is the only source of that data on this headless path.
        let cachedCatalog = cachedWorkerCatalog()
        let workers = WorkerActivation.activeDescriptors(catalog: cachedCatalog, activeIDs: effectiveActiveIDs)
        let unresolvedIDs = WorkerActivation.unresolvedActiveIDs(activeIDs: effectiveActiveIDs, resolved: workers)
        if let warning = WorkerActivation.missingDescriptorWarning(unresolvedIDs: unresolvedIDs) {
            // Mirrors DeployModel.runDeploy's identical warning — shared text via
            // WorkerActivation so the two paths can't drift (#708 review feedback).
            await LogCenter.shared.append(source: "deploy:\(site.id)", stream: .stderr, text: warning)
        }
        let routeClaims: [WorkerRouteClaims.OwnedClaim]
        do {
            routeClaims = try WorkerRouteClaims.activeClaims(
                catalog: cachedCatalog, activeIDs: effectiveActiveIDs)
        } catch {
            return .failed(reason: "worker route claims are invalid: \(error)", exitCode: nil)
        }

        // Prefer the site's already-established Worker name (`.site-config`'s `CF_PROJECT_NAME`,
        // set at the first successful deploy or by a worker-name-conflict rename, #740) over
        // re-deriving one from the site's display name — mirrors `DeployModel.runDeploy`'s
        // resolution so the headless path can't silently revert a rename on every deploy.
        let existingConfig = (try? WebsiteAnalyticsAsset.loadConfig(siteDirectory: siteDirectory)) ?? ""
        let workerSiteName = SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: existingConfig)
            ?? SiteSlug.derive(from: site.name)

        onProgress?(.deployBuilding)
        onProgress?(.deployDeploying)
        let provisionResult = await factory.socialWorkerProvision().provision(
            siteID: site.id,
            siteDirectory: siteDirectory,
            siteName: workerSiteName,
            workers: workers,
            routeClaims: routeClaims.map(\.claim),
            knownResources: settings.provisionedWorkerResources ?? .init(),
            // #934: this headless path (App Intents/Shortcuts/Siri) now sees the same active
            // dynamic /.well-known/ claims the GUI Deploy button already threads via
            // `DeployModel.runDeploy`'s custom deployer closure, so #744's collision check blocks
            // identically regardless of trigger.
            wellKnownDynamicClaims: WorkerRouteClaims.wellKnownClaims(routeClaims)
        )
        onProgress?(.deployFinalizing)

        if case .succeeded(_, let resources, _) = provisionResult {
            var updated = settings
            updated.lastDeployedWorkerIDs = Array(effectiveActiveIDs).sorted()
            updated.provisionedWorkerResources = resources
            try? await configStore.save(updated)
        }

        return provisionResult.asDeployCommandResult
    }

    /// Runs the site's backup inside scoped access; access and lookup failures fold into
    /// `BackupCommand.Result.failed` rather than throwing.
    public func backup(site: SiteStore.Site, onProgress: ProgressHandler? = nil) async -> BackupCommand.Result {
        do {
            return try await SiteAccess.withScopedAccess(to: site, in: store) { url in
                await factory.backup().backup(siteID: site.id, siteDirectory: url, onProgress: onProgress)
            }
        } catch let SiteAccess.AccessError.noGrant(message) {
            return .failed(reason: message, exitCode: nil)
        } catch {
            return .failed(reason: error.localizedDescription, exitCode: nil)
        }
    }

    /// Runs the site's audit inside scoped access; access and lookup failures fold into
    /// `AuditCommand.Result.failed` (with an empty log tail, since no subprocess ever ran).
    public func audit(site: SiteStore.Site, onProgress: ProgressHandler? = nil) async -> AuditCommand.Result {
        do {
            return try await SiteAccess.withScopedAccess(to: site, in: store) { url in
                await factory.audit().audit(siteID: site.id, siteDirectory: url, onProgress: onProgress)
            }
        } catch let SiteAccess.AccessError.noGrant(message) {
            return .failed(reason: message, exitCode: nil, logTail: [])
        } catch {
            return .failed(reason: error.localizedDescription, exitCode: nil, logTail: [])
        }
    }

    /// The fixed V-2 starter pack (webmention + indieauth) this one-button "turn on social
    /// basics" operation provisions. Unlike `deployWithWorkerComposition`, this isn't driven by
    /// a site's catalog/effective-active-worker set — it's always the same two workers, matching
    /// `WorkerComposition.Feature.v2`'s pre-migration default. Fixed literals, not fetched from
    /// the `@dwk/workers` catalog, since this operation predates catalog-driven composition and
    /// has no site-settings or catalog input to derive from.
    private static let v2StarterWorkers: [WorkerDescriptor] = [
        WorkerDescriptor(
            id: "webmention", displayName: "Webmentions", description: "Outbound webmention sending",
            group: "social", binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false)
        ),
        WorkerDescriptor(
            id: WorkerComposition.indieauthWorkerID, displayName: "IndieAuth", description: "IndieAuth sign-in",
            group: "social", binding: .settingsActivated, resources: .init(needsD1: true, needsKV: true, needsR2: false)
        ),
    ]

    /// Provisions the fixed V-2 starter pack (`v2StarterWorkers` above) for a site — the
    /// one-button "turn on social basics" operation, deliberately independent of the site's
    /// catalog-driven active-worker set.
    public func provisionSocialWorker(site: SiteStore.Site) async -> SocialWorkerProvisionCommand.Result {
        do {
            return try await socialWorkerAccess(site, store) { url in
                await factory.socialWorkerProvision().provision(
                    siteID: site.id,
                    siteDirectory: url,
                    siteName: SiteSlug.derive(from: site.name),
                    workers: Self.v2StarterWorkers
                )
            }
        } catch let SiteAccess.AccessError.noGrant(message) {
            return .failed(reason: message, exitCode: nil, resources: .init())
        } catch {
            return .failed(reason: error.localizedDescription, exitCode: nil, resources: .init())
        }
    }

    // MARK: Dialog mapping (pure)

    /// Maps a deploy result onto the sentence Siri/Shortcuts speaks or shows. Pure and static so
    /// intent tests can assert exact strings without running any operation.
    public static func dialog(forDeploy result: DeployCommand.Result) -> String {
        switch result {
        case .succeeded(let url, _):
            return "Deployed to \(url.absoluteString)."
        case .blocked(let failures, _):
            let count = failures.count
            let noun = count == 1 ? "issue" : "issues"
            return "Deploy blocked by the pre-deploy security scan (\(count) \(noun)). Resolve these in Anglesite first."
        case .workerNameConflict(let name):
            return "Deploy blocked: the Worker name \"\(name)\" is already in use on your Cloudflare account. Rename the site's Worker in Anglesite and try again."
        case .failed(let reason, _):
            return "Deploy failed: \(reason)"
        }
    }

    /// Backup counterpart to `dialog(forDeploy:)` — pure result-to-sentence mapping.
    public static func dialog(forBackup result: BackupCommand.Result) -> String {
        switch result {
        case .succeeded(let sha, _, let remote):
            return "Backed up \(sha.prefix(7)) to \(remote)."
        case .noChanges:
            return "No changes to back up."
        case .failed(let reason, _):
            return "Backup failed: \(reason)"
        }
    }

    /// Audit counterpart to `dialog(forDeploy:)` — summarizes finding counts by severity.
    public static func dialog(forAudit result: AuditCommand.Result) -> String {
        switch result {
        case .succeeded(let report, _):
            let c = report.findings.filter { $0.severity == .critical }.count
            let w = report.findings.filter { $0.severity == .warning }.count
            let i = report.findings.filter { $0.severity == .info }.count
            return "Audit complete: \(c) critical, \(w) warning, \(i) info."
        case .failed(let reason, _, _):
            return "Audit failed: \(reason)"
        }
    }

    /// Social-worker-provision counterpart to `dialog(forDeploy:)`. Always appends the
    /// provisioned-resource suffix, including on failure — resources (D1/KV/R2) created before
    /// the failure survive it, and the owner should know they exist.
    public static func dialog(forSocialWorkerProvision result: SocialWorkerProvisionCommand.Result) -> String {
        switch result {
        case .succeeded(let url, let resources, _):
            return "Social Worker provisioned at \(url.absoluteString).\(resourceSuffix(resources))"
        case .blocked(let failures, _, let resources):
            let count = failures.count
            let noun = count == 1 ? "issue" : "issues"
            return "Social Worker provisioning blocked by the pre-deploy security scan (\(count) \(noun)).\(resourceSuffix(resources))"
        case .workerNameConflict(let name, let resources):
            return "Social Worker provisioning blocked: the Worker name \"\(name)\" is already in use on your Cloudflare account. Rename the site's Worker in Anglesite and try again.\(resourceSuffix(resources))"
        case .webmentionPaidPlanConfirmationNeeded(let resources):
            return "Social Worker provisioning paused: inbound Webmention and WebSub require the Cloudflare Workers Paid plan. Confirm this in Anglesite's deploy sheet and try again.\(resourceSuffix(resources))"
        case .failed(let reason, _, let resources):
            return "Social Worker provisioning failed: \(reason).\(resourceSuffix(resources))"
        }
    }

    /// Friendly dialog for a Siri/Shortcuts cancellation, mapped from `Task.isCancelled` at the
    /// intent boundary (the command actor SIGTERMs the underlying subprocess on cancel).
    public static func canceledDialog(operation: String, siteName: String) -> String {
        "Canceled the \(operation) of \(siteName)."
    }

    private static func resourceSuffix(_ resources: WorkerComposition.ProvisionedResources) -> String {
        var labels: [String] = []
        if resources.d1DatabaseID != nil { labels.append("D1") }
        if resources.kvNamespaceID != nil { labels.append("KV") }
        if resources.r2BucketName != nil { labels.append("R2") }
        guard !labels.isEmpty else { return "" }
        return " Provisioned resources: \(labels.joined(separator: ", "))."
    }
}
