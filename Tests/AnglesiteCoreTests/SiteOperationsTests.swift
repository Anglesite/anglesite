import Testing
import Foundation
@testable import AnglesiteCore

/// `SiteOperations` core + dialog mapping. The command actors are faked through their existing
/// closure seams, so these tests verify the Result→dialog behavior without spawning anything.
struct SiteOperationsTests {

    /// A factory whose backup actor is scripted (via the git `runner` seam) to land on a
    /// clean feature branch → `.noChanges`. Deploy/audit aren't exercised here (their dialog
    /// mapping is tested directly against constructed `Result`s below).
    private struct FakeFactory: CommandFactory {
        func deploy() -> DeployCommand { DeployCommand() }
        func audit() -> AuditCommand { AuditCommand() }
        func socialWorkerProvision() -> SocialWorkerProvisionCommand {
            SocialWorkerProvisionCommand(tokenSource: { nil })
        }
        func backup() -> BackupCommand {
            BackupCommand(
                runner: { _, args in
                    switch args.first {
                    case "rev-parse":
                        // Serves both `--is-inside-work-tree` (exit 0 = repo) and
                        // `--abbrev-ref HEAD` (branch name → non-main so we proceed).
                        return .init(stdout: "feature\n", stderr: "", exitCode: 0)
                    case "remote":
                        return .init(stdout: "git@example.com:me/site.git\n", stderr: "", exitCode: 0)
                    case "status":
                        return .init(stdout: "", stderr: "", exitCode: 0) // clean → noChanges
                    default:
                        return .init(stdout: "", stderr: "unmocked git \(args.joined(separator: " "))", exitCode: 1)
                    }
                },
                streamer: { _, _, _ in (0, "") },
                clock: { Date(timeIntervalSince1970: 1_780_000_000) }
            )
        }
    }

    private func throwawayStore() -> SiteStore {
        SiteStore(persistenceURL: URL(fileURLWithPath: "/tmp/siteops-test-store.json"))
    }

    private func makeSite() -> SiteStore.Site {
        SiteStore.Site(
            id: "s1",
            name: "Portfolio",
            packageURL: URL(fileURLWithPath: NSTemporaryDirectory() + "portfolio.anglesite", isDirectory: true),
            isValid: true,
            missingSentinels: []
        )
    }

    private func makeSite(name: String, packageURL: URL) -> SiteStore.Site {
        SiteStore.Site(
            id: "s1",
            name: name,
            packageURL: packageURL,
            isValid: true,
            missingSentinels: []
        )
    }

    private func temporaryPackage() throws -> URL {
        let package = FileManager.default.temporaryDirectory
            .appendingPathComponent("SiteOperationsTests-\(UUID().uuidString).anglesite", isDirectory: true)
        try FileManager.default.createDirectory(
            at: package.appendingPathComponent("Source", isDirectory: true),
            withIntermediateDirectories: true
        )
        return package
    }

    /// A fixture `WorkerDescriptor` for the headless-deploy tests below — stands in for what
    /// `WorkerCatalogFetcher.cachedCatalog()` would return from a real on-disk cache, without
    /// touching the real `~/Library/Application Support/Anglesite/` cache file from a test.
    private func descriptor(id: String, d1: Bool = true, kv: Bool = true, r2: Bool = false) -> WorkerDescriptor {
        WorkerDescriptor(
            id: id, displayName: id, description: "test fixture", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: d1, needsKV: kv, needsR2: r2)
        )
    }

    private func finding(_ severity: AuditReport.Finding.Severity) -> AuditReport.Finding {
        AuditReport.Finding(
            category: .seo, severity: severity, title: "t", detail: "d",
            remediation: nil, location: nil
        )
    }

    @Test("backup on a clean feature branch maps to a 'no changes' dialog")
    func backupNoChanges() async {
        let ops = SiteOperations(factory: FakeFactory(), store: throwawayStore())
        let result = await ops.backup(site: makeSite())
        #expect(result == .noChanges)
        #expect(SiteOperations.dialog(forBackup: result) == "No changes to back up.")
    }

    @Test("backup success dialog shows the short SHA and remote")
    func backupSuccessDialog() {
        let result = BackupCommand.Result.succeeded(
            commitSHA: "abcdef1234567890", branch: "feature", remote: "git@example.com:me/site.git"
        )
        #expect(SiteOperations.dialog(forBackup: result) == "Backed up abcdef1 to git@example.com:me/site.git.")
    }

    @Test("audit dialog summarizes findings by severity")
    func auditDialog() {
        let report = AuditReport(
            findings: [finding(.critical), finding(.warning), finding(.warning)],
            runnersExecuted: [.seo], runnersSkipped: []
        )
        let dialog = SiteOperations.dialog(forAudit: .succeeded(report: report, duration: 1))
        #expect(dialog == "Audit complete: 1 critical, 2 warning, 0 info.")
    }

    @Test("deploy success dialog shows the deployed URL")
    func deploySuccessDialog() {
        let url = URL(string: "https://portfolio.example.workers.dev")!
        #expect(
            SiteOperations.dialog(forDeploy: .succeeded(url: url, duration: 2))
                == "Deployed to https://portfolio.example.workers.dev."
        )
    }

    @Test("deploy blocked dialog reports the issue count and never offers an override")
    func deployBlockedDialog() {
        let failure = PreDeployCheck.ScanFailure(
            category: .exposedToken, message: "API key committed", file: "src/index.md", remediation: "Remove it"
        )
        let dialog = SiteOperations.dialog(forDeploy: .blocked(failures: [failure], warnings: []))
        #expect(dialog == "Deploy blocked by the pre-deploy security scan (1 issue). Resolve these in Anglesite first.")
        #expect(!dialog.lowercased().contains("force"))
        #expect(!dialog.lowercased().contains("override"))
    }

    @Test("deploy failure dialog surfaces the reason")
    func deployFailureDialog() {
        let dialog = SiteOperations.dialog(forDeploy: .failed(reason: "network down", exitCode: 1))
        #expect(dialog == "Deploy failed: network down")
    }

    @Test("deploy worker-name-conflict dialog names the taken Worker and asks for a rename")
    func deployWorkerNameConflictDialog() {
        let dialog = SiteOperations.dialog(forDeploy: .workerNameConflict(name: "taken-name"))
        #expect(dialog.contains("taken-name"))
        #expect(dialog.lowercased().contains("rename"))
    }

    @Test("social worker provisioning runs through SiteOperations and slugifies the worker name")
    func socialWorkerProvisionOperation() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let recorder = SocialWorkerRecorder()
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: recorder), store: throwawayStore())

        let result = await ops.provisionSocialWorker(site: site)

        // The fixed V-2 starter pack's "webmention" worker id is `@dwk/webmention`'s catalog id
        // (`WorkerComposition.webmentionWorkerID`), which also carries inbound receive — so this
        // call now parks on the Cloudflare Queues paid-plan confirmation gate (#359) before ever
        // creating the Queue or deploying. D1/KV are still provisioned first (both webmention and
        // indieauth need them), so their ids are already in `resources` when the gate returns.
        guard case .webmentionPaidPlanConfirmationNeeded(let resources) = result else {
            Issue.record("expected webmentionPaidPlanConfirmationNeeded, got \(result)")
            return
        }
        #expect(await recorder.arguments == [
            ["d1", "create", "blue-bottle-cafe-social", "--json"],
            ["kv", "namespace", "create", "blue-bottle-cafe-social", "--json"],
        ])
        #expect(await recorder.deployCalls.isEmpty)
        #expect(resources.d1DatabaseID == "d1-id")
        #expect(resources.kvNamespaceID == "kv-id")
    }

    @Test("provisionSocialWorker's fixed V-2 starter pack (webmention + indieauth) restores the pre-#708 Feature.v2 default")
    func provisionSocialWorkerRestoresV2Default() async throws {
        // provisionSocialWorker never accepted a workers/features parameter and always relied on
        // provision(...)'s default value — Feature.v2 pre-#708, now the fixed v2StarterWorkers
        // constant. This asserts every observable trace of that default's composition: D1 create
        // (both webmention and indieauth need it), KV create (same), and the AUTH_DB migration
        // step that only runs when "indieauth" specifically is among the composed workers.
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let recorder = SocialWorkerRecorder()
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: recorder), store: throwawayStore())

        let result = await ops.provisionSocialWorker(site: site)

        // As in `socialWorkerProvisionOperation` above, the starter pack's real "webmention" id
        // now parks on the paid-plan confirmation gate (#359) before the IndieAuth migration step
        // or deploy — so D1/KV are provisioned but the AUTH_DB migration never runs.
        guard case .webmentionPaidPlanConfirmationNeeded = result else {
            Issue.record("expected webmentionPaidPlanConfirmationNeeded, got \(result)")
            return
        }
        let arguments = await recorder.arguments
        #expect(arguments.contains(["d1", "create", "blue-bottle-cafe-social", "--json"]))
        #expect(arguments.contains(["kv", "namespace", "create", "blue-bottle-cafe-social", "--json"]))
        #expect(!arguments.contains(["d1", "migrations", "apply", "AUTH_DB", "--remote"]))
        let toml = try String(
            contentsOf: package.appendingPathComponent("Source/wrangler.toml"), encoding: .utf8)
        #expect(!toml.contains("[[r2_buckets]]"))
    }

    @Test("social worker provisioning maps missing folder grants to failed results")
    func socialWorkerProvisionNoGrant() async {
        let site = makeSite()
        let ops = SiteOperations(
            factory: SocialWorkerFactory(recorder: SocialWorkerRecorder()),
            store: throwawayStore(),
            socialWorkerAccess: { _, _, _ in
                throw SiteAccess.AccessError.noGrant("Portfolio has no folder grant.")
            }
        )

        let result = await ops.provisionSocialWorker(site: site)

        #expect(result == .failed(reason: "Portfolio has no folder grant.", exitCode: nil, resources: .init()))
    }

    @Test("social worker provisioning maps unexpected access errors to failed results")
    func socialWorkerProvisionGenericAccessError() async {
        let site = makeSite()
        let ops = SiteOperations(
            factory: SocialWorkerFactory(recorder: SocialWorkerRecorder()),
            store: throwawayStore(),
            socialWorkerAccess: { _, _, _ in
                throw TestAccessError()
            }
        )

        let result = await ops.provisionSocialWorker(site: site)

        #expect(result == .failed(reason: "could not resolve site access", exitCode: nil, resources: .init()))
    }

    @Test("social worker provisioning dialog reports success and resources")
    func socialWorkerProvisionSuccessDialog() {
        let result = SocialWorkerProvisionCommand.Result.succeeded(
            url: URL(string: "https://site.example.workers.dev")!,
            resources: .init(d1DatabaseID: "d1", kvNamespaceID: "kv"),
            duration: 1
        )
        #expect(
            SiteOperations.dialog(forSocialWorkerProvision: result)
                == "Social Worker provisioned at https://site.example.workers.dev. Provisioned resources: D1, KV."
        )
    }

    @Test("social worker provisioning blocked dialog preserves security gate wording")
    func socialWorkerProvisionBlockedDialog() {
        let failure = PreDeployCheck.ScanFailure(
            category: .exposedToken,
            message: "API key committed",
            file: "dist/index.html",
            remediation: "Remove it"
        )
        let result = SocialWorkerProvisionCommand.Result.blocked(
            failures: [failure],
            warnings: [],
            resources: .init(d1DatabaseID: "d1", kvNamespaceID: "kv", r2BucketName: "media")
        )
        let dialog = SiteOperations.dialog(forSocialWorkerProvision: result)
        #expect(dialog == "Social Worker provisioning blocked by the pre-deploy security scan (1 issue). Provisioned resources: D1, KV, R2.")
        #expect(!dialog.lowercased().contains("force"))
        #expect(!dialog.lowercased().contains("override"))
    }

    @Test("social worker provisioning worker-name-conflict dialog names the taken Worker")
    func socialWorkerProvisionWorkerNameConflictDialog() {
        let result = SocialWorkerProvisionCommand.Result.workerNameConflict(
            name: "taken-name", resources: .init(d1DatabaseID: "d1")
        )
        let dialog = SiteOperations.dialog(forSocialWorkerProvision: result)
        #expect(dialog.contains("taken-name"))
        #expect(dialog.lowercased().contains("rename"))
        #expect(dialog.contains("Provisioned resources: D1."))
    }

    @Test("social worker provisioning failure dialog includes partial resources")
    func socialWorkerProvisionFailureDialog() {
        let result = SocialWorkerProvisionCommand.Result.failed(
            reason: "KV failed",
            exitCode: 1,
            resources: .init(d1DatabaseID: "d1")
        )
        #expect(
            SiteOperations.dialog(forSocialWorkerProvision: result)
                == "Social Worker provisioning failed: KV failed. Provisioned resources: D1."
        )
    }

    @Test("backup failure dialog surfaces the reason")
    func backupFailureDialog() {
        let dialog = SiteOperations.dialog(forBackup: .failed(reason: "push rejected", exitCode: 1))
        #expect(dialog == "Backup failed: push rejected")
    }

    @Test("audit failure dialog surfaces the reason")
    func auditFailureDialog() {
        let dialog = SiteOperations.dialog(forAudit: .failed(reason: "config missing", exitCode: 1, logTail: []))
        #expect(dialog == "Audit failed: config missing")
    }

    @Test("headless deploy with a settings-activated worker routes through provision and persists lastDeployedWorkerIDs")
    func headlessDeployWithActiveWorkerPersistsState() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let configStore = SiteConfigStore(configDirectory: site.configDirectory)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))

        let recorder = SocialWorkerRecorder()
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: recorder), store: throwawayStore())

        let result = await ops.deploy(site: site)

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        let saved = try await configStore.load()
        #expect(saved.lastDeployedWorkerIDs == ["indieauth"])
    }

    @Test("headless deploy resolves the Worker name from CF_PROJECT_NAME before deriving from the site's display name")
    func headlessDeployUsesConfiguredProjectNameOverDerivedSlug() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let configStore = SiteConfigStore(configDirectory: site.configDirectory)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))

        // Simulate a #740 worker-name-conflict rename: `.site-config` already records a Worker
        // name that differs from what `SiteSlug.derive(from: site.name)` would produce. A naive
        // re-derivation would silently revert the rename on every subsequent deploy.
        let siteConfigContents = SiteConfigFile.upsert([("CF_PROJECT_NAME", "renamed-worker")], into: "")
        try siteConfigContents.write(
            to: site.sourceDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath),
            atomically: true,
            encoding: .utf8
        )

        let recorder = SocialWorkerRecorder()
        let ops = SiteOperations(
            factory: SocialWorkerFactory(recorder: recorder),
            store: throwawayStore(),
            socialWorkerAccess: { site, store, body in try await SiteAccess.withScopedAccess(to: site, in: store, body) },
            cachedWorkerCatalog: { [self.descriptor(id: "indieauth")] }
        )

        let result = await ops.deploy(site: site)

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(await recorder.arguments == [
            ["d1", "create", "renamed-worker-social", "--json"],
            ["kv", "namespace", "create", "renamed-worker-social", "--json"],
            ["d1", "migrations", "apply", "AUTH_DB", "--remote"],
        ])
    }

    @Test("headless deploy forwards active /.well-known/ route claims to the deployer (#934)")
    func headlessDeployForwardsWellKnownDynamicClaimsToDeployer() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let configStore = SiteConfigStore(configDirectory: site.configDirectory)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["webfinger"]))

        let webfingerRoute = WorkerRouteClaim(
            path: "/.well-known/webfinger", match: .exact, methods: ["GET"], handler: "webfinger")
        let webfingerWorker = WorkerDescriptor(
            id: "webfinger", displayName: "webfinger", description: "test fixture", group: "social",
            binding: .settingsActivated, resources: .init(needsD1: false, needsKV: false, needsR2: false),
            routes: [webfingerRoute]
        )

        let recorder = SocialWorkerRecorder()
        let ops = SiteOperations(
            factory: SocialWorkerFactory(recorder: recorder),
            store: throwawayStore(),
            socialWorkerAccess: { site, store, body in try await SiteAccess.withScopedAccess(to: site, in: store, body) },
            cachedWorkerCatalog: { [webfingerWorker] }
        )

        let result = await ops.deploy(site: site)

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        // Mirrors DeployModel.runDeploy's GUI-path wiring (#744/#746): the headless deploy path
        // (App Intents/Shortcuts/Siri, #934) must see the same active dynamic /.well-known/
        // route claims, or a static/dynamic collision that the GUI Deploy button would block
        // could slip through here.
        #expect(await recorder.deployCalls == [
            .init(
                token: "token", siteID: "s1", siteDirectory: site.sourceDirectory,
                wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim(owner: "webfinger", claim: webfingerRoute)]
            ),
        ])
    }

    @Test("headless deploy with no activated workers still deploys through the plain static path")
    func headlessDeployWithNoActiveWorkers() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let recorder = SocialWorkerRecorder()
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: recorder), store: throwawayStore())

        let result = await ops.deploy(site: site)

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        #expect(await recorder.arguments.isEmpty)
    }

    @Test("headless deploy backfills SECURITY_TXT_MODE before the deploy proceeds (#745)")
    func headlessDeployBackfillsSecurityTxtMode() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        try "SECURITY_CONTACT=security@example.com\n".write(
            to: site.sourceDirectory.appendingPathComponent(".site-config"),
            atomically: true, encoding: .utf8
        )
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: SocialWorkerRecorder()), store: throwawayStore())

        let result = await ops.deploy(site: site)

        guard case .succeeded = result else {
            Issue.record("expected success, got \(result)")
            return
        }
        let config = try String(contentsOf: site.sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
    }

    @Test("headless deploy still reports coarse progress milestones through onProgress")
    func headlessDeployReportsProgress() async throws {
        let package = try temporaryPackage()
        defer { try? FileManager.default.removeItem(at: package) }
        let site = makeSite(name: "Blue Bottle Cafe", packageURL: package)
        let ops = SiteOperations(factory: SocialWorkerFactory(recorder: SocialWorkerRecorder()), store: throwawayStore())
        let seen = HeadlessDeployProgressRecorder()

        _ = await ops.deploy(site: site, onProgress: { progress in Task { await seen.record(progress) } })
        // onProgress fires synchronously inside deployWithWorkerComposition, but the recorder hop
        // above is async — give it a beat to land before asserting.
        while await seen.progresses.count < 2 { await Task.yield() }

        let progresses = await seen.progresses
        #expect(progresses.contains(.deployBuilding))
        #expect(progresses.contains(.deployDeploying))
    }
}

private actor SocialWorkerRecorder {
    private var seenArguments: [[String]] = []
    private var seenDeployCalls: [DeployCall] = []

    var arguments: [[String]] { seenArguments }
    var deployCalls: [DeployCall] { seenDeployCalls }

    func run(arguments: [String]) -> ProcessSupervisor.RunResult {
        seenArguments.append(arguments)
        switch arguments.first {
        case "d1":
            return .init(stdout: #"{"uuid":"d1-id"}"#, stderr: "", exitCode: 0)
        case "kv":
            return .init(stdout: #"{"id":"kv-id"}"#, stderr: "", exitCode: 0)
        default:
            return .init(stdout: "unexpected arguments \(arguments)", stderr: "", exitCode: 127)
        }
    }

    func deploy(
        token: String, siteID: String, siteDirectory: URL,
        wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim]
    ) -> DeployCommand.Result {
        seenDeployCalls.append(.init(
            token: token, siteID: siteID, siteDirectory: siteDirectory,
            wellKnownDynamicClaims: wellKnownDynamicClaims))
        return .succeeded(url: URL(string: "https://blue-bottle-cafe.example.workers.dev")!, duration: 1)
    }
}

private struct DeployCall: Sendable, Equatable {
    let token: String
    let siteID: String
    let siteDirectory: URL
    let wellKnownDynamicClaims: [WorkerRouteClaims.OwnedClaim]
}

private struct TestAccessError: LocalizedError, Sendable {
    var errorDescription: String? { "could not resolve site access" }
}

// Named distinctly from `DeployCommandProgressTests.ProgressRecorder` (an internal,
// non-private, lock-based type in the same test target) to avoid a same-module name clash.
private actor HeadlessDeployProgressRecorder {
    private(set) var progresses: [OperationProgress] = []
    func record(_ progress: OperationProgress) { progresses.append(progress) }
}

private struct SocialWorkerFactory: CommandFactory {
    let recorder: SocialWorkerRecorder

    func deploy() -> DeployCommand { DeployCommand() }
    func backup() -> BackupCommand { BackupCommand(runner: { _, _ in .init(stdout: "", stderr: "", exitCode: 1) }, streamer: { _, _, _ in (1, "") }) }
    func audit() -> AuditCommand {
        AuditCommand(
            executor: HostAuditExecutor(resolveCommand: { _ in { _ in .unavailable(reason: "noop") } }),
            runners: []
        )
    }
    func socialWorkerProvision() -> SocialWorkerProvisionCommand {
        SocialWorkerProvisionCommand(
            tokenSource: { "token" },
            runner: { _, arguments, _, _ in await recorder.run(arguments: arguments) },
            deployer: { token, siteID, siteDirectory, wellKnownDynamicClaims in
                await recorder.deploy(
                    token: token, siteID: siteID, siteDirectory: siteDirectory,
                    wellKnownDynamicClaims: wellKnownDynamicClaims)
            }
        )
    }
}
