import Foundation
@testable import AnglesiteCore

actor FakeLocalContainerControl: LocalContainerControl {
    var startResult: Result<LocalContainerSession, LocalContainerError>
    private(set) var stopped: [String] = []
    private(set) var startedRepos: [(siteID: String, repo: URL, ref: String)] = []
    /// Overrides `LocalContainerControl`'s default no-op so tests can assert
    /// `resetNetworking()` calls actually reach the control, not just that the call compiles.
    private(set) var resetNetworkingCallCount = 0

    /// Lines replayed to `start`'s `onOutput` in order before it returns (or throws).
    var startStdoutLines: [String]

    /// Canned result returned by `exec`. Defaults to a successful empty run.
    var execResult: ContainerExecResult
    /// Lines replayed to `onOutput` in order before `exec` returns.
    var execStdoutLines: [String]
    /// All `exec` invocations recorded for assertion.
    private(set) var execCalls: [(siteID: String, argv: [String], env: [String: String], cwd: String)] = []

    /// Lines replayed to `execInteractive`'s `onOutput` (as `.stdout`) in order before it returns
    /// the handle — separate from `execStdoutLines`, which only feeds the older `exec`. Pass at
    /// construction (mirrors `startStdoutLines`/`execStdoutLines`) so a transport test can
    /// simulate the agent's first stdout lines arriving.
    var execInteractiveStdoutLines: [String]
    /// All `execInteractive` invocations recorded for assertion.
    private(set) var execInteractiveCalls: [(siteID: String, argv: [String], env: [String: String], cwd: String)] = []
    /// Data written to the most recently returned handle, recorded for assertion.
    private(set) var execInteractiveWrites: [Data] = []
    /// Whether the most recently returned handle's `terminate()` was called.
    private(set) var execInteractiveTerminated = false

    /// Canned result returned by `startWorkersDev`. Defaults to a successful fixed URL.
    var startWorkersDevResult: Result<URL, LocalContainerError> = .success(URL(string: "http://127.0.0.1:51003")!)
    /// Lines replayed to `startWorkersDev`'s `onOutput` in order before it returns.
    var startWorkersDevStdoutLines: [String] = []
    /// All `startWorkersDev` invocations recorded for assertion.
    private(set) var startWorkersDevCalls: [(siteID: String, workers: [WorkerDescriptor])] = []
    /// All `stopWorkersDev` invocations recorded for assertion.
    private(set) var stopWorkersDevCalls: [String] = []
    /// The `onState` callback captured from the most recent 4-param `startWorkersDev` call —
    /// tests `await` it directly to simulate supervisor transitions (crash-restart, failure);
    /// delivery has fully landed in the status center when the await returns.
    private(set) var lastWorkersDevOnState: (@Sendable (WorkersDevProcessState) async -> Void)?

    /// Actor-isolated setter: `startWorkersDevResult` can't be assigned from outside the actor.
    func setStartWorkersDevResult(_ result: Result<URL, LocalContainerError>) {
        startWorkersDevResult = result
    }

    /// Actor-isolated setter, same reason as `setStartWorkersDevResult`.
    func setStartWorkersDevStdoutLines(_ lines: [String]) {
        startWorkersDevStdoutLines = lines
    }

    init(
        startResult: Result<LocalContainerSession, LocalContainerError>,
        startStdoutLines: [String] = [],
        execResult: ContainerExecResult = ContainerExecResult(exitCode: 0, stdout: "", stderr: ""),
        execStdoutLines: [String] = [],
        execInteractiveStdoutLines: [String] = []
    ) {
        self.startResult = startResult
        self.startStdoutLines = startStdoutLines
        self.execResult = execResult
        self.execStdoutLines = execStdoutLines
        self.execInteractiveStdoutLines = execInteractiveStdoutLines
    }

    func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        startedRepos.append((siteID, sourceRepo, ref))
        for line in startStdoutLines { onOutput(line, .stdout) }
        return try startResult.get()
    }

    func stop(siteID: String) async throws { stopped.append(siteID) }

    func resetNetworking() async { resetNetworkingCallCount += 1 }

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        startWorkersDevCalls.append((siteID: siteID, workers: workers))
        for line in startWorkersDevStdoutLines { onOutput(line, .stdout) }
        return try startWorkersDevResult.get()
    }

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void,
        onState: @escaping @Sendable (WorkersDevProcessState) async -> Void
    ) async throws -> URL {
        lastWorkersDevOnState = onState
        return try await startWorkersDev(siteID: siteID, workers: workers, onOutput: onOutput)
    }

    func stopWorkersDev(siteID: String) async throws {
        stopWorkersDevCalls.append(siteID)
    }

    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        execCalls.append((siteID: siteID, argv: argv, env: environment, cwd: workingDirectory))
        for line in execStdoutLines { onOutput(line, .stdout) }
        return execResult
    }

    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        execInteractiveCalls.append((siteID: siteID, argv: argv, env: environment, cwd: workingDirectory))
        for line in execInteractiveStdoutLines { onOutput(line, .stdout) }
        return InteractiveExecHandle(
            write: { [weak self] data in await self?.recordExecInteractiveWrite(data) },
            terminate: { [weak self] in await self?.recordExecInteractiveTerminated() }
        )
    }

    private func recordExecInteractiveWrite(_ data: Data) { execInteractiveWrites.append(data) }
    private func recordExecInteractiveTerminated() { execInteractiveTerminated = true }
}

actor BundleImportRecorder {
    struct Call: Sendable {
        let bundleURL: URL
        let commit: String
        let sourceDirectory: URL
    }

    private(set) var calls: [Call] = []
    let error: Error?

    init(error: Error? = nil) {
        self.error = error
    }

    func run(bundleURL: URL, commit: String, sourceDirectory: URL) throws {
        calls.append(.init(bundleURL: bundleURL, commit: commit, sourceDirectory: sourceDirectory))
        if let error { throw error }
    }
}

actor PersistenceGatedFakeLocalContainerControl: LocalContainerControl {
    private let result: Result<LocalContainerSession, LocalContainerError>
    private let execResult: ContainerExecResult
    private var parkedContinuation: CheckedContinuation<Void, Never>?
    private var gateContinuation: CheckedContinuation<Void, Never>?
    private var execParked = false

    init(result: Result<LocalContainerSession, LocalContainerError>, execResult: ContainerExecResult) {
        self.result = result
        self.execResult = execResult
    }

    func waitUntilExecParked() async {
        if execParked { return }
        await withCheckedContinuation { parkedContinuation = $0 }
    }

    func releaseExec() {
        gateContinuation?.resume()
        gateContinuation = nil
    }

    func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        try result.get()
    }

    func stop(siteID: String) async throws {}

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:51003")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        execParked = true
        parkedContinuation?.resume()
        parkedContinuation = nil
        await withCheckedContinuation { continuation in
            gateContinuation = continuation
        }
        return execResult
    }

    // Not exercised by any test — this fake exists to test `exec`'s persistence-gating race,
    // not `execInteractive`. Trivial no-op handle, matching the other not-exercised conformances
    // in this file (`StopGatedFakeLocalContainerControl`, `GatedFakeLocalContainerControl`).
    func execInteractive(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> InteractiveExecHandle {
        InteractiveExecHandle(write: { _ in }, terminate: {})
    }
}

/// A `LocalContainerControl` whose `start` suspends until `release()` is called — for
/// deterministically interleaving a concurrent `stop()`/second `start()` while the first
/// `start()` is parked. Mirrors `GatedFakeSandboxControlClient`.
///
/// Note: the park/release rendezvous relies on Swift's cooperative executor not running the
/// spawned `start()` Task before `waitUntilParked()` installs its continuation. This matches the
/// pattern in `GatedFakeSandboxControlClient` and is sufficient for Swift Testing's executor.
/// The mirror image of `GatedFakeLocalContainerControl`: `start` succeeds immediately, while the
/// FIRST `stop` suspends until `releaseStop()` — for deterministically interleaving a superseding
/// `start()` while a `stop()`'s teardown is parked inside `control.stop(...)` (the rapid
/// Stop → Restart race from the PR #542 review). Subsequent `stop` calls pass straight through so
/// the superseding path can't deadlock on the gate.
actor StopGatedFakeLocalContainerControl: LocalContainerControl {
    private let result: Result<LocalContainerSession, LocalContainerError>
    private(set) var stopped: [String] = []
    private var parkedContinuation: CheckedContinuation<Void, Never>?
    private var gateContinuation: CheckedContinuation<Void, Never>?
    private var gateArmed = true

    init(result: Result<LocalContainerSession, LocalContainerError>) { self.result = result }

    func waitUntilStopParked() async {
        await withCheckedContinuation { cont in parkedContinuation = cont }
    }
    func releaseStop() { gateContinuation?.resume(); gateContinuation = nil }

    func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        try result.get()
    }

    func stop(siteID: String) async throws {
        stopped.append(siteID)
        guard gateArmed else { return }
        gateArmed = false
        await withCheckedContinuation { cont in
            parkedContinuation?.resume()
            parkedContinuation = nil
            gateContinuation = cont
        }
    }

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:51003")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
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
}

actor GatedFakeLocalContainerControl: LocalContainerControl {
    private let result: Result<LocalContainerSession, LocalContainerError>
    private(set) var stopped: [String] = []
    private var parkedContinuation: CheckedContinuation<Void, Never>?
    private var gateContinuation: CheckedContinuation<Void, Never>?

    init(result: Result<LocalContainerSession, LocalContainerError>) { self.result = result }

    func waitUntilParked() async {
        await withCheckedContinuation { cont in parkedContinuation = cont }
    }
    func release() { gateContinuation?.resume(); gateContinuation = nil }

    func start(
        siteID: String,
        sourceRepo: URL,
        ref: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> LocalContainerSession {
        await withCheckedContinuation { cont in
            parkedContinuation?.resume()
            parkedContinuation = nil
            gateContinuation = cont
        }
        return try result.get()
    }
    func stop(siteID: String) async throws { stopped.append(siteID) }

    func startWorkersDev(
        siteID: String,
        workers: [WorkerDescriptor],
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> URL {
        URL(string: "http://127.0.0.1:51003")!
    }

    func stopWorkersDev(siteID: String) async throws {}

    func exec(
        siteID: String,
        argv: [String],
        environment: [String: String],
        workingDirectory: String,
        onOutput: @escaping @Sendable (String, LogCenter.Stream) -> Void
    ) async throws -> ContainerExecResult {
        ContainerExecResult(exitCode: 0, stdout: "", stderr: "")
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
}
