import Foundation
import Testing
import AnglesiteCore
import AnglesiteTestSupport
@testable import AnglesiteAppCore

private actor GatedDeployExecutor: DeployExecutor {
    private var buildContinuation: CheckedContinuation<Void, Never>?

    func run(
        step: DeployStep,
        siteDirectory: URL,
        environment: [String: String],
        source: String
    ) async -> DeployStepResult {
        switch step {
        case .build:
            await withCheckedContinuation { buildContinuation = $0 }
            return DeployStepResult(exitCode: 0, output: "")
        case .preflight:
            return DeployStepResult(
                exitCode: 0,
                output: #"{"version":1,"ok":true,"failures":[],"warnings":[]}"#
            )
        case .wrangler:
            return DeployStepResult(
                exitCode: 0,
                output: "Published test (0.1 sec)\n  https://test.example.workers.dev"
            )
        case .bundleUpload:
            return DeployStepResult(exitCode: 0, output: "")
        }
    }

    func waitUntilBuildIsParked() async {
        while buildContinuation == nil {
            await Task.yield()
        }
    }

    func resumeBuild() {
        buildContinuation?.resume()
        buildContinuation = nil
    }
}

private final class FakeDomainAttachWriter: CloudflareWriting, @unchecked Sendable {
    let outcome: CustomDomainAttachResult
    private(set) var attachCallCount = 0
    init(outcome: CustomDomainAttachResult) { self.outcome = outcome }

    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        attachCallCount += 1
        return outcome
    }

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {}
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {}
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {}
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setMarkdownForAgents(hostname: String, enabled: Bool, apiToken: String) async throws -> Bool { true }
}

private struct StubTokenVerifying: TokenVerifying {
    let result: Result<CloudflareAccount, TokenVerifyError>
    func verify(token: String, siteDirectory: URL) async -> Result<CloudflareAccount, TokenVerifyError> {
        result
    }
}

/// `hasUsableToken()` falls back to the real `CLOUDFLARE_API_TOKEN` process environment variable
/// when no `tokenAvailabilityOverride` is supplied — which the four tests below that call
/// `CloudflareAPITokenTestEnvironment.shared.claimClear()` deliberately don't supply, since they're
/// exercising that fallback (and the keychain check) directly. `DomainConfigAuditModelTests`/
/// `OnionRoutingModelTests` elsewhere in this target want that same process-wide env var *set* for
/// their own tests, and Swift Testing can run unrelated suites concurrently, so both sides claim
/// the var through the shared `CloudflareAPITokenTestEnvironment` coordinator rather than touching
/// `setenv`/`unsetenv` directly — it serializes the two incompatible desired states against each
/// other instead of letting them race. Claim at the top of a test body (before any other `await`,
/// so no other test's `deploy()` check can interleave) and release via `defer`.
@Suite("DeployModel")
@MainActor
struct DeployModelTests {
    @Test("sudden termination stays disabled until a deploy finishes")
    func suddenTerminationLeaseBracketsDeploy() async {
        let executor = GatedDeployExecutor()
        let controller = SuddenTerminationController(disable: {}, enable: {})
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let model = DeployModel(
            command: command,
            logCenter: LogCenter(),
            suddenTerminationController: controller,
            tokenAvailabilityOverride: { true }
        )
        let directory = FileManager.default.temporaryDirectory

        model.deploy(
            siteID: "test-site",
            siteDirectory: directory,
            configDirectory: directory,
            currentRoutes: []
        )
        await executor.waitUntilBuildIsParked()

        #expect(model.isRunning)
        #expect(controller.activeLeaseCount == 1)

        await executor.resumeBuild()
        while model.isRunning {
            await Task.yield()
        }

        #expect(controller.activeLeaseCount == 0)
        guard case .succeeded = model.phase else {
            Issue.record("Expected deploy to succeed, got \(model.phase)")
            return
        }
    }

    @Test("A worker-name conflict parks the deploy and presents the conflict sheet")
    func workerNameConflictParksAndPresents() async {
        let executor = GatedDeployExecutor()
        // Never reached — the conflict short-circuits before the build step — but present so a
        // regression that skips the gate doesn't hang the test on the gated continuation.
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        guard case .workerNameConflict(let name) = model.phase else {
            Issue.record("expected .workerNameConflict, got \(model.phase)"); return
        }
        #expect(name == "my-site")
        #expect(model.workerNameConflictPresented)
    }

    @Test("Domain config drift blocks the deploy and presents the drift sheet (#1173)")
    func domainConfigDriftBlocksAndPresents() async {
        let executor = GatedDeployExecutor()
        // Never reached — drift short-circuits before the build step — but present so a
        // regression that skips the gate doesn't hang the test on the gated continuation.
        await executor.resumeBuild()
        let finding = DomainConfigAudit.Finding(
            category: .dns, title: "Missing managed DNS record", detail: "detail", remediation: .informational)
        let command = DeployCommand(
            tokenSource: { "test-token" },
            executor: executor,
            domainConfigDriftSource: { _, _, _ in [finding] }
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        var config = DomainConfig()
        config.domain = DomainConfig.Domain(hostname: "example.com")
        try! DomainConfigStore(sourceDirectory: siteDir).save(config)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        guard case .domainConfigDrift(let findings) = model.phase else {
            Issue.record("expected .domainConfigDrift, got \(model.phase)"); return
        }
        #expect(findings == [finding])
        #expect(model.domainConfigDriftPresented)

        model.dismissDomainConfigDrift()
        #expect(!model.domainConfigDriftPresented)
    }

    @Test("Renaming and retrying rewrites wrangler.toml/.site-config and re-deploys under the new name")
    func renameAndRetrySucceedsUnderNewName() async {
        let executor = GatedDeployExecutor()
        // Never reached — the conflict short-circuits before the build step — but present so a
        // regression that skips the gate doesn't hang the test on the gated continuation.
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            // "my-site" is taken; "my-site-2" (what the sheet will submit) is free.
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! #"name = "my-site""#.write(to: siteDir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }
        guard case .workerNameConflict = model.phase else {
            Issue.record("expected .workerNameConflict before renaming, got \(model.phase)"); return
        }

        // Unlike the initial deploy above, the retried deploy's new name is free, so it proceeds
        // into the real pipeline and parks on a fresh build continuation — wait for it, then
        // resume it, mirroring `suddenTerminationLeaseBracketsDeploy`'s synchronization.
        await model.renameWorkerAndRetry("my-site-2")
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded after rename-and-retry, got \(model.phase)"); return
        }
        #expect(!model.workerNameConflictPresented)
        let toml = try! String(contentsOf: siteDir.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains(#"name = "my-site-2""#))
    }

    @Test("Renaming to a name that's also taken loops back to the conflict sheet under the new name")
    func renameToAlsoTakenNameLoopsBackToConflict() async {
        let executor = GatedDeployExecutor()
        // Never reached — both the initial and retried collision checks short-circuit before the
        // build step — but present so a regression that skips the gate doesn't hang the test on
        // the gated continuation.
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            // Both "my-site" (the original name) and "my-site-2" (the rename target) are taken.
            workerScriptNamesSource: { _ in ["my-site", "my-site-2"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! #"name = "my-site""#.write(to: siteDir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }
        guard case .workerNameConflict(let firstName) = model.phase else {
            Issue.record("expected .workerNameConflict before renaming, got \(model.phase)"); return
        }
        #expect(firstName == "my-site")

        // "my-site-2" is also taken, so the retried deploy's collision check fires again — it's a
        // pre-spawn check that short-circuits before `.build`, so no build-continuation
        // synchronization is needed for this retry (unlike `renameAndRetrySucceedsUnderNewName`,
        // where the retry's name is free and genuinely reaches the build step).
        await model.renameWorkerAndRetry("my-site-2")
        while model.isRunning { await Task.yield() }

        guard case .workerNameConflict(let secondName) = model.phase else {
            Issue.record("expected .workerNameConflict again after renaming to a taken name, got \(model.phase)"); return
        }
        #expect(secondName == "my-site-2")
        #expect(model.workerNameConflictPresented)
    }

    @Test("A confirmed domain attach swaps the succeeded phase's URL to the custom domain")
    func confirmedDomainAttachSwapsDisplayedURL() async {
        let executor = GatedDeployExecutor()
        let writer = FakeDomainAttachWriter(outcome: .attached)
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            markdownForAgentsCommand: MarkdownForAgentsCommand(client: writer),
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.absoluteString == "https://example.com")
        #expect(model.domainAttachStatus == .confirmed(hostname: "example.com"))
        #expect(!model.domainConflictPresented)
    }

    @Test("A second deploy after a successful attach still shows the custom domain, with no network call (#1077)")
    func secondDeployAfterAttachStillShowsCustomDomain() async {
        let executor = GatedDeployExecutor()
        // Would fail the test if attachWorkersCustomDomain were called — a deploy whose
        // `.site-config` already records CF_DOMAIN_ATTACHED matching the current DOMAIN must
        // resolve locally, with zero network calls, exactly like the first deploy's zero-network
        // "nothing configured" skip path.
        let writer = FakeDomainAttachWriter(outcome: .attached)
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            markdownForAgentsCommand: MarkdownForAgentsCommand(client: writer),
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_DOMAIN_ATTACHED=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.absoluteString == "https://example.com")
        #expect(model.domainAttachStatus == .confirmed(hostname: "example.com"))
        #expect(writer.attachCallCount == 0)
    }

    @Test("A not-connected domain attach leaves the workers.dev URL in place")
    func notConnectedDomainAttachLeavesWorkersDevURL() async {
        let executor = GatedDeployExecutor()
        let writer = FakeDomainAttachWriter(outcome: .zoneNotFound)
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.host == "test.example.workers.dev")
        #expect(model.domainAttachStatus == .notConnected(hostname: "example.com"))
        #expect(!model.domainConflictPresented)
    }

    @Test("A domain-attach conflict presents the conflict sheet without blocking the succeeded deploy")
    func domainConflictPresentsSheet() async {
        let executor = GatedDeployExecutor()
        let writer = FakeDomainAttachWriter(outcome: .conflict(ownedBy: "other-site"))
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\nDOMAIN_CHOICE=transfer\nDOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded even on a domain conflict, got \(model.phase)"); return
        }
        #expect(model.domainAttachStatus == .conflict(hostname: "example.com", ownedBy: "other-site"))
        #expect(model.domainConflictPresented)

        model.dismissDomainConflict()
        #expect(!model.domainConflictPresented)
    }

    @Test("No transfer domain configured reports .skipped and leaves the workers.dev URL")
    func noTransferDomainSkips() async {
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let url, _) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)"); return
        }
        #expect(url.host == "test.example.workers.dev")
        #expect(model.domainAttachStatus == .skipped)
    }

    @Test("An automatic background deploy defers instead of clobbering a foreground worker-name-conflict sheet (#1076)")
    func backgroundDeployDefersWhileConflictSheetIsPresented() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        // A manual (foreground) deploy parks on the conflict sheet, same as
        // `workerNameConflictParksAndPresents`.
        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }
        guard case .workerNameConflict = model.phase else {
            Issue.record("expected .workerNameConflict, got \(model.phase)"); return
        }
        #expect(model.workerNameConflictPresented)

        // The invisible-publish queue (#357) fires an automatic background deploy for the same
        // site while the sheet is still up — resolved via a non-nil container control so it isn't
        // deferred for the unrelated "runtime not ready" reason.
        let fakeControl = RecordingLocalContainerControl()
        let result = await model.deployAutomatically(
            siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [],
            containerControlProvider: { (siteID: "s", control: fakeControl) }
        )

        guard case .deferred = result else {
            Issue.record("expected the automatic deploy to defer while the conflict sheet is up, got \(result)")
            return
        }
        #expect(model.workerNameConflictPresented, "the foreground conflict sheet must still be showing, not silently dismissed")
        guard case .workerNameConflict = model.phase else {
            Issue.record("expected phase to still be .workerNameConflict, got \(model.phase)"); return
        }
    }

    @Test("An invalid rename target surfaces a plain-language error instead of the raw error enum")
    func renameWithInvalidNameSurfacesPlainLanguageError() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! #"name = "my-site""#.write(to: siteDir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }
        guard case .workerNameConflict = model.phase else {
            Issue.record("expected .workerNameConflict before renaming, got \(model.phase)"); return
        }

        await model.renameWorkerAndRetry("bad name!")

        #expect(!model.isRunning)
        #expect(model.workerNameConflictPresented)
        #expect(model.workerNameConflictError == "Worker names can only contain letters, numbers, hyphens, and underscores.")
    }

    @Test("Cancelling the conflict prompt clears the parked deploy and dismisses the sheet")
    func cancelClearsPendingDeploy() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        model.cancelWorkerNameConflictPrompt()

        #expect(!model.workerNameConflictPresented)
        // A subsequent rename attempt with nothing parked must fail gracefully, not crash.
        await model.renameWorkerAndRetry("anything")
        #expect(!model.isRunning)
        #expect(model.workerNameConflictError == "No deploy is waiting — close this and click Deploy again.")
    }

    @Test("a site with no active workers still deploys through the plain static path")
    func staticSiteDeploysUnaffected() async throws {
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let contentGraph = SiteContentGraph()
        let model = DeployModel(
            command: command,
            logCenter: LogCenter(),
            suddenTerminationController: SuddenTerminationController(disable: {}, enable: {}),
            tokenAvailabilityOverride: { true },
            contentGraph: contentGraph,
            workerCatalog: { [] }
        )
        let dir = try temporaryDirectory()

        // Unlike the worker-name-conflict tests, this deploy has no active workers and no
        // pre-existing name collision, so it genuinely reaches the real `.build` step (no
        // short-circuit) — wait for the executor to park there, then resume it, mirroring
        // `suddenTerminationLeaseBracketsDeploy`. Resuming before the build step is reached
        // (as the conflict tests do defensively) would resume nothing and hang this deploy
        // forever.
        model.deploy(siteID: "test-site", siteDirectory: dir, configDirectory: dir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded = model.phase else {
            Issue.record("Expected deploy to succeed, got \(model.phase)")
            return
        }
    }

    @Test("a settings-activated worker without a container fails at provisioning rather than skipping composition")
    func activatingAWorkerWithoutContainerFailsAtProvisioning() async throws {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let contentGraph = SiteContentGraph()
        let catalog = [
            WorkerDescriptor(
                id: "indieauth", displayName: "IndieAuth", description: "d", group: "identity",
                binding: .settingsActivated, resources: .init(needsD1: true, needsKV: false, needsR2: false)
            )
        ]
        let model = DeployModel(
            command: command,
            logCenter: LogCenter(),
            suddenTerminationController: SuddenTerminationController(disable: {}, enable: {}),
            tokenAvailabilityOverride: { true },
            contentGraph: contentGraph,
            workerCatalog: { catalog }
        )
        let dir = try temporaryDirectory()
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let configStore = SiteConfigStore(configDirectory: configDir)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))

        model.deploy(siteID: "test-site", siteDirectory: dir, configDirectory: configDir, currentRoutes: [])
        while model.isRunning { await Task.yield() }

        // provision() has no working runner outside a container (Task 5's ContainerCommandRunner
        // requires a real LocalContainerControl) — without containerControl this deploy is
        // expected to fail at the D1-provisioning step, NOT silently skip worker composition.
        guard case .failed = model.phase else {
            Issue.record("Expected a provisioning failure without a container, got \(model.phase)")
            return
        }
    }

    @Test("an active worker with no matching catalog entry logs a warning instead of deploying silently")
    func emptyCatalogWithActiveWorkerWarnsInDebugPane() async throws {
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let contentGraph = SiteContentGraph()
        let logCenter = LogCenter()
        let model = DeployModel(
            command: command,
            logCenter: logCenter,
            suddenTerminationController: SuddenTerminationController(disable: {}, enable: {}),
            tokenAvailabilityOverride: { true },
            contentGraph: contentGraph,
            workerCatalog: { [] }
        )
        let dir = try temporaryDirectory()
        let configDir = dir.appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let configStore = SiteConfigStore(configDirectory: configDir)
        try await configStore.save(SiteSettings(activeWorkerIDs: ["indieauth"]))

        // With no catalog entry to resolve "indieauth" against, `workers` ends up empty — same
        // D1/KV-free path as a genuinely static site, so this reaches the build step and
        // succeeds like `staticSiteDeploysUnaffected` — but it must also warn, unlike that case.
        model.deploy(siteID: "test-site", siteDirectory: dir, configDirectory: configDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded = model.phase else {
            Issue.record("Expected deploy to succeed, got \(model.phase)")
            return
        }
        let lines = await logCenter.snapshot()
        #expect(lines.contains { $0.text.contains("no catalog entry for active worker(s) indieauth") })
    }

    // MARK: - containerControlProvider (#823)

    @Test("a container control resolved via containerControlProvider routes deploy execs through it")
    func containerControlProviderRoutesToContainer() async throws {
        let fake = RecordingLocalContainerControl()
        let command = DeployCommand(tokenSource: { "test-token" })
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let dir = try temporaryDirectory()

        model.deploy(
            siteID: "s", siteDirectory: dir, configDirectory: dir, currentRoutes: [],
            containerControlProvider: { (siteID: "s", control: fake) })
        while model.isRunning { await Task.yield() }

        let calls = await fake.execCalls
        #expect(!calls.isEmpty, "expected the deploy to route at least one step through the resolved container control")
    }

    /// The provider — not a resolved snapshot — is what's parked across a token-prompt/rename
    /// retry (#823): a stale container-control tuple captured back when the sheet first appeared
    /// could point at a container that has since restarted or stopped. Reusing the same
    /// worker-name-conflict-then-rename flow as `renameAndRetrySucceedsUnderNewName`, this asserts
    /// the provider closure itself is invoked again on the retry rather than replayed from a cache.
    @Test("containerControlProvider is re-invoked on a rename-and-retry, not replayed from the original resolution")
    func containerControlProviderIsReinvokedOnRetry() async {
        let executor = GatedDeployExecutor()
        await executor.resumeBuild()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            // "my-site" is taken; "my-site-2" (what the retry submits) is free.
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: executor
        )
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        try! #"name = "my-site""#.write(to: siteDir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        try! "CF_PROJECT_NAME=my-site\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let providerCalls = ProviderCallCounter()
        model.deploy(
            siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [],
            containerControlProvider: {
                await providerCalls.increment()
                return nil
            })
        while model.isRunning { await Task.yield() }
        guard case .workerNameConflict = model.phase else {
            Issue.record("expected .workerNameConflict before renaming, got \(model.phase)"); return
        }
        #expect(await providerCalls.count == 1)

        await model.renameWorkerAndRetry("my-site-2")
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded after rename-and-retry, got \(model.phase)"); return
        }
        #expect(await providerCalls.count == 2)
    }

    @Test("wasFirstDeploy is true only when CF_WORKER_DEPLOYED was absent before this deploy")
    func wasFirstDeployReflectsPriorDeployHistory() async {
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let model = DeployModel(command: command, logCenter: LogCenter(), tokenAvailabilityOverride: { true })
        let siteDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }
        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded on first deploy, got \(model.phase)"); return
        }
        #expect(model.wasFirstDeploy)

        model.deploy(siteID: "s", siteDirectory: siteDir, configDirectory: siteDir, currentRoutes: [])
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }
        guard case .succeeded = model.phase else {
            Issue.record("expected .succeeded on second deploy, got \(model.phase)"); return
        }
        #expect(!model.wasFirstDeploy)
    }

    @Test("an OAuth credential in the keychain lets a deploy proceed without the sign-in sheet")
    func oauthCredentialSatisfiesHasUsableToken() async {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let keychain = InMemorySecretStore()
        try? keychain.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "already-signed-in", refreshToken: nil, expiresAt: nil,
            tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!))
        let model = DeployModel(command: command, logCenter: LogCenter(), keychain: keychain)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])
        // `resumeBuild()` must come AFTER the build step is actually reached — calling it before
        // `deploy()` starts is a no-op (`buildContinuation` is still nil at that point) and leaves
        // the real gated continuation, set later inside `runDeploy`, waiting forever. Same fix
        // applies below in `signInSuccessPersistsAndDispatches`.
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        #expect(!model.tokenPromptPresented)
    }

    @Test("an expired OAuth credential with no refresh token re-presents the sign-in sheet")
    func deadOAuthCredentialDoesNotSatisfyHasUsableToken() async {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let keychain = InMemorySecretStore()
        // Definitely unrefreshable: expired in the past, and no refresh token to fall back on
        // (e.g. Cloudflare's OAuth never issued one for this client — a real open item).
        try? keychain.writeCloudflareOAuthCredential(CloudflareOAuthCredential(
            accessToken: "dead-access-token", refreshToken: nil,
            expiresAt: Date().addingTimeInterval(-3600),
            tokenEndpoint: URL(string: "https://dash.cloudflare.com/oauth2/token")!))
        let model = DeployModel(command: command, logCenter: LogCenter(), keychain: keychain)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])

        #expect(model.tokenPromptPresented)
        #expect(!model.isRunning)
    }

    @Test("signInWithCloudflare persists the credential and dispatches the parked deploy on success")
    func signInSuccessPersistsAndDispatches() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let executor = GatedDeployExecutor()
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)
        let keychain = InMemorySecretStore()
        let client = CloudflareOAuthClient(
            scope: "workers_scripts",
            discoveryURL: URL(string: "https://dash.cloudflare.com/.well-known/openid-configuration")!,
            transport: { req in
                let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                if req.url?.path == "/.well-known/openid-configuration" {
                    let json = #"{"authorization_endpoint":"https://dash.cloudflare.com/oauth2/auth","token_endpoint":"https://dash.cloudflare.com/oauth2/token"}"#
                    return (Data(json.utf8), response)
                }
                let body = #"{"access_token":"new-oauth-tok","token_type":"bearer","expires_in":3600,"refresh_token":"new-refresh"}"#
                return (Data(body.utf8), response)
            })
        let oauthSignIn = CloudflareOAuthSignIn(client: client, present: { authorizeURL in
            let state = URLComponents(url: authorizeURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "state" }?.value ?? ""
            return URL(string: "https://auth.anglesite.dwk.io/oauth-callback?code=auth-code&state=\(state)")!
        })
        let model = DeployModel(
            command: command, logCenter: LogCenter(), keychain: keychain,
            verifier: StubTokenVerifying(result: .success(CloudflareAccount(name: "Acme Co.", email: nil))),
            oauthSignIn: oauthSignIn)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])
        #expect(model.tokenPromptPresented)

        // `signInWithCloudflare()` internally calls `deploy(...)` again once sign-in succeeds,
        // which is what actually launches the (previously never-started) build step this time —
        // `deploy()` doesn't await its own dispatched Task, so this `await` returns before the
        // build step is reached. Wait for it to actually park before resuming it (see the note in
        // `oauthCredentialSatisfiesHasUsableToken` above for why the ordering matters).
        await model.signInWithCloudflare()
        await executor.waitUntilBuildIsParked()
        await executor.resumeBuild()
        while model.isRunning { await Task.yield() }

        #expect(!model.tokenPromptPresented)
        #expect(try keychain.readCloudflareOAuthCredential()?.accessToken == "new-oauth-tok")
        guard case .succeeded = model.phase else {
            Issue.record("expected the parked deploy to run after sign-in, got \(model.phase)"); return
        }
    }

    @Test("signInWithCloudflare keeps the sheet open with a message on failure")
    func signInFailureStaysOnSheet() async {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let command = DeployCommand(tokenSource: { "test-token" }, executor: GatedDeployExecutor())
        struct Boom: Error {}
        let client = CloudflareOAuthClient(
            scope: "workers_scripts",
            discoveryURL: URL(string: "https://dash.cloudflare.com/.well-known/openid-configuration")!,
            transport: { _ in throw Boom() })
        let oauthSignIn = CloudflareOAuthSignIn(client: client, present: { _ in throw Boom() })
        let model = DeployModel(command: command, logCenter: LogCenter(), oauthSignIn: oauthSignIn)
        let directory = FileManager.default.temporaryDirectory

        model.deploy(siteID: "s", siteDirectory: directory, configDirectory: directory, currentRoutes: [])
        await model.signInWithCloudflare()

        #expect(model.tokenPromptPresented)
        guard case .failed = model.tokenVerification else {
            Issue.record("expected .failed, got \(model.tokenVerification)"); return
        }
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployModelTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

/// Thread-safe invocation counter for a `DeployModel.ContainerControlProvider` under test —
/// proves the provider closure itself (not a resolved value) crosses the token-prompt/rename
/// retry boundary (#823).
private actor ProviderCallCounter {
    private(set) var count = 0
    func increment() { count += 1 }
}

/// A `LocalContainerControl` that records every `exec` call's siteID/argv, so a test can assert
/// deploy steps actually routed through the control resolved via `containerControlProvider`
/// rather than the host path. Mirrors `FakeLocalContainerControl` in `AnglesiteCoreTests` (not
/// reusable here directly — it lives in a different test target).
private actor RecordingLocalContainerControl: LocalContainerControl {
    private(set) var execCalls: [(siteID: String, argv: [String])] = []

    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw LocalContainerError.virtualizationUnavailable
    }

    func stop(siteID: String) async throws {}

    func startWorkersDev(
        siteID: String, workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:3")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    func exec(
        siteID: String, argv: [String], environment: [String: String], workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        execCalls.append((siteID: siteID, argv: argv))
        // Valid scan JSON so a preflight step reached mid-pipeline doesn't just fail parsing —
        // only the routing (was `exec` called at all) matters to this test.
        return ContainerExecResult(exitCode: 0, stdout: #"{"version":1,"ok":true,"failures":[],"warnings":[]}"#, stderr: "")
    }

    func execInteractive(
        siteID: String, argv: [String], environment: [String: String], workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        InteractiveExecHandle(write: { _ in }, terminate: {})
    }
}
