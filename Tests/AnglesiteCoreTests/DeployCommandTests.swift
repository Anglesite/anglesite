import Testing
import Foundation
@testable import AnglesiteCore

struct DeployCommandTests {
    /// A real, existing directory — the host executor `cd`s into the site dir before spawning, so a
    /// nonexistent path would fail `process.run()` before our fixture script even runs.
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    // MARK: Fake executor

    /// A `DeployExecutor` that returns canned `DeployStepResult`s per step, records the
    /// environment it was handed per step, and counts how many times each step ran. Lets the
    /// flow tests drive build→preflight→wrangler without a subprocess.
    private final class FakeExecutor: DeployExecutor, @unchecked Sendable {
        struct Call: Sendable { let step: DeployStep; let environment: [String: String]; let source: String }

        private let lock = NSLock()
        private var byStep: [String: DeployStepResult] = [:]
        private(set) var calls: [Call] = []
        /// Optional hook fired (inside `run`) when a given step runs — used to assert a step is
        /// NOT reached (the parallel to the old `confirmation(expectedCount: 0)` resolver guards).
        private var onRun: [String: @Sendable () -> Void] = [:]
        /// Fed back by `reportOwnedPathClaims()` — #744's pre-build well-known collision check.
        private var runtimeClaims: [RuntimeOwnedPathClaim] = []

        init() {}

        @discardableResult
        func withRuntimeClaims(_ claims: [RuntimeOwnedPathClaim]) -> FakeExecutor {
            lock.lock(); runtimeClaims = claims; lock.unlock()
            return self
        }

        func reportOwnedPathClaims() async -> [RuntimeOwnedPathClaim] {
            lock.lock(); defer { lock.unlock() }
            return runtimeClaims
        }

        private func key(_ step: DeployStep) -> String {
            switch step {
            case .build: return "build"
            case .preflight: return "preflight"
            case .wrangler: return "wrangler"
            case .bundleUpload: return "bundleUpload"
            }
        }

        @discardableResult
        func set(_ step: DeployStep, exitCode: Int32?, output: String) -> FakeExecutor {
            lock.lock(); byStep[key(step)] = DeployStepResult(exitCode: exitCode, output: output); lock.unlock()
            return self
        }

        @discardableResult
        func onRun(_ step: DeployStep, _ body: @escaping @Sendable () -> Void) -> FakeExecutor {
            lock.lock(); onRun[key(step)] = body; lock.unlock()
            return self
        }

        func ran(_ step: DeployStep) -> Bool {
            lock.lock(); defer { lock.unlock() }
            return calls.contains { key($0.step) == key(step) }
        }

        func environment(for step: DeployStep) -> [String: String]? {
            lock.lock(); defer { lock.unlock() }
            return calls.first { key($0.step) == key(step) }?.environment
        }

        func run(step: DeployStep, siteDirectory: URL, environment: [String: String], source: String) async -> DeployStepResult {
            lock.lock()
            calls.append(Call(step: step, environment: environment, source: source))
            let hook = onRun[key(step)]
            let result = byStep[key(step)] ?? DeployStepResult(exitCode: 0, output: "")
            lock.unlock()
            hook?()
            return result
        }
    }

    /// Build the JSON payload the plugin's `pre-deploy-check.ts --json` emits.
    private func scanJSON(ok: Bool) -> String {
        ok ? #"{"version":1,"ok":true,"failures":[],"warnings":[]}"#
           : #"{"version":1,"ok":false,"failures":[{"category":"pii-email","message":"email","file":"dist/index.html","remediation":"wrap it"}],"warnings":[]}"#
    }

    @Test("default host resolvers fail explicitly after host Node retirement")
    func defaultHostResolversUnavailable() async {
        #expect(
            DeployCommand.resolveBuildCommand(tmpDir)
                == .unavailable(reason: "site build must run in the container runtime; host Node has been retired")
        )
        #expect(
            DeployCommand.resolveWranglerCommand(tmpDir)
                == .unavailable(reason: "wrangler deploy must run in the container runtime; host Node has been retired")
        )
        #expect(
            await DeployCommand.defaultPreflight(tmpDir)
                == .error(reason: "pre-deploy check must run in the container runtime; host Node has been retired")
        )
    }

    // MARK: Full flow through the fake executor

    @Test("Drives build → preflight → wrangler and succeeds with the extracted URL")
    func fullFlowSucceeds() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "building…")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published angle-app (1.23 sec)\n  https://angle-app.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: tmpDir)
        guard case .succeeded(let url, let duration) = result else {
            Issue.record("expected .succeeded, got \(result)"); return
        }
        #expect(url == URL(string: "https://angle-app.example.workers.dev")!)
        #expect(duration >= 0)
        #expect(exec.ran(.build) && exec.ran(.preflight) && exec.ran(.wrangler))
    }

    @Test("Environment contract: build/preflight get no token, wrangler gets CLOUDFLARE_API_TOKEN")
    func environmentContractPerStep() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(tokenSource: { "secret-tok" }, executor: exec)
        _ = await cmd.deploy(siteID: "s", siteDirectory: tmpDir)
        #expect(exec.environment(for: .build)?["CLOUDFLARE_API_TOKEN"] == nil)
        #expect(exec.environment(for: .preflight)?["CLOUDFLARE_API_TOKEN"] == nil)
        #expect(exec.environment(for: .wrangler)?["CLOUDFLARE_API_TOKEN"] == "secret-tok")
    }

    // MARK: #744 well-known collision check

    /// A fresh temp site directory (unlike the shared `tmpDir`, isolated per test) with the given
    /// `public/.well-known/<relative path>: content` files written.
    private func makeWellKnownSiteDirectory(wellKnownFiles: [String: String] = [:]) throws -> URL {
        let siteDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployCommandTests-\(UUID().uuidString)", isDirectory: true)
        let wellKnownDir = siteDirectory.appendingPathComponent("public/.well-known", isDirectory: true)
        try FileManager.default.createDirectory(at: wellKnownDir, withIntermediateDirectories: true)
        for (relativePath, content) in wellKnownFiles {
            let fileURL = wellKnownDir.appendingPathComponent(relativePath)
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
        }
        return siteDirectory
    }

    @Test("a committed static file colliding with a runtime-reported claim blocks before build runs")
    func wellKnownCollisionBlocksBeforeBuild() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory(wellKnownFiles: ["acme-challenge/mine": "token"])
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = FakeExecutor()
            .withRuntimeClaims([RuntimeOwnedPathClaim(
                id: "acme", owner: "cloudflare-managed-tls", path: "acme-challenge/", match: .prefix,
                capability: "RFC 8555 managed-TLS ownership")])
            .set(.build, exitCode: 0, output: "should not run")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDirectory)
        guard case .blocked(let failures, _) = result else {
            Issue.record("expected .blocked, got \(result)"); return
        }
        #expect(failures.count == 1)
        #expect(failures.first?.category == .wellKnownCollision)
        #expect(failures.first?.message.contains("acme-challenge/mine") == true)
        #expect(!exec.ran(.build), "a declared collision must block before spending time on a build")
    }

    @Test("an active dynamic route claim colliding with a runtime reservation blocks before build")
    func wellKnownDynamicRuntimeCollisionBlocks() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = FakeExecutor()
            .withRuntimeClaims([RuntimeOwnedPathClaim(
                id: "acme", owner: "cloudflare-managed-tls", path: "acme-challenge/", match: .prefix,
                capability: "RFC 8555 managed-TLS ownership")])
            .set(.build, exitCode: 0, output: "should not run")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let claim = WorkerRouteClaims.OwnedClaim(
            owner: "some-worker",
            claim: WorkerRouteClaim(path: "/.well-known/acme-challenge/http-01", match: .exact, methods: ["GET"], handler: "h"))
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDirectory, wellKnownDynamicClaims: [claim])
        guard case .blocked = result else {
            Issue.record("expected .blocked, got \(result)"); return
        }
        #expect(!exec.ran(.build))
    }

    @Test("a rejected well-known file (symlink) becomes an advisory warning, not a blocker")
    func wellKnownScanFindingBecomesWarning() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let wellKnownDir = siteDirectory.appendingPathComponent("public/.well-known", isDirectory: true)
        let outside = siteDirectory.appendingPathComponent("secret")
        try "shh".write(to: outside, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(
            at: wellKnownDir.appendingPathComponent("linked"), withDestinationURL: outside)

        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        var observedOutcome: PreDeployCheck.Outcome?
        let result = await cmd.deploy(
            siteID: "s", siteDirectory: siteDirectory,
            onPreflight: { observedOutcome = $0 })
        guard case .succeeded = result else {
            Issue.record("expected .succeeded (a rejected file is advisory, not blocking), got \(result)"); return
        }
        guard case .passed(let warnings) = observedOutcome else {
            Issue.record("expected .passed with warnings, got \(String(describing: observedOutcome))"); return
        }
        #expect(warnings.contains { $0.category == .wellKnownArtifact })
        #expect(exec.ran(.build) && exec.ran(.preflight) && exec.ran(.wrangler))
    }

    @Test("no well-known content and no claims deploys unaffected")
    func wellKnownCheckIsNoOpWhenEmpty() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDirectory)
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)"); return
        }
    }

    // MARK: #744/#748 build-seam wiring

    /// A `DeployExecutor` that implements the well-known build seam, records the manifest it was
    /// handed, and returns a canned outcome. Everything else delegates to the plain fake.
    private final class SeamExecutor: DeployExecutor, @unchecked Sendable {
        private let inner = FakeExecutor()
        private let lock = NSLock()
        private var outcome: WellKnownBuildSeamOutcome = .unsupported
        private(set) var receivedManifest: WellKnownClaimManifest?

        @discardableResult
        func returning(_ outcome: WellKnownBuildSeamOutcome) -> SeamExecutor {
            lock.lock(); self.outcome = outcome; lock.unlock()
            return self
        }

        @discardableResult
        func set(_ step: DeployStep, exitCode: Int32?, output: String) -> SeamExecutor {
            inner.set(step, exitCode: exitCode, output: output)
            return self
        }

        func ran(_ step: DeployStep) -> Bool { inner.ran(step) }

        func run(step: DeployStep, siteDirectory: URL, environment: [String: String], source: String) async -> DeployStepResult {
            await inner.run(step: step, siteDirectory: siteDirectory, environment: environment, source: source)
        }

        func runBuildWithClaimManifest(
            siteDirectory: URL, environment: [String: String], source: String, claimManifest: WellKnownClaimManifest
        ) async -> WellKnownBuildSeamOutcome {
            lock.lock(); receivedManifest = claimManifest; let outcome = self.outcome; lock.unlock()
            return outcome
        }
    }

    /// The whole point of the seam: the orchestrator owns the complete inventory (Worker activation
    /// lives in `Config/`, provider capabilities are host-side), so the runtime can only rescan its
    /// clone against what it is handed.
    @Test("the derived claim manifest carries every effective claim with its delivery class")
    func seamManifestCarriesEffectiveClaims() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory(wellKnownFiles: ["humans.txt": "hi"])
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = SeamExecutor()
            .returning(.completed(DeployStepResult(exitCode: 0, output: ""), WellKnownBuildSeamResult(
                observedArtifacts: ["humans.txt"])))
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let claim = WorkerRouteClaims.OwnedClaim(
            owner: "webfinger",
            claim: WorkerRouteClaim(path: "/.well-known/webfinger", match: .exact, methods: ["GET"], handler: "h"))

        _ = await DeployCommand(tokenSource: { "tok" }, executor: exec)
            .deploy(siteID: "s", siteDirectory: siteDirectory, wellKnownDynamicClaims: [claim])

        let entries = try #require(exec.receivedManifest?.entries)
        #expect(entries.contains { $0.path == "humans.txt" && $0.delivery == "userStatic" })
        #expect(entries.contains { $0.path == "webfinger" && $0.delivery == "dynamic" && $0.owner == "webfinger" })
        #expect(!exec.ran(.build), "the seam replaces the plain build step, it doesn't run alongside it")
    }

    @Test("an executor without the seam falls back to the plain build step")
    func seamUnsupportedFallsBackToPlainBuild() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = SeamExecutor()
            .returning(.unsupported)
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")

        let result = await DeployCommand(tokenSource: { "tok" }, executor: exec)
            .deploy(siteID: "s", siteDirectory: siteDirectory)

        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        #expect(exec.ran(.build))
    }

    @Test("a collision the runtime found in its own clone blocks the deploy with both owners named")
    func seamRuntimeCollisionBlocks() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = SeamExecutor()
            .returning(.completed(
                DeployStepResult(exitCode: 1, output: "build failed"),
                WellKnownBuildSeamResult(findings: [.init(
                    path: "webfinger",
                    message: ".well-known/webfinger (static file in the site source) collides with /.well-known/webfinger claimed by webfinger (dynamic)")])))
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))

        var observedOutcome: PreDeployCheck.Outcome?
        let result = await DeployCommand(tokenSource: { "tok" }, executor: exec)
            .deploy(siteID: "s", siteDirectory: siteDirectory, onPreflight: { observedOutcome = $0 })

        guard case .blocked(let failures, _) = result else {
            Issue.record("expected .blocked, got \(result)"); return
        }
        #expect(failures.count == 1)
        #expect(failures.first?.category == .wellKnownCollision)
        #expect(failures.first?.file == "public/.well-known/webfinger")
        #expect(failures.first?.message.contains("claimed by webfinger (dynamic)") == true)
        if case .blocked = observedOutcome {} else {
            Issue.record("expected the preflight observer to see .blocked, got \(String(describing: observedOutcome))")
        }
        #expect(!exec.ran(.preflight), "a collision stops the deploy before the security scan runs")
    }

    /// An ordinary build failure carries no findings; it must stay a plain `.failed`, not get
    /// dressed up as a security block.
    @Test("a build failure with no seam findings stays a plain failure")
    func seamBuildFailureWithoutFindingsIsNotBlocked() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = SeamExecutor()
            .returning(.completed(DeployStepResult(exitCode: 2, output: "syntax error"), WellKnownBuildSeamResult()))

        let result = await DeployCommand(tokenSource: { "tok" }, executor: exec)
            .deploy(siteID: "s", siteDirectory: siteDirectory)

        guard case .failed(_, let exitCode) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(exitCode == 2)
    }

    @Test("a static claim missing from the built output becomes an advisory warning")
    func seamMissingArtifactBecomesWarning() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory(wellKnownFiles: ["humans.txt": "hi"])
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = SeamExecutor()
            .returning(.completed(DeployStepResult(exitCode: 0, output: ""), WellKnownBuildSeamResult()))
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")

        var observedOutcome: PreDeployCheck.Outcome?
        let result = await DeployCommand(tokenSource: { "tok" }, executor: exec)
            .deploy(siteID: "s", siteDirectory: siteDirectory, onPreflight: { observedOutcome = $0 })

        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        guard case .passed(let warnings) = observedOutcome else {
            Issue.record("expected .passed with warnings, got \(String(describing: observedOutcome))"); return
        }
        #expect(warnings.contains {
            $0.category == .wellKnownArtifact && $0.file == "dist/.well-known/humans.txt"
        })
    }

    @Test("a cancelled seam build reports termination rather than a spurious failure reason")
    func seamCancelledBuildTerminates() async throws {
        let siteDirectory = try makeWellKnownSiteDirectory()
        defer { try? FileManager.default.removeItem(at: siteDirectory) }
        let exec = SeamExecutor().returning(.cancelled)

        let result = await DeployCommand(tokenSource: { "tok" }, executor: exec)
            .deploy(siteID: "s", siteDirectory: siteDirectory)

        #expect(result == .failed(reason: "build was terminated", exitCode: nil))
    }

    // MARK: Host environment curation

    @Test("hostDeployEnvironment retains PATH, HOME, and CI")
    func hostEnvRetainsEssentials() {
        let env = DeployCommand.hostDeployEnvironment([
            "PATH": "/usr/bin:/bin",
            "HOME": "/Users/dev",
            "CI": "true",
            "UNRELATED_SECRET": "leaked",
        ])
        #expect(env["PATH"] == "/usr/bin:/bin")
        #expect(env["HOME"] == "/Users/dev")
        #expect(env["CI"] == "true")
        #expect(env["UNRELATED_SECRET"] == nil)
    }

    @Test("hostDeployEnvironment excludes unrelated secrets")
    func hostEnvExcludesSecrets() {
        let env = DeployCommand.hostDeployEnvironment([
            "PATH": "/usr/bin",
            "HOME": "/tmp",
            "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "GITHUB_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "NPM_TOKEN": "npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "DATABASE_URL": "postgres://user:pass@host/db",
        ])
        #expect(env["AWS_SECRET_ACCESS_KEY"] == nil, "AWS key must not leak into build/preflight")
        #expect(env["GITHUB_TOKEN"] == nil, "GitHub token must not leak into build/preflight")
        #expect(env["NPM_TOKEN"] == nil, "npm token must not leak into build/preflight")
        #expect(env["DATABASE_URL"] == nil, "database URL must not leak into build/preflight")
        #expect(env["PATH"] == "/usr/bin", "PATH must be retained")
        #expect(env["HOME"] == "/tmp", "HOME must be retained")
    }

    @Test("hostDeployEnvironment excludes CLOUDFLARE_API_TOKEN")
    func hostEnvExcludesCloudflareToken() {
        let env = DeployCommand.hostDeployEnvironment([
            "PATH": "/usr/bin",
            "CLOUDFLARE_API_TOKEN": "cf-secret-token",
        ])
        #expect(env["CLOUDFLARE_API_TOKEN"] == nil,
                "CLOUDFLARE_API_TOKEN must not reach build/preflight — it's added only to the wrangler step")
        #expect(env["PATH"] == "/usr/bin")
    }

    @Test("hostDeployEnvironment passes through PUBLIC_*, VITE_*, and ASTRO_* prefixed vars")
    func hostEnvPassesThroughBuildPrefixes() {
        let env = DeployCommand.hostDeployEnvironment([
            "PATH": "/usr/bin",
            "PUBLIC_API_URL": "https://api.example.com",
            "PUBLIC_SITE_NAME": "My Site",
            "VITE_APP_TITLE": "Title",
            "ASTRO_TELEMETRY_DISABLED": "1",
            "SECRET_KEY": "should-be-stripped",
        ])
        #expect(env["PUBLIC_API_URL"] == "https://api.example.com")
        #expect(env["PUBLIC_SITE_NAME"] == "My Site")
        #expect(env["VITE_APP_TITLE"] == "Title")
        #expect(env["ASTRO_TELEMETRY_DISABLED"] == "1")
        #expect(env["SECRET_KEY"] == nil)
    }

    // MARK: Pre-spawn refusal (no work wasted)

    @Test("Refuses before any step when token source returns nil")
    func refusesBeforeStepsWhenTokenNil() async {
        let exec = FakeExecutor().onRun(.build, { Issue.record("build must not run when token is missing") })
        let cmd = DeployCommand(tokenSource: { nil }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(reason.contains("CLOUDFLARE_API_TOKEN"))
        #expect(exit == nil)
        #expect(!exec.ran(.build))
    }

    @Test("Refuses before any step when token source returns empty string")
    func refusesBeforeStepsWhenTokenEmpty() async {
        let exec = FakeExecutor()
        let cmd = DeployCommand(tokenSource: { "" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, _) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(reason.contains("CLOUDFLARE_API_TOKEN"))
        #expect(!exec.ran(.build))
    }

    // MARK: Build step

    @Test("Fails when build exits non-zero, and does not run preflight or wrangler")
    func failsWhenBuildExitsNonZero() async {
        let exec = FakeExecutor().set(.build, exitCode: 2, output: "astro: type error")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(exit == 2)
        #expect(reason.contains("build") && reason.contains("2"))
        #expect(!exec.ran(.preflight) && !exec.ran(.wrangler))
    }

    @Test("Fails with the executor's reason when build is unavailable (nil exit)")
    func failsWhenBuildUnavailable() async {
        let exec = FakeExecutor().set(.build, exitCode: nil, output: "vendored npm not found — rebuild the app")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, _) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(reason.contains("vendored npm"))
    }

    // MARK: Preflight step

    @Test("Returns blocked and does not run wrangler when preflight JSON blocks")
    func blockedPreflightShortCircuits() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: false))
            .onRun(.wrangler, { Issue.record("wrangler must not run when preflight blocks") })
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .blocked(let failures, _) = result else {
            Issue.record("expected .blocked, got \(result)"); return
        }
        #expect(failures.count == 1)
        #expect(failures[0].category == .piiEmail)
        #expect(failures[0].file == "dist/index.html")
        #expect(!exec.ran(.wrangler))
    }

    @Test("Fails when preflight output is not parseable JSON (and does not run wrangler)")
    func failsWhenPreflightErrors() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 1, output: "Error: tsx not installed")
            .onRun(.wrangler, { Issue.record("wrangler must not run when preflight errored") })
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, _) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(reason.lowercased().contains("pre-deploy scan"))
        #expect(!exec.ran(.wrangler))
    }

    @Test("Fires onPreflight with the resolved outcome")
    func firesOnPreflight() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: #"{"version":1,"ok":true,"failures":[],"warnings":[{"category":"missing-og-image","message":"no og image","remediation":"add one"}]}"#)
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let observed = Mutex<PreDeployCheck.Outcome?>(nil)
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        _ = await cmd.deploy(siteID: "t", siteDirectory: tmpDir, onPreflight: { observed.set($0) })
        guard case .passed(let warnings) = observed.get() else {
            Issue.record("expected .passed outcome observed"); return
        }
        #expect(warnings.first?.category == .missingOgImage)
    }

    // MARK: Wrangler failure surfacing

    @Test("Fails when wrangler exits non-zero")
    func failsWhenWranglerExitsNonZero() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 10, output: "Error: authentication failed")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(exit == 10)
        #expect(reason.contains("10"))
    }

    @Test("Fails semantically when wrangler exits 0 but no published URL")
    func failsWhenZeroExitButNoURL() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Did some thing.\nNo anchor here.")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit) = result else {
            Issue.record("expected .failed, got \(result)"); return
        }
        #expect(exit == 0)
        #expect(reason.lowercased().contains("url"))
    }

    @Test("Ignores URLs before the published anchor")
    func ignoresURLsBeforeAnchor() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "See https://developers.cloudflare.com/workers for help.\nPublished angle-app (1.23 sec)\n  https://angle-app.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .succeeded(let url, _) = result else {
            Issue.record("expected .succeeded, got \(result)"); return
        }
        #expect(url.host == "angle-app.example.workers.dev")
    }

    // MARK: Worker-name collision (#740)

    /// A fresh, empty subdirectory under the system temp dir — distinct from the shared `tmpDir`
    /// (which is the temp root itself, used elsewhere only as a `cd`-able path) because these
    /// tests write real `.site-config` contents that must not leak between test runs.
    private func makeSiteDirectory() -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("A successful deploy writes CF_WORKER_DEPLOYED=true to .site-config")
    func successfulDeployMarksWorkerDeployed() async {
        let siteDir = makeSiteDirectory()
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        let config = (try? String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)) ?? ""
        #expect(SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == "true")
    }

    @Test("CF_WORKER_DEPLOYED and SITE_URL are both written for a .transfer-domain site (#1085)")
    func workerDeployedMarkerNotConfoundedByCustomDomain() async {
        let siteDir = makeSiteDirectory()
        let configURL = siteDir.appendingPathComponent(".site-config")
        try? "DOMAIN=example.com\n".write(to: configURL, atomically: true, encoding: .utf8)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        let config = try! String(contentsOf: configURL, encoding: .utf8)
        // Nothing attaches DOMAIN to a live Worker yet (#1077), so SITE_URL must still be
        // recorded as the real, reachable fallback (#1085) — it's no longer skipped just
        // because a custom domain is configured.
        #expect(SiteConfigFile.value(forKey: "SITE_URL", in: config) == "https://x.workers.dev")
        #expect(SiteConfigFile.value(forKey: "CF_WORKER_DEPLOYED", in: config) == "true")
    }

    /// Writes `.site-config` with the given `CF_PROJECT_NAME` and, if `deployedBefore`, a
    /// `CF_WORKER_DEPLOYED=true` marker — the two inputs `checkWorkerNameConflict` reads.
    private func makeSiteDirectory(projectName: String?, deployedBefore: Bool) -> URL {
        let dir = makeSiteDirectory()
        var lines: [String] = []
        if let projectName { lines.append("CF_PROJECT_NAME=\(projectName)") }
        if deployedBefore { lines.append("CF_WORKER_DEPLOYED=true") }
        if !lines.isEmpty {
            try? (lines.joined(separator: "\n") + "\n")
                .write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        }
        return dir
    }

    @Test("First deploy with a name that already exists remotely returns .workerNameConflict before any step runs")
    func firstDeployNameTakenReturnsConflict() async {
        let siteDir = makeSiteDirectory(projectName: "taken-name", deployedBefore: false)
        let exec = FakeExecutor().onRun(.build, { Issue.record("build must not run on a worker-name conflict") })
        let cmd = DeployCommand(
            tokenSource: { "tok" },
            workerScriptNamesSource: { _ in ["taken-name", "other-site"] },
            executor: exec
        )
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .workerNameConflict(let name) = result else {
            Issue.record("expected .workerNameConflict, got \(result)"); return
        }
        #expect(name == "taken-name")
        #expect(!exec.ran(.build))
    }

    @Test("First deploy with a name that's free proceeds to build")
    func firstDeployNameFreeProceeds() async {
        let siteDir = makeSiteDirectory(projectName: "my-new-site", deployedBefore: false)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(
            tokenSource: { "tok" },
            workerScriptNamesSource: { _ in ["some-other-site"] },
            executor: exec
        )
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        #expect(exec.ran(.build))
    }

    @Test("No CF_PROJECT_NAME in .site-config skips the check entirely (fail open)")
    func noProjectNameSkipsCheck() async {
        let siteDir = makeSiteDirectory(projectName: nil, deployedBefore: false)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(
            tokenSource: { "tok" },
            workerScriptNamesSource: { _ in Issue.record("must not be called when CF_PROJECT_NAME is absent"); return [] },
            executor: exec
        )
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
    }

    @Test("CF_WORKER_DEPLOYED already set skips the check regardless of remote state (no regression on redeploys)")
    func alreadyDeployedSkipsCheck() async {
        let siteDir = makeSiteDirectory(projectName: "my-site", deployedBefore: true)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(
            tokenSource: { "tok" },
            // Even though the name is "taken" by this same call, a redeploy must not be blocked.
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: exec
        )
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
    }

    @Test("CF_WORKER_PROVISIONED already set skips the check regardless of remote state (#1075)")
    func alreadyProvisionedSkipsCheck() async {
        let siteDir = makeSiteDirectory(projectName: "my-site", deployedBefore: false)
        // Marks the name as confirmed-ours without a full deploy ever having succeeded — the
        // signal `SocialWorkerProvisionCommand.provision()` persists once its own pre-provisioning
        // check passes, even if that attempt then fails for an unrelated reason.
        DeployCommand.persistWorkerProvisioned(siteDirectory: siteDir)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(
            tokenSource: { "tok" },
            // Even though the name is "taken" by this same call, a retry of this site's own
            // provisioning must not be blocked.
            workerScriptNamesSource: { _ in ["my-site"] },
            executor: exec
        )
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
    }

    @Test("persistWorkerProvisioned is idempotent and never clears an already-set flag")
    func persistWorkerProvisionedIsIdempotent() {
        let siteDir = makeSiteDirectory()
        DeployCommand.persistWorkerProvisioned(siteDirectory: siteDir)
        DeployCommand.persistWorkerProvisioned(siteDirectory: siteDir)
        let config = try! String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "CF_WORKER_PROVISIONED", in: config) == "true")
    }

    @Test("A thrown error from workerScriptNamesSource fails open and proceeds to build")
    func availabilityCheckErrorFailsOpen() async {
        let siteDir = makeSiteDirectory(projectName: "my-new-site", deployedBefore: false)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published x (0.1 sec)\n  https://x.workers.dev")
        let cmd = DeployCommand(
            tokenSource: { "tok" },
            workerScriptNamesSource: { _ in throw CloudflareError.http(status: 500) },
            executor: exec
        )
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded (fail open), got \(result)"); return }
    }

    @Test("Finds the URL when wrangler uses current Uploaded/Deployed wording instead of Published")
    func findsURLWithUploadedDeployedWording() async {
        // Current wrangler (4.x) no longer prints a "Published" line — it prints separate
        // "Uploaded"/"Deployed" status lines. The workers.dev URL itself is the version-independent
        // signal `extractDeployedURL` should key off.
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: """
                Total Upload: 12.34 KiB / gzip: 5.67 KiB
                Uploaded angle-app (1.23 sec)
                Deployed angle-app triggers (0.45 sec)
                  https://angle-app.example.workers.dev
                Current Version ID: abc-123
                """)
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .succeeded(let url, _) = result else {
            Issue.record("expected .succeeded, got \(result)"); return
        }
        #expect(url.host == "angle-app.example.workers.dev")
    }

    @Test("extractDeployedURL finds a workers.dev URL with no recognized anchor line at all")
    func extractDeployedURLFindsWorkersDevWithoutAnchor() {
        let url = DeployCommand.extractDeployedURL(from: "some future wrangler wording\n  https://angle-app.example.workers.dev\ndone")
        #expect(url?.host == "angle-app.example.workers.dev")
    }

    @Test("extractDeployedURL falls back to the Deployed/Uploaded anchor for a custom-domain deploy with no workers.dev URL")
    func extractDeployedURLCustomDomainAnchorFallback() {
        let url = DeployCommand.extractDeployedURL(from: "Deployed angle-app triggers (0.45 sec)\n  https://example.com")
        #expect(url == URL(string: "https://example.com"))
    }

    @Test("extractDeployedURL prefers the anchored workers.dev URL over an incidental one mentioned earlier")
    func extractDeployedURLIgnoresIncidentalWorkersDevBeforeAnchor() {
        // A workers.dev URL mentioned before the anchor line (e.g. an "you already have a
        // subdomain" notice) must not outrank the actual deploy result after the anchor.
        let url = DeployCommand.extractDeployedURL(from: """
            Note: your account already has a workers.dev subdomain: https://myaccount.workers.dev
            Deployed angle-app triggers (0.45 sec)
              https://angle-app.example.workers.dev
            """)
        #expect(url?.host == "angle-app.example.workers.dev")
    }

    // MARK: Scan report parsing helper

    @Test("parseScanReport maps ok/blocked/error correctly")
    func parseScanReport() {
        if case .passed(let w) = DeployCommand.parseScanReport(output: scanJSON(ok: true), exitCode: 0) {
            #expect(w.isEmpty)
        } else { Issue.record("expected .passed") }

        if case .blocked(let f, _) = DeployCommand.parseScanReport(output: scanJSON(ok: false), exitCode: 0) {
            #expect(f.first?.category == .piiEmail)
        } else { Issue.record("expected .blocked") }

        if case .error(let reason) = DeployCommand.parseScanReport(output: "not json", exitCode: 1) {
            #expect(reason.contains("exit 1"))
        } else { Issue.record("expected .error for non-JSON exit 1") }

        if case .error(let reason) = DeployCommand.parseScanReport(output: "not json", exitCode: 0) {
            #expect(reason.contains("no JSON"))
        } else { Issue.record("expected .error for non-JSON exit 0") }
    }

    // MARK: Host-executor parity (real subprocess via HostDeployExecutor)

    /// One end-to-end test that runs the REAL `HostDeployExecutor` against `/bin/sh` fixtures so the
    /// host spawn/snapshot/parse path stays covered. Per-step resolvers are injected so no vendored
    /// Node bundle is required.
    @Test("Host executor parity: real build + preflight + wrangler sh fixtures → succeeded")
    func hostExecutorParity() async {
        let center = LogCenter()
        let exec = HostDeployExecutor(
            supervisor: ProcessSupervisor(),
            logCenter: center,
            resolveCommand: { step in
                { _ in
                    switch step {
                    case .build:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "echo building; exit 0"])
                    case .preflight:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", #"echo '{"version":1,"ok":true,"failures":[],"warnings":[]}'; exit 0"#])
                    case .wrangler:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "echo 'Published angle-app (1.23 sec)'; echo '  https://angle-app.example.workers.dev'; exit 0"])
                    case .bundleUpload:
                        return .unavailable(reason: "not exercised in this test")
                    }
                }
            }
        )
        let cmd = DeployCommand(tokenSource: { "fake-token" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .succeeded(let url, _) = result else {
            Issue.record("expected .succeeded, got \(result)"); return
        }
        #expect(url == URL(string: "https://angle-app.example.workers.dev")!)
        // Build output reached LogCenter under the build source.
        let lines = await center.snapshot()
        #expect(lines.contains { $0.source == "deploy:mysite:build" && $0.text == "building" })
    }

    @Test("Host executor parity: wrangler step sees CLOUDFLARE_API_TOKEN in its environment")
    func hostExecutorPassesToken() async {
        let center = LogCenter()
        let exec = HostDeployExecutor(
            supervisor: ProcessSupervisor(),
            logCenter: center,
            resolveCommand: { step in
                { _ in
                    switch step {
                    case .build:
                        return .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: [])
                    case .preflight:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", #"echo '{"version":1,"ok":true,"failures":[],"warnings":[]}'"#])
                    case .wrangler:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "echo \"TOKEN=$CLOUDFLARE_API_TOKEN\"; echo 'Published x (0.1 sec)'; echo '  https://x.workers.dev'"])
                    case .bundleUpload:
                        return .unavailable(reason: "not exercised in this test")
                    }
                }
            }
        )
        let cmd = DeployCommand(tokenSource: { "secret-token-abc" }, executor: exec)
        let result = await cmd.deploy(siteID: "mysite", siteDirectory: tmpDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        let lines = await center.snapshot()
        #expect(lines.first(where: { $0.text.contains("TOKEN=") })?.text == "TOKEN=secret-token-abc")
    }

    // MARK: Cancellation (real HostDeployExecutor → SIGTERM)

    /// Poll `center` for a marker line up to `timeout`. Returns true once it appears.
    private func waitForMarker(_ marker: String, in center: LogCenter, timeout: Duration = .seconds(3)) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            if await center.snapshot().contains(where: { $0.text.contains(marker) }) { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return false
    }

    /// Generous budget — see the original note: cancellation resumes `waitForExit` immediately, so
    /// the marker only lands after a chain of fire-and-forget tasks under parallel-test load.
    private static let markerObservationTimeout: Duration = .seconds(30)

    @Test("Cancelling the task actually SIGTERMs the in-flight wrangler subprocess")
    func cancellationTerminatesWrangler() async {
        // Token + build (/usr/bin/true) + preflight pass quickly, then wrangler blocks. Cancelling
        // the deploy must kill wrangler: `.failed(terminated)` AND the process reports the SIGTERM
        // trap. The fixture sets the trap, then echoes __STARTED__ so we cancel exactly once
        // wrangler is running.
        let center = LogCenter()
        let exec = HostDeployExecutor(
            supervisor: ProcessSupervisor(),
            logCenter: center,
            resolveCommand: { step in
                { _ in
                    switch step {
                    case .build:
                        return .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: [])
                    case .preflight:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", #"echo '{"version":1,"ok":true,"failures":[],"warnings":[]}'"#])
                    case .wrangler:
                        return .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "trap 'echo __SIGTERM__; exit 143' TERM; echo __STARTED__; sleep 20; echo __COMPLETED__"])
                    case .bundleUpload:
                        return .unavailable(reason: "not exercised in this test")
                    }
                }
            }
        )
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let dir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let task = Task { await cmd.deploy(siteID: "site", siteDirectory: dir) }
        #expect(await waitForMarker("__STARTED__", in: center, timeout: Self.markerObservationTimeout), "wrangler never started")
        task.cancel()
        let result = await task.value
        guard case .failed(let reason, _) = result else {
            Issue.record("expected .failed(terminated), got \(result)"); return
        }
        #expect(reason.contains("terminated"))
        #expect(await waitForMarker("__SIGTERM__", in: center, timeout: Self.markerObservationTimeout), "wrangler subprocess was not actually SIGTERM'd")
    }

    // MARK: Route coverage (#530)

    @Test("configDirectory nil: no route-coverage warnings, no snapshot write")
    func routeCoverageSkippedWhenNoConfigDirectory() async {
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "building…")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published s (1.0 sec)\n  https://s.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let outcomes = Locked<[PreDeployCheck.Outcome]>([])
        _ = await cmd.deploy(
            siteID: "s", siteDirectory: tmpDir,
            onPreflight: { outcomes.append($0) })
        guard case .passed(let warnings) = outcomes.get().first else {
            Issue.record("expected .passed"); return
        }
        #expect(warnings.isEmpty)
    }

    @Test("orphaned route with no redirect adds a warning to the preflight outcome")
    func orphanedRouteAddsWarning() async {
        let configDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployCommandTests-config-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: configDir) }
        try? DeployedRoutesSnapshot.save(["/about", "/old-page"], to: configDir)

        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "building…")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published s (1.0 sec)\n  https://s.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let outcomes = Locked<[PreDeployCheck.Outcome]>([])
        let result = await cmd.deploy(
            siteID: "s", siteDirectory: tmpDir,
            configDirectory: configDir, currentRoutes: ["/about"],
            onPreflight: { outcomes.append($0) })

        guard case .passed(let warnings) = outcomes.get().first else {
            Issue.record("expected .passed"); return
        }
        #expect(warnings.contains { $0.category == .orphanedRoute && $0.message.contains("/old-page") })
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }
        #expect(DeployedRoutesSnapshot.load(from: configDir) == ["/about"])
    }

    @Test("a route covered by redirects.json does not warn")
    func coveredRouteDoesNotWarn() async {
        let configDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployCommandTests-config-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: configDir) }
        try? DeployedRoutesSnapshot.save(["/about", "/old-page"], to: configDir)
        // A private site directory, NOT the shared `tmpDir`: this test's redirects.json must not
        // be visible to `orphanedRouteAddsWarning`, which reads redirects from its own
        // `siteDirectory` concurrently (suite tests run in parallel).
        let siteDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployCommandTests-site-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try? RedirectsStore(sourceDirectory: siteDir).save(
            [RedirectsStore.RedirectEntry(source: "/old-page", destination: "/about", code: .permanent)])

        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "building…")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published s (1.0 sec)\n  https://s.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let outcomes = Locked<[PreDeployCheck.Outcome]>([])
        _ = await cmd.deploy(
            siteID: "s", siteDirectory: siteDir,
            configDirectory: configDir, currentRoutes: ["/about"],
            onPreflight: { outcomes.append($0) })

        guard case .passed(let warnings) = outcomes.get().first else {
            Issue.record("expected .passed"); return
        }
        #expect(!warnings.contains { $0.category == .orphanedRoute })
    }

    // MARK: SITE_URL persistence (#702)

    private func privateSiteDir() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DeployCommandTests-site-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("a successful deploy writes SITE_URL into .site-config")
    func successfulDeployWritesSiteURL() async {
        let siteDir = privateSiteDir()
        defer { try? FileManager.default.removeItem(at: siteDir) }
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "building…")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published s (1.0 sec)\n  https://s.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }

        let config = try? String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config?.contains("SITE_URL=https://s.example.workers.dev") == true)
    }

    @Test("a custom DOMAIN already in .site-config does not stop SITE_URL from being recorded (#1085)")
    func customDomainDoesNotStopSiteURLPersistence() async {
        let siteDir = privateSiteDir()
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try? "DOMAIN=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let exec = FakeExecutor()
            .set(.build, exitCode: 0, output: "building…")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Published s (1.0 sec)\n  https://s.example.workers.dev")
        let cmd = DeployCommand(tokenSource: { "tok" }, executor: exec)
        let result = await cmd.deploy(siteID: "s", siteDirectory: siteDir)
        guard case .succeeded = result else { Issue.record("expected .succeeded, got \(result)"); return }

        // Nothing in the deploy pipeline actually attaches a custom domain yet (#1077), so
        // `DOMAIN` is never verified to be live — SITE_URL must still be recorded as the real,
        // reachable fallback `DeployCoordinator.resolveSiteURL` prefers (#1085).
        let config = try? String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config?.contains("DOMAIN=example.com") == true)
        #expect(config?.contains("SITE_URL=https://s.example.workers.dev") == true)
    }

    @Test("persistSiteURL upserts without clobbering unrelated keys")
    func persistSiteURLUpsertsInPlace() {
        let siteDir = privateSiteDir()
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try? "SITE_NAME=Acme\nSITE_URL=https://old.example.workers.dev\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        DeployCommand.persistSiteURL(URL(string: "https://new.example.workers.dev")!, siteDirectory: siteDir)

        let config = try! String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SITE_NAME=Acme"))
        #expect(config.contains("SITE_URL=https://new.example.workers.dev"))
        #expect(!config.contains("old.example.workers.dev"))
    }

    @Test("persistSiteURL skips the write once CF_DOMAIN_ATTACHED confirms the configured DOMAIN (#1077)")
    func persistSiteURLSkipsOnceCustomDomainConfirmed() {
        let siteDir = privateSiteDir()
        defer { try? FileManager.default.removeItem(at: siteDir) }
        // Unlike `customDomainDoesNotStopSiteURLPersistence` above (DOMAIN configured but never
        // verified live), CF_DOMAIN_ATTACHED here matches DOMAIN exactly — the same "confirmed"
        // signal `CustomDomainAttachCommand.attach` itself checks — so the custom domain is the
        // site's real, verified address and must not be shadowed by the workers.dev host.
        try? "DOMAIN=example.com\nCF_DOMAIN_ATTACHED=example.com\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        DeployCommand.persistSiteURL(URL(string: "https://new.example.workers.dev")!, siteDirectory: siteDir)

        let config = try! String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(!config.contains("SITE_URL="))
    }

    // MARK: Bundle-upload orchestration (#799)

    @Test("a successful deploy uploads the source bundle when CF_SOURCE_BUCKET is configured")
    func successfulDeployUploadsBundleWhenBucketConfigured() async throws {
        let siteDir = try makeGitRepo()   // see makeGitRepo below for this helper
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try "CF_SOURCE_BUCKET=my-site-source\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let configDir = tmpDir.appendingPathComponent("deploy-config-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: configDir) }

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
            .set(.bundleUpload, exitCode: 0, output: "")
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)

        let result = await command.deploy(siteID: "test", siteDirectory: siteDir, configDirectory: configDir)
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(executor.ran(.bundleUpload))
        #expect(
            executor.environment(for: .bundleUpload)?["CLOUDFLARE_API_TOKEN"] == "test-token",
            "bundle-upload runs `wrangler r2 object put --remote`, which needs the same CLOUDFLARE_API_TOKEN the .wrangler step gets — not the token-stripped base environment"
        )

        let settings = try await SiteConfigStore(configDirectory: configDir).load()
        #expect(settings.deployedSourceBundleCommit != nil)
    }

    @Test("a successful deploy skips the bundle-upload step when CF_SOURCE_BUCKET is not configured")
    func successfulDeploySkipsBundleUploadWithoutBucket() async throws {
        let siteDir = try makeGitRepo()
        defer { try? FileManager.default.removeItem(at: siteDir) }
        // No .site-config at all — matches every real site today (no provisioning writes CF_SOURCE_BUCKET yet).
        let configDir = tmpDir.appendingPathComponent("deploy-config-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: configDir) }

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let command = DeployCommand(tokenSource: { "test-token" }, executor: executor)

        let result = await command.deploy(siteID: "test", siteDirectory: siteDir, configDirectory: configDir)
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(!executor.ran(.bundleUpload))
    }

    /// A minimal real git repo (`git init` + one commit) at a fresh temp directory — the
    /// bundle-upload orchestration reads `Source/`'s HEAD SHA via `InProcessGit`, which needs a
    /// real repository, not just a directory.
    private func makeGitRepo() throws -> URL {
        let dir = tmpDir.appendingPathComponent("deploy-source-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "hello".write(to: dir.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["sh", "-c", "git init -q && git config user.email t@example.com && git config user.name Test && git add -A && git commit -q -m init"]
        process.currentDirectoryURL = dir
        try process.run()
        process.waitUntilExit()
        return dir
    }

    @Test("ContainerDeployExecutor maps .bundleUpload to a tar+wrangler-r2-put argv naming the configured bucket")
    func bundleUploadArgvNamesConfiguredBucket() throws {
        let siteDir = tmpDir.appendingPathComponent("bundle-upload-argv-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try "CF_SOURCE_BUCKET=my-site-source\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let argv = ContainerDeployExecutorTestHook.guestArgv(for: .bundleUpload, siteDirectory: siteDir)
        // The bucket must be a separate positional argv element (passed as `$1` to `sh -c`), not
        // interpolated into the script text — that's what makes it injection-safe (see the
        // adjoining injection test).
        #expect(argv.contains("my-site-source"))
        #expect(argv.contains { $0.contains("wrangler") })
    }

    @Test(
        """
        ContainerDeployExecutor's .bundleUpload argv passes the CF_SOURCE_BUCKET value as a positional \
        shell parameter, so shell metacharacters in it cannot execute as commands
        """
    )
    func bundleUploadArgvIsSafeAgainstShellInjectionInBucketName() throws {
        // `.site-config` is owned by the site (or a future provisioning flow) and its raw value
        // flows straight into `guestArgv` unvalidated — this proves a malicious/malformed bucket
        // name can't break out of the intended tar/wrangler invocation when the produced argv is
        // actually executed by `sh`, not just that the argv strings "look" quoted.
        let siteDir = tmpDir.appendingPathComponent("bundle-upload-injection-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }

        let markerFile = tmpDir.appendingPathComponent("bundle-upload-pwned-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: markerFile) }
        #expect(!FileManager.default.fileExists(atPath: markerFile.path))

        let payload = "my-bucket'; touch \(markerFile.path); echo '"
        try "CF_SOURCE_BUCKET=\(payload)\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let argv = ContainerDeployExecutorTestHook.guestArgv(for: .bundleUpload, siteDirectory: siteDir)
        #expect(argv.contains(payload))

        // Stub `tar`/`npx` on PATH so the script doesn't need a real workspace or network — the
        // point is only to observe whether the shell executes the injected `touch`, not whether
        // the real tar/wrangler commands succeed.
        let binDir = tmpDir.appendingPathComponent("bundle-upload-injection-bin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: binDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: binDir) }
        for name in ["tar", "npx"] {
            let stub = binDir.appendingPathComponent(name)
            try "#!/bin/sh\nexit 0\n".write(to: stub, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: stub.path)
        }

        // argv is ["sh", "-c", script, "sh", bucket] — feed it to a real `sh` exactly as
        // `ContainerDeployExecutor` would hand it to the guest's exec call.
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = Array(argv.dropFirst())
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = binDir.path + ":" + (environment["PATH"] ?? "")
        process.environment = environment
        try process.run()
        process.waitUntilExit()

        #expect(
            !FileManager.default.fileExists(atPath: markerFile.path),
            "shell metacharacters in CF_SOURCE_BUCKET executed as commands — injection is not blocked")
    }

    // MARK: Domain-attach orchestration (#1077)

    @Test("a successful deploy reports .skipped via onDomainAttach when no transfer domain is configured")
    func successfulDeployReportsSkippedWithoutTransferDomain() async throws {
        let siteDir = tmpDir.appendingPathComponent("domain-attach-deploy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let writer = FakeCloudflareWriting()
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            executor: executor
        )

        var observed: CustomDomainAttachCommand.Result?
        let result = await command.deploy(
            siteID: "test", siteDirectory: siteDir,
            onDomainAttach: { observed = $0 }
        )
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(observed == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("a successful deploy reports .confirmed via onDomainAttach and persists CF_DOMAIN_ATTACHED")
    func successfulDeployReportsConfirmedDomainAttach() async throws {
        let siteDir = tmpDir.appendingPathComponent("domain-attach-deploy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let writer = FakeCloudflareWriting()
        writer.result = .success(.attached)
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            executor: executor
        )

        var observed: CustomDomainAttachCommand.Result?
        let result = await command.deploy(
            siteID: "test", siteDirectory: siteDir,
            onDomainAttach: { observed = $0 }
        )
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(observed == .confirmed(hostname: "example.com"))
        let config = try String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CF_DOMAIN_ATTACHED=example.com"))
        // #1124: a domain confirmed attached *in this same deploy* must win immediately —
        // `persistSiteURL` must not overwrite SITE_URL with the workers.dev host and shadow it,
        // or `DeployCoordinator.resolveSiteURL`'s DOMAIN fallback (which `DeployModel`'s
        // succeeded-phase display URL relies on) never sees the custom domain.
        #expect(!config.contains("SITE_URL="))
    }

    @Test("a domain-attach outcome of .notConnected doesn't block the deploy from succeeding")
    func domainNotConnectedDoesNotBlockDeploy() async throws {
        let siteDir = tmpDir.appendingPathComponent("domain-attach-deploy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: siteDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: siteDir) }
        try "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n".write(
            to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        let executor = FakeExecutor()
            .set(.build, exitCode: 0, output: "")
            .set(.preflight, exitCode: 0, output: scanJSON(ok: true))
            .set(.wrangler, exitCode: 0, output: "Deployed my-site (1.2 sec)\n https://my-site.example.workers.dev")
        let writer = FakeCloudflareWriting()
        writer.result = .success(.zoneNotFound)
        let command = DeployCommand(
            tokenSource: { "test-token" },
            customDomainAttachCommand: CustomDomainAttachCommand(client: writer),
            executor: executor
        )

        var observed: CustomDomainAttachCommand.Result?
        let result = await command.deploy(
            siteID: "test", siteDirectory: siteDir,
            onDomainAttach: { observed = $0 }
        )
        guard case .succeeded = result else {
            Issue.record("expected .succeeded even when the domain isn't connected yet, got \(result)")
            return
        }
        #expect(observed == .notConnected(hostname: "example.com"))
    }

    /// Minimal thread-safe box for recording values appended from `@Sendable` closures.
    private final class Locked<T>: @unchecked Sendable {
        private let lock = NSLock(); private var value: T
        init(_ v: T) { value = v }
        func append<E>(_ e: E) where T == [E] { lock.lock(); value.append(e); lock.unlock() }
        func get() -> T { lock.lock(); defer { lock.unlock() }; return value }
    }
}

/// Minimal lock wrapper since `onPreflight` fires from inside `DeployCommand`'s actor
/// isolation and the test needs to observe the value from outside.
private final class Mutex<T>: @unchecked Sendable {
    private var value: T
    private let lock = NSLock()
    init(_ v: T) { value = v }
    func get() -> T { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ v: T) { lock.lock(); value = v; lock.unlock() }
}
