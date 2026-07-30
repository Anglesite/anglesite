import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContainerDeployExecutor")
struct ContainerDeployExecutorTests {

    // MARK: Helpers

    private func makeExecutor(
        fake: FakeLocalContainerControl,
        siteID: String = "site-abc",
        logCenter: LogCenter = LogCenter()
    ) -> ContainerDeployExecutor {
        ContainerDeployExecutor(control: fake, siteID: siteID, logCenter: logCenter)
    }

    private func fakePassing(lines: [String] = []) -> FakeLocalContainerControl {
        FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "ok", stderr: ""),
            execStdoutLines: lines
        )
    }

    // MARK: - argv mapping

    @Test("wrangler step sends correct argv")
    func wranglerArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(
            step: .wrangler,
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: ["CLOUDFLARE_API_TOKEN": "tok123"],
            source: "deploy:site-abc"
        )
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npx", "wrangler", "deploy"])
    }

    @Test("build step sends correct argv")
    func buildArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: [:],
            source: "deploy:site-abc:build"
        )
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npm", "run", "build"])
    }

    @Test("preflight step sends correct argv")
    func preflightArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(
            step: .preflight,
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: [:],
            source: "deploy:site-abc:preflight"
        )
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npx", "tsx", "scripts/pre-deploy-check.ts", "--json"])
    }

    // MARK: - cwd is always /workspace/site

    @Test("exec always uses /workspace/site as working directory")
    func workingDirectory() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host/totally/different"),
            environment: [:],
            source: "src"
        )
        let calls = await fake.execCalls
        #expect(calls[0].cwd == "/workspace/site")
    }

    // MARK: - CLOUDFLARE_API_TOKEN forwarded, not logged

    @Test("wrangler forwards CLOUDFLARE_API_TOKEN in env")
    func wranglerForwardsToken() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(
            step: .wrangler,
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: ["CLOUDFLARE_API_TOKEN": "supersecret"],
            source: "deploy:site-abc"
        )
        let calls = await fake.execCalls
        #expect(calls[0].env["CLOUDFLARE_API_TOKEN"] == "supersecret")
    }

    @Test("host-only env (PATH/HOME/Apple vars) is NOT forwarded into the Linux guest")
    func curatesHostEnvOutOfGuest() async {
        // DeployCommand passes the full host (macOS) environment; the guest must not receive it —
        // a macOS PATH would shadow the guest's Linux PATH and break node/wrangler resolution, and
        // HOME/__CF* are host-only noise. Only deploy-relevant vars (the token) should cross.
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(
            step: .wrangler,
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: [
                "CLOUDFLARE_API_TOKEN": "tok",
                "PATH": "/opt/homebrew/bin:/usr/bin",
                "HOME": "/Users/dev",
                "__CFBundleIdentifier": "com.apple.dt.Xcode"
            ],
            source: "deploy:site-abc"
        )
        let env = await fake.execCalls[0].env
        #expect(env["CLOUDFLARE_API_TOKEN"] == "tok")
        #expect(env["PATH"] == nil)
        #expect(env["HOME"] == nil)
        #expect(env["__CFBundleIdentifier"] == nil)
    }

    @Test("token does not appear in log output")
    func tokenNotLogged() async {
        let logCenter = LogCenter()
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "done", stderr: ""),
            execStdoutLines: ["build complete"]
        )
        let executor = makeExecutor(fake: fake, logCenter: logCenter)
        _ = await executor.run(
            step: .wrangler,
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: ["CLOUDFLARE_API_TOKEN": "mysecrettoken"],
            source: "deploy:site-abc"
        )
        let snapshot = await logCenter.snapshot()
        for line in snapshot {
            #expect(!line.text.contains("mysecrettoken"))
        }
    }

    // MARK: - stdout lines reach LogCenter

    @Test("stdout lines from exec are appended to LogCenter under source")
    func stdoutToLogCenter() async {
        let logCenter = LogCenter()
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "full", stderr: ""),
            execStdoutLines: ["line one", "line two"]
        )
        let executor = makeExecutor(fake: fake, logCenter: logCenter)
        _ = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "deploy:site-abc:build"
        )
        let snapshot = await logCenter.snapshot()
        let texts = snapshot
            .filter { $0.source == "deploy:site-abc:build" }
            .map(\.text)
        #expect(texts.contains("line one"))
        #expect(texts.contains("line two"))
    }

    // MARK: - exit code surfaced

    @Test("non-zero exit code surfaces in DeployStepResult")
    func nonZeroExitCode() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 127, stdout: "not found", stderr: ""),
            execStdoutLines: []
        )
        let executor = makeExecutor(fake: fake)
        let result = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src"
        )
        #expect(result.exitCode == 127)
    }

    @Test("zero exit code surfaces in DeployStepResult")
    func zeroExitCode() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        let result = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src"
        )
        #expect(result.exitCode == 0)
    }

    // MARK: - thrown exec surfaces as nil exitCode

    @Test("thrown exec returns nil exitCode and error message")
    func thrownExecReturnsNilExitCode() async {
        let fake = ThrowingFakeLocalContainerControl()
        let executor = ContainerDeployExecutor(
            control: fake,
            siteID: "site-abc",
            logCenter: LogCenter()
        )
        let result = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src"
        )
        #expect(result.exitCode == nil)
        #expect(result.output.contains("couldn't exec in the container"))
    }

    // MARK: - cancellation does not hang and surfaces termination

    @Test("a cancelled exec resolves (does not hang) and surfaces termination, not an exec error")
    func cancelledExecTerminates() async {
        // The fake's `exec` parks until the running Task is cancelled (then throws CancellationError),
        // mirroring a real long-running guest process that the deploy cancels mid-flight. The deploy
        // task must resolve promptly with a nil exitCode + empty output (the "terminated" signal),
        // NOT hang and NOT bury cancellation under a "couldn't exec" string.
        let fake = CancelParkingFakeContainerControl()
        let executor = ContainerDeployExecutor(control: fake, siteID: "s", logCenter: LogCenter())

        let task = Task {
            await executor.run(
                step: .wrangler,
                siteDirectory: URL(fileURLWithPath: "/host"),
                environment: ["CLOUDFLARE_API_TOKEN": "tok"],
                source: "deploy:s"
            )
        }
        // Let `exec` reach its park point, then cancel.
        await fake.waitUntilParked()
        task.cancel()

        let result = await task.value
        #expect(result.exitCode == nil)
        #expect(result.output.isEmpty, "cancellation must not surface a generic exec-error string")
    }

    // MARK: - siteID forwarded to exec

    @Test("siteID is forwarded to exec")
    func siteIDForwarded() async {
        let fake = fakePassing()
        let executor = ContainerDeployExecutor(
            control: fake,
            siteID: "my-special-site",
            logCenter: LogCenter()
        )
        _ = await executor.run(
            step: .build,
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src"
        )
        let calls = await fake.execCalls
        #expect(calls[0].siteID == "my-special-site")
    }

    // MARK: - #1084: wrangler.toml re-sync before `wrangler deploy`

    /// A real host directory with a `wrangler.toml` on disk, modelling the site's `Source/`
    /// working tree after `SocialWorkerProvisionCommand.persistConfig` has written a
    /// features-enabled config there.
    private func makeHostSiteDirectory(wranglerToml: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try wranglerToml.write(to: dir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        return dir
    }

    @Test("wrangler step re-syncs the host's current wrangler.toml into the guest before deploying")
    func wranglerStepResyncsTomlBeforeDeploy() async throws {
        // Models the exact #1084 scenario: the guest's /workspace/site clone is stale (it was
        // cloned before the site turned on a social feature), but the HOST wrangler.toml — just
        // written by SocialWorkerProvisionCommand.persistConfig — already has `main` and the
        // worker's bindings. Without a re-sync, `wrangler deploy` would run against the guest's
        // stale, assets-only copy and publish a Worker with no script attached at all.
        let freshToml = "name = \"my-site\"\nmain = \"worker/worker.ts\"\n\n[assets]\ndirectory = \"dist\"\n"
        let hostSiteDirectory = try makeHostSiteDirectory(wranglerToml: freshToml)
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)

        let result = await executor.run(
            step: .wrangler,
            siteDirectory: hostSiteDirectory,
            environment: ["CLOUDFLARE_API_TOKEN": "tok123"],
            source: "deploy:site-abc"
        )

        let calls = await fake.execCalls
        #expect(calls.count == 2, "expected a sync exec followed by the deploy exec")

        // First call: writes the fresh host content into the guest's wrangler.toml, never
        // interpolating the content directly into the shell string.
        #expect(calls[0].argv[0] == "sh")
        #expect(calls[0].argv[1] == "-c")
        #expect(calls[0].argv[2].contains("base64 -d > wrangler.toml"))
        #expect(!calls[0].argv[2].contains("main = "), "content must travel base64-encoded, never spliced in literally")
        #expect(calls[0].cwd == "/workspace/site")

        // Decode what was actually sent and confirm it's the fresh host content.
        let script = calls[0].argv[2]
        let base64Part = script
            .replacingOccurrences(of: "echo ", with: "")
            .replacingOccurrences(of: " | base64 -d > wrangler.toml", with: "")
        let decoded = Data(base64Encoded: base64Part).flatMap { String(data: $0, encoding: .utf8) }
        #expect(decoded == freshToml)

        // Second call: the actual deploy, unchanged.
        #expect(calls[1].argv == ["npx", "wrangler", "deploy"])
        #expect(result.exitCode == 0)
    }

    @Test("build and preflight steps do not re-sync wrangler.toml (neither reads it)")
    func nonWranglerStepsSkipResync() async throws {
        let hostSiteDirectory = try makeHostSiteDirectory(wranglerToml: "name = \"my-site\"\n")
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)

        _ = await executor.run(step: .build, siteDirectory: hostSiteDirectory, environment: [:], source: "src")
        _ = await executor.run(step: .preflight, siteDirectory: hostSiteDirectory, environment: [:], source: "src")

        let calls = await fake.execCalls
        #expect(calls.count == 2, "no sync call for either step")
        #expect(calls[0].argv == ["npm", "run", "build"])
        #expect(calls[1].argv == ["npx", "tsx", "scripts/pre-deploy-check.ts", "--json"])
    }

    @Test("wrangler step skips the sync when the host has no wrangler.toml yet")
    func wranglerStepSkipsSyncWhenHostFileMissing() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)

        _ = await executor.run(
            step: .wrangler,
            siteDirectory: URL(fileURLWithPath: "/host/does-not-exist-\(UUID().uuidString)"),
            environment: ["CLOUDFLARE_API_TOKEN": "tok"],
            source: "deploy:site-abc"
        )

        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npx", "wrangler", "deploy"])
    }

    @Test("a failed wrangler.toml sync fails the step without ever attempting `wrangler deploy`")
    func failedSyncPreventsDeploy() async throws {
        let hostSiteDirectory = try makeHostSiteDirectory(wranglerToml: "name = \"my-site\"\n")
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 1, stdout: "", stderr: "disk full")
        )
        let executor = makeExecutor(fake: fake)

        let result = await executor.run(
            step: .wrangler,
            siteDirectory: hostSiteDirectory,
            environment: ["CLOUDFLARE_API_TOKEN": "tok"],
            source: "deploy:site-abc"
        )

        let calls = await fake.execCalls
        #expect(calls.count == 1, "must not fall through to `wrangler deploy` after a failed sync")
        #expect(result.exitCode == nil)
        #expect(result.output.contains("sync"))
    }

    // MARK: - #748 capability defaults

    @Test("HostDeployExecutor reports no owned path claims by default")
    func hostExecutorReportsNoOwnedClaims() async {
        let executor = HostDeployExecutor()
        let claims = await executor.reportOwnedPathClaims()
        #expect(claims.isEmpty)
    }

    @Test("HostDeployExecutor's build seam is unsupported by default")
    func hostExecutorSeamIsUnsupported() async {
        let executor = HostDeployExecutor()
        let outcome = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: [:],
            source: "src",
            claimManifest: WellKnownClaimManifest()
        )
        #expect(outcome == .unsupported)
    }

    // MARK: - #748 build seam: manifest transport in

    @Test("build seam writes the manifest to guest /tmp, never /workspace/site, via a positional-parameter shell script")
    func seamArgvUsesInjectionSafePositionalParameter() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        let manifest = WellKnownClaimManifest(entries: [
            .init(id: "acme", path: "acme-challenge/", match: .prefix, owner: "cloudflare-managed-tls")
        ])
        _ = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            environment: [:],
            source: "src",
            claimManifest: manifest
        )
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        let argv = calls[0].argv
        #expect(argv.count == 5)
        #expect(argv[0] == "sh")
        #expect(argv[1] == "-c")
        #expect(argv[3] == "sh")
        // The script must reference the guest manifest/result paths and the env vars a future
        // build script reads, and must never touch /workspace/site for the manifest itself.
        let script = argv[2]
        #expect(script.contains("/tmp/anglesite-wellknown-manifest.json"))
        #expect(!script.contains("/workspace/site/anglesite-wellknown"))
        #expect(script.contains(WellKnownClaimManifest.environmentVariableName))
        #expect(script.contains(WellKnownClaimManifest.resultPathEnvironmentVariable))
        #expect(script.contains("npm run build"))
        // Cleanup trap covers cancellation/failure per #748's cleanup requirement.
        #expect(script.contains("trap"))
        #expect(script.contains("EXIT INT TERM"))
        // The manifest payload itself travels as $1, a positional parameter — never spliced into
        // the script string — mirroring the existing bundleUpload injection-safety pattern.
        let manifestBase64 = argv[4]
        let decodedData = try? Data(base64Encoded: manifestBase64, options: .ignoreUnknownCharacters).map { $0 }
        #expect(decodedData != nil)
        let decodedManifest = decodedData.flatMap { try? JSONDecoder().decode(WellKnownClaimManifest.self, from: $0) }
        #expect(decodedManifest == manifest)
    }

    @Test("build seam round-trips an empty manifest")
    func seamRoundTripsEmptyManifest() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src",
            claimManifest: WellKnownClaimManifest()
        )
        let argv = await fake.execCalls[0].argv
        let decoded = Data(base64Encoded: argv[4], options: .ignoreUnknownCharacters)
            .flatMap { try? JSONDecoder().decode(WellKnownClaimManifest.self, from: $0) }
        #expect(decoded == WellKnownClaimManifest())
    }

    // MARK: - #748 build seam: output round trip

    @Test("build seam parses the marker-delimited result blob out of stdout")
    func seamParsesResultBlob() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(
                exitCode: 0,
                stdout: """
                building...
                done
                ---ANGLESITE-WELLKNOWN-RESULT---
                {"observedArtifacts":["security.txt"],"findings":[]}
                """,
                stderr: ""
            )
        )
        let executor = makeExecutor(fake: fake)
        let outcome = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src",
            claimManifest: WellKnownClaimManifest()
        )
        guard case .completed(let stepResult, let seamResult) = outcome else {
            Issue.record("expected .completed, got \(outcome)")
            return
        }
        #expect(stepResult.exitCode == 0)
        #expect(stepResult.output == "building...\ndone")
        #expect(seamResult.observedArtifacts == ["security.txt"])
        #expect(seamResult.findings.isEmpty)
    }

    @Test("build seam degrades to an empty result when the marker is missing entirely")
    func seamDegradesWhenMarkerMissing() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "plain build output, no seam marker", stderr: "")
        )
        let executor = makeExecutor(fake: fake)
        let outcome = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src",
            claimManifest: WellKnownClaimManifest()
        )
        guard case .completed(let stepResult, let seamResult) = outcome else {
            Issue.record("expected .completed, got \(outcome)")
            return
        }
        #expect(stepResult.output == "plain build output, no seam marker")
        #expect(seamResult == WellKnownBuildSeamResult())
    }

    @Test("build seam degrades to an empty result when the blob after the marker is malformed")
    func seamDegradesOnMalformedBlob() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(
                exitCode: 1,
                stdout: "build failed\n---ANGLESITE-WELLKNOWN-RESULT---\nnot json at all",
                stderr: ""
            )
        )
        let executor = makeExecutor(fake: fake)
        let outcome = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src",
            claimManifest: WellKnownClaimManifest()
        )
        guard case .completed(let stepResult, let seamResult) = outcome else {
            Issue.record("expected .completed, got \(outcome)")
            return
        }
        #expect(stepResult.exitCode == 1)
        #expect(stepResult.output == "build failed")
        #expect(seamResult == WellKnownBuildSeamResult())
    }

    @Test("build seam splits on the LAST marker occurrence, not the first, when the build's own output coincidentally contains the marker line")
    func seamSplitsOnLastMarkerOccurrence() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(
                exitCode: 0,
                stdout: """
                building...
                ---ANGLESITE-WELLKNOWN-RESULT---
                done
                ---ANGLESITE-WELLKNOWN-RESULT---
                {"observedArtifacts":["security.txt"],"findings":[]}
                """,
                stderr: ""
            )
        )
        let executor = makeExecutor(fake: fake)
        let outcome = await executor.runBuildWithClaimManifest(
            siteDirectory: URL(fileURLWithPath: "/host"),
            environment: [:],
            source: "src",
            claimManifest: WellKnownClaimManifest()
        )
        guard case .completed(let stepResult, let seamResult) = outcome else {
            Issue.record("expected .completed, got \(outcome)")
            return
        }
        // The real, guest-script-echoed marker is always the LAST occurrence — everything before
        // it (including a stray earlier occurrence in the build's own stdout) is build output.
        #expect(stepResult.output == "building...\n---ANGLESITE-WELLKNOWN-RESULT---\ndone")
        #expect(seamResult.observedArtifacts == ["security.txt"])
        #expect(seamResult.findings.isEmpty)
    }

    // MARK: - #748 build seam: cancellation

    @Test("a cancelled build seam resolves as .cancelled, not a hang")
    func seamCancellationResolves() async {
        let fake = CancelParkingFakeContainerControl()
        let executor = ContainerDeployExecutor(control: fake, siteID: "s", logCenter: LogCenter())

        let task = Task {
            await executor.runBuildWithClaimManifest(
                siteDirectory: URL(fileURLWithPath: "/host"),
                environment: [:],
                source: "src",
                claimManifest: WellKnownClaimManifest()
            )
        }
        await fake.waitUntilParked()
        task.cancel()

        let outcome = await task.value
        #expect(outcome == .cancelled)
    }
}

// MARK: - ThrowingFakeLocalContainerControl

private actor ThrowingFakeLocalContainerControl: LocalContainerControl {
    enum ExecError: Error { case boom }

    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw ExecError.boom
    }
    func stop(siteID: String) async throws {}
    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        throw ExecError.boom
    }

    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        throw ExecError.boom
    }
    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        throw ExecError.boom
    }
    func stopWorkersDev(siteID: String) async throws {
        throw ExecError.boom
    }
}

// MARK: - CancelParkingFakeContainerControl

/// A `LocalContainerControl` whose `exec` suspends until the calling Task is cancelled, then throws
/// `CancellationError` — modelling a long-running guest process that the deploy aborts mid-flight.
/// `waitUntilParked()` lets the test rendezvous with the park point before cancelling, so the test
/// is deterministic (no sleeps) and proves the deploy resolves rather than hanging.
private actor CancelParkingFakeContainerControl: LocalContainerControl {
    private var parkedContinuation: CheckedContinuation<Void, Never>?

    /// Resolves once `exec` has reached its suspension point.
    func waitUntilParked() async {
        await withCheckedContinuation { cont in parkedContinuation = cont }
    }

    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw LocalContainerError.virtualizationUnavailable
    }
    func stop(siteID: String) async throws {}

    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        // Signal we've parked, then sleep "forever" — `Task.sleep` throws `CancellationError` the
        // instant the Task is cancelled, which is exactly the abort path we want to exercise.
        signalParked()
        try await Task.sleep(for: .seconds(3600))
        return ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
    }

    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        InteractiveExecHandle(write: { _ in }, terminate: {})
    }

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:51003")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    private func signalParked() {
        parkedContinuation?.resume()
        parkedContinuation = nil
    }
}
