import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ContainerAuditExecutor")
struct ContainerAuditExecutorTests {

    // MARK: Helpers

    private func makeExecutor(
        fake: FakeLocalContainerControl,
        siteID: String = "site-abc",
        logCenter: LogCenter = LogCenter()
    ) -> ContainerAuditExecutor {
        ContainerAuditExecutor(control: fake, siteID: siteID, logCenter: logCenter)
    }

    private func fakePassing(lines: [String] = []) -> FakeLocalContainerControl {
        FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "ok", stderr: ""),
            execStdoutLines: lines
        )
    }

    // MARK: - argv mapping

    @Test("build step sends correct argv")
    func buildArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:site-abc:build")
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npm", "run", "build"])
    }

    @Test("a11y step sends correct argv")
    func a11yArgv() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .a11y, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:site-abc:accessibility")
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
    }

    // MARK: - cwd is always /workspace/site

    @Test("exec always uses /workspace/site as working directory")
    func workingDirectory() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host/totally/different"), source: "src")
        let calls = await fake.execCalls
        #expect(calls[0].cwd == "/workspace/site")
    }

    // MARK: - no environment forwarded

    @Test("no environment is forwarded to exec")
    func noEnvironmentForwarded() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        let calls = await fake.execCalls
        #expect(calls[0].env.isEmpty)
    }

    // MARK: - log streaming

    @Test("stdout lines from exec are appended to LogCenter under source")
    func stdoutToLogCenter() async {
        let logCenter = LogCenter()
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "full", stderr: ""),
            execStdoutLines: ["line one", "line two"]
        )
        let executor = makeExecutor(fake: fake, logCenter: logCenter)
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:site-abc:build")
        let snapshot = await logCenter.snapshot()
        let texts = snapshot.filter { $0.source == "audit:site-abc:build" }.map(\.text)
        #expect(texts.contains("line one"))
        #expect(texts.contains("line two"))
    }

    // MARK: - exit code surfaced

    @Test("non-zero exit code surfaces in AuditStepResult")
    func nonZeroExitCode() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 1, stdout: "not found", stderr: ""),
            execStdoutLines: []
        )
        let executor = makeExecutor(fake: fake)
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == 1)
    }

    @Test("zero exit code surfaces in AuditStepResult")
    func zeroExitCode() async {
        let fake = fakePassing()
        let executor = makeExecutor(fake: fake)
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == 0)
    }

    // MARK: - thrown exec surfaces as nil exitCode

    @Test("thrown exec returns nil exitCode and error message")
    func thrownExecReturnsNilExitCode() async {
        let fake = ThrowingFakeLocalContainerControl()
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-abc", logCenter: LogCenter())
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == nil)
        #expect(result.output.contains("couldn't exec in the container"))
    }

    // MARK: - bootFailed produces an actionable message

    @Test("a not-running container surfaces an actionable message, not a raw error dump")
    func bootFailedProducesActionableMessage() async {
        let fake = BootFailedFakeLocalContainerControl()
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-abc", logCenter: LogCenter())
        let result = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        #expect(result.exitCode == nil)
        #expect(result.output == "Container isn't running — open/start the site's preview first.")
    }

    // MARK: - cancellation does not hang and surfaces termination

    @Test("a cancelled exec resolves (does not hang) and surfaces termination, not an exec error")
    func cancelledExecTerminates() async {
        let fake = CancelParkingFakeAuditContainerControl()
        let executor = ContainerAuditExecutor(control: fake, siteID: "s", logCenter: LogCenter())

        let task = Task {
            await executor.run(step: .a11y, siteDirectory: URL(fileURLWithPath: "/host"), source: "audit:s:accessibility")
        }
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
        let executor = ContainerAuditExecutor(control: fake, siteID: "my-special-site", logCenter: LogCenter())
        _ = await executor.run(step: .build, siteDirectory: URL(fileURLWithPath: "/host"), source: "src")
        let calls = await fake.execCalls
        #expect(calls[0].siteID == "my-special-site")
    }

    // MARK: - argv mapping test hook coverage

    @Test("guestArgv test hook matches the runtime argv for both steps")
    func guestArgvTestHook() {
        #expect(ContainerAuditExecutorTestHook.guestArgv(for: .build) == ["npm", "run", "build"])
        #expect(ContainerAuditExecutorTestHook.guestArgv(for: .a11y) == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
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

// MARK: - BootFailedFakeLocalContainerControl

private actor BootFailedFakeLocalContainerControl: LocalContainerControl {
    func start(
        siteID: String, sourceRepo: URL, ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        throw LocalContainerError.bootFailed("never started")
    }
    func stop(siteID: String) async throws {}
    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        throw LocalContainerError.bootFailed("container is not running")
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
}

// MARK: - CancelParkingFakeAuditContainerControl

/// A `LocalContainerControl` whose `exec` suspends until the calling Task is cancelled, then
/// throws `CancellationError` — modelling a long-running guest process the audit aborts
/// mid-flight. Mirrors `ContainerDeployExecutorTests`'s `CancelParkingFakeContainerControl`.
private actor CancelParkingFakeAuditContainerControl: LocalContainerControl {
    private var parkedContinuation: CheckedContinuation<Void, Never>?

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
