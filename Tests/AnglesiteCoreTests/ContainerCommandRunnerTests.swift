import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContainerCommandRunner")
struct ContainerCommandRunnerTests {
    private func fakePassing(exitCode: Int32 = 0, stdout: String = "ok") -> FakeLocalContainerControl {
        FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: exitCode, stdout: stdout, stderr: ""),
            execStdoutLines: []
        )
    }

    @Test("arguments are prefixed with npx wrangler")
    func argvIsPrefixedWithWrangler() async throws {
        let fake = fakePassing()
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())

        _ = try await runner.runner(
            URL(fileURLWithPath: "/host/irrelevant"),
            ["d1", "create", "my-site-social", "--json"],
            [:],
            "worker-provision:site-abc"
        )

        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npx", "wrangler", "d1", "create", "my-site-social", "--json"])
        #expect(calls[0].cwd == "/workspace/site")
    }

    @Test("exit code and stdout are surfaced in the RunResult")
    func surfacesExitCodeAndStdout() async throws {
        let fake = fakePassing(exitCode: 0, stdout: #"{"result":{"uuid":"d1-id"}}"#)
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())

        let result = try await runner.runner(URL(fileURLWithPath: "/host"), ["d1", "create", "x", "--json"], [:], "src")

        #expect(result.exitCode == 0)
        #expect(result.stdout == #"{"result":{"uuid":"d1-id"}}"#)
    }

    @Test("a non-zero exit code is surfaced, not thrown")
    func nonZeroExitCodeSurfaced() async throws {
        let fake = fakePassing(exitCode: 1, stdout: "already exists")
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())

        let result = try await runner.runner(URL(fileURLWithPath: "/host"), ["r2", "bucket", "create", "x"], [:], "src")

        #expect(result.exitCode == 1)
        #expect(result.stdout == "already exists")
    }

    @Test("CLOUDFLARE_API_TOKEN is forwarded to the guest environment")
    func forwardsToken() async throws {
        let fake = fakePassing()
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())

        _ = try await runner.runner(
            URL(fileURLWithPath: "/host"), ["d1", "create", "x", "--json"],
            ["CLOUDFLARE_API_TOKEN": "supersecret", "PATH": "/opt/homebrew/bin"], "src"
        )

        let calls = await fake.execCalls
        #expect(calls[0].env["CLOUDFLARE_API_TOKEN"] == "supersecret")
        #expect(calls[0].env["PATH"] == nil)
    }

    @Test("stdout lines stream to LogCenter under the given source")
    func streamsToLogCenter() async throws {
        let logCenter = LogCenter()
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "done", stderr: ""),
            execStdoutLines: ["Creating D1 database 'my-site-social'"]
        )
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: logCenter)

        _ = try await runner.runner(URL(fileURLWithPath: "/host"), ["d1", "create", "x", "--json"], [:], "worker-provision:site-abc")

        let snapshot = await logCenter.snapshot()
        #expect(snapshot.contains { $0.source == "worker-provision:site-abc" && $0.text == "Creating D1 database 'my-site-social'" })
    }

    @Test("a dead container surfaces a throw, not a hang")
    func deadContainerThrows() async {
        // The shared `FakeLocalContainerControl` (Tests/AnglesiteCoreTests/FakeLocalContainerControl.swift)
        // always succeeds — its `exec` has no way to throw. `ContainerDeployExecutorTests.swift`
        // hits this same limitation and defines a local throwing fake for exactly this case;
        // mirror that pattern here rather than the shared fake.
        let fake = ThrowingFakeLocalContainerControl()
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())

        await #expect(throws: ThrowingFakeLocalContainerControl.ExecError.self) {
            _ = try await runner.runner(URL(fileURLWithPath: "/host"), ["d1", "create", "x", "--json"], [:], "src")
        }
    }

    @Test("secretRunner pipes the value through an environment variable, never through argv")
    func secretRunnerPipesValueThroughEnvironment() async throws {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "Success! Uploaded secret AP_PRIVATE_KEY", stderr: "")
        )
        let runner = ContainerCommandRunner(control: fake, siteID: "site-abc", logCenter: LogCenter())
        let privateKeyPem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"

        let result = try await runner.secretRunner(
            URL(fileURLWithPath: "/host/irrelevant"), "AP_PRIVATE_KEY", privateKeyPem,
            ["CLOUDFLARE_API_TOKEN": "token"], "test-source"
        )

        #expect(result.exitCode == 0)
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        // The secret value must never appear as a literal argv element — only the shell script text
        // (which references it by variable name) and the environment dict (checked below) do.
        #expect(!calls[0].argv.contains(where: { $0.contains("BEGIN PRIVATE KEY") }))
        #expect(calls[0].argv == [
            "sh", "-c",
            "printf '%s' \"$WRANGLER_SECRET_VALUE\" | npx wrangler secret put \"$WRANGLER_SECRET_NAME\"",
        ])
        #expect(calls[0].env["WRANGLER_SECRET_NAME"] == "AP_PRIVATE_KEY")
        #expect(calls[0].env["WRANGLER_SECRET_VALUE"] == privateKeyPem)
        #expect(calls[0].env["CLOUDFLARE_API_TOKEN"] == "token")
        #expect(calls[0].cwd == "/workspace/site")
    }
}

// Mirrors `ContainerDeployExecutorTests.swift`'s private `ThrowingFakeLocalContainerControl` —
// duplicated locally (not shared) because that one is `private` to its own test file.
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
