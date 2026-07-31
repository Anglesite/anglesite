import Foundation

/// Spawns and supervises subprocesses (git, gh, container tooling, and other non-Node helpers).
///
/// All subprocess spawning in the app goes through this actor. Direct `Process()` use from views or
/// other modules is not allowed — it would bypass log streaming and shutdown handling.
///
/// This is a thin **facade** over a `SupervisorBackend`. The actual spawn and supervision
/// implementation lives in `InProcessBackend`; the app is sandboxed and spawns directly while
/// holding a per-window security-scoped grant for site packages.
///
/// The public API below is unchanged from the pre-split supervisor; every caller and test keeps
/// working. Each method builds a `SpawnSpec` and delegates to `self.backend`. `Handle.id` and the
/// backend's `SpawnedProcessHandle.id` are the same UUID, so the facade maps between them for free.
///
/// Two flavors of spawn:
///   - `run(...)` — fire-and-await for short-lived commands; returns captured stdout/stderr/exitCode.
///   - `launch(...)` — long-running supervised process; streams output into a `LogCenter`, exposes a
///     `Handle` for `terminate(_:)` / `waitForExit(_:)`, and honors `RestartPolicy` on crash.
public actor ProcessSupervisor {
    /// App-wide supervisor. The UI and app delegate share this so that `shutdownAll()` on quit
    /// reaches every child the app spawned. Tests build their own instances.
    public static let shared = ProcessSupervisor()

    /// Neutralize `SIGPIPE` process-wide. Every child's stdin pipe is owned here; if a child closes
    /// its read end (crash/exit) while we're mid-write, the default `SIGPIPE` disposition terminates
    /// the **whole process** with signal 13 — which under `swift test --parallel` aborts the entire
    /// test run with no failing-test marker. A no-op handler makes the write fail with `EPIPE`
    /// instead, which `FileHandle`/backend writes already surface or absorb.
    ///
    /// We install a no-op handler rather than `SIG_IGN` deliberately: the Swift-vended
    /// `Darwin.SIG_IGN` constant is exported from the `libswift_DarwinFoundation3` overlay, which the
    /// macOS-26 CI runners don't ship — referencing it makes the whole test bundle fail to load
    /// ("Library not loaded: libswift_DarwinFoundation3.dylib"). A non-capturing closure handler
    /// avoids that symbol entirely while achieving the same crash-suppression. Installed exactly once
    /// (Swift evaluates a `static let` lazily and thread-safely) the first time any supervisor is
    /// constructed — before any child can exist — so both the app and the test process are covered.
    private static let ignoreSIGPIPE: Void = { signal(SIGPIPE, { _ in }) }()

    private let backend: SupervisorBackend

    private let suddenTerminationController: SuddenTerminationController
    private var processLeases: [UUID: SuddenTerminationController.Lease] = [:]

    /// Environment for spawns that don't pass one. Injectable for tests.
    private let defaultEnvironment: @Sendable () -> [String: String]?

    /// Source-compat re-exports. These used to be nested types; they now live at the protocol layer
    /// (so the backend can speak them too), re-exposed here so existing call sites such as
    /// `ProcessSupervisor.RestartPolicy.onCrash(...)` and `ProcessSupervisor.ExitReason` compile
    /// unchanged.
    public typealias RestartPolicy = AnglesiteCore.RestartPolicy
    /// Source-compat re-export of ``ProcessExitReason`` — see ``RestartPolicy`` for why these
    /// aliases exist.
    public typealias ExitReason = AnglesiteCore.ProcessExitReason
    /// Source-compat re-export of the module-level `RespawnHandler` — see ``RestartPolicy`` for
    /// why these aliases exist.
    public typealias RespawnHandler = AnglesiteCore.RespawnHandler

    /// `Handle.source` is preserved (the backend's opaque handle doesn't carry it), so map by `id`.
    private func backendHandle(for handle: Handle) -> SpawnedProcessHandle {
        SpawnedProcessHandle(id: handle.id, pid: 0)
    }

    /// Convenience for the app and tests: the default in-process backend. The app is sandboxed and
    /// still uses subprocesses for non-Node helper tools, holding a per-`SiteWindow`
    /// security-scoped grant so spawned children inherit folder access. iOS has no
    /// `Foundation.Process`, so `InProcessBackend` compiles out there (#71) and the remote-only
    /// client gets `UnavailableProcessBackend` — every spawn fails capability-flagged; the iOS
    /// runtime selection never reaches this backend in normal operation.
    public init(suddenTerminationController: SuddenTerminationController = .shared) {
        _ = Self.ignoreSIGPIPE
        #if os(iOS)
        self.backend = UnavailableProcessBackend()
        #else
        self.backend = InProcessBackend()
        #endif
        self.defaultEnvironment = { nil }
        self.suddenTerminationController = suddenTerminationController
    }

    /// Inject a backend explicitly (tests, future MAS wiring); `defaultEnvironment` applies to spawns that don't pass one.
    public init(backend: SupervisorBackend,
                defaultEnvironment: @escaping @Sendable () -> [String: String]? = { nil },
                suddenTerminationController: SuddenTerminationController = .shared) {
        _ = Self.ignoreSIGPIPE
        self.backend = backend
        self.defaultEnvironment = defaultEnvironment
        self.suddenTerminationController = suddenTerminationController
    }

    // MARK: One-shot run

    /// Captured outcome of a one-shot ``run(executable:arguments:environment:currentDirectoryURL:)``.
    ///
    /// A nonzero exit is *not* thrown — short-lived tools routinely use exit codes as answers
    /// (e.g. `git diff --quiet`), so callers inspect ``exitCode`` themselves.
    public struct RunResult: Sendable, Equatable {
        /// Everything the process wrote to stdout, decoded as UTF-8 (empty on decode failure).
        public let stdout: String
        /// Everything the process wrote to stderr, decoded as UTF-8 (empty on decode failure).
        public let stderr: String
        /// The process's exit status. `0` means success by convention; interpreting anything
        /// else is the caller's job.
        public let exitCode: Int32

        /// Memberwise initializer — public so tests and fake backends can fabricate results.
        public init(stdout: String, stderr: String, exitCode: Int32) {
            self.stdout = stdout
            self.stderr = stderr
            self.exitCode = exitCode
        }
    }

    /// Failures the supervisor surfaces to callers, translated from the backend's
    /// ``SupervisorBackendError`` so call sites don't couple to the backend seam.
    public enum SupervisorError: Error, Sendable {
        /// The process could not be spawned (missing executable, sandbox denial, backend
        /// unavailable). The underlying error carries the backend's message.
        case spawnFailed(underlying: Error)
        /// The ``Handle`` doesn't correspond to a live supervised process — it already exited
        /// and was reaped, or was never launched by this supervisor instance.
        case unknownHandle
    }

    /// Spawns `executable`, waits for it to exit, returns captured stdout/stderr/exitCode.
    ///
    /// Both pipes are drained concurrently so output larger than the pipe buffer (~64KB) does not deadlock.
    /// For long-running processes whose output must be streamed, use `launch(...)`.
    public func run(
        executable: URL,
        arguments: [String] = [],
        environment: [String: String]? = nil,
        currentDirectoryURL: URL? = nil
    ) async throws -> RunResult {
        let suddenTerminationLease = suddenTerminationController.acquire()
        defer { suddenTerminationLease.release() }
        let spec = SpawnSpec(
            executable: executable,
            arguments: arguments,
            environment: environment ?? defaultEnvironment(),
            workingDirectory: currentDirectoryURL,
            logSource: "run"
        )
        let result: ProcessResult
        do {
            result = try await backend.runOneShot(spec)
        } catch let error as SupervisorBackendError {
            throw Self.translate(error)
        }
        return RunResult(
            stdout: String(data: result.stdout, encoding: .utf8) ?? "",
            stderr: String(data: result.stderr, encoding: .utf8) ?? "",
            exitCode: result.exitCode
        )
    }

    // MARK: Long-running launch

    /// Opaque reference to a launched, supervised process.
    ///
    /// Deliberately carries no PID: under a ``RestartPolicy`` the underlying OS process can be
    /// respawned (new PID) while the handle stays valid, so identity is the supervisor-assigned
    /// ``id``, not anything the kernel hands out.
    public struct Handle: Sendable, Identifiable, Hashable {
        /// Supervisor-assigned identity — shared with the backend's `SpawnedProcessHandle.id`,
        /// which is how the facade maps between the two without extra bookkeeping.
        public let id: UUID
        /// The log-source tag given to `launch(...)`, kept on the handle so callers can label
        /// UI (debug pane sections, error messages) without a supervisor round-trip.
        public let source: String
    }

    /// Wrapper for a launched process's stdin pipe, vended by ``stdinWriter(_:)``.
    ///
    /// Prefer ``writeStdin(_:_:)`` for routine writes — it stays on the backend and surfaces
    /// errors; the raw handle exists for callers that need `FileHandle`-level control.
    public struct StdinHandle: Sendable {
        /// The write end of the child's stdin pipe. Writing after the child exits raises
        /// `EPIPE` rather than killing the app — see the supervisor's `SIGPIPE` handling.
        public let writer: FileHandle
    }

    /// Spawn a long-running supervised process. Log lines flow into `logCenter` tagged with `source`.
    ///
    /// Returns once the process has been spawned (or thrown). Use `waitForExit(_:)` for the final
    /// disposition and `terminate(_:)` to stop it.
    ///
    /// If you need to write to the process's stdin (e.g. MCP JSON-RPC framing), pass `attachStdin: true`
    /// and call `stdinWriter(_:)` afterward. Pass `onRespawn` to react to supervised restarts.
    @discardableResult
    public func launch(
        source: String,
        executable: URL,
        arguments: [String] = [],
        environment: [String: String]? = nil,
        currentDirectoryURL: URL? = nil,
        restartPolicy: RestartPolicy = .never,
        attachStdin: Bool = false,
        onRespawn: RespawnHandler? = nil,
        logCenter: LogCenter = .shared
    ) async throws -> Handle {
        let suddenTerminationLease = suddenTerminationController.acquire()
        let spec = SpawnSpec(
            executable: executable,
            arguments: arguments,
            environment: environment ?? defaultEnvironment(),
            workingDirectory: currentDirectoryURL,
            stdinPipe: attachStdin,
            logSource: source
        )
        let spawned: SpawnedProcessHandle
        do {
            spawned = try await backend.launch(
                spec,
                restartPolicy: restartPolicy,
                onRespawn: onRespawn,
                logCenter: logCenter
            )
        } catch let error as SupervisorBackendError {
            suddenTerminationLease.release()
            throw Self.translate(error)
        } catch {
            suddenTerminationLease.release()
            throw error
        }
        processLeases[spawned.id] = suddenTerminationLease
        let backend = self.backend
        Task { [weak self] in
            _ = await backend.waitForExit(spawned)
            await self?.releaseProcessLease(id: spawned.id)
        }
        return Handle(id: spawned.id, source: source)
    }

    /// Awaits the final exit reason for a launched process. Resolves once the supervision loop ends
    /// (either the process exited and isn't being restarted, or `terminate(_:)` ran). If the
    /// awaiting task is cancelled, returns `.terminated` immediately — letting task groups
    /// unwind without waiting for the real process exit.
    ///
    /// Contract: this **returns** on cancellation (it is non-`throws`), it does not raise
    /// `CancellationError`. Callers that race it inside a task group — e.g. `E2EServer.awaitReady`,
    /// which parks a death-waiter against a readiness poll — rely on a cancelled wait unwinding as a
    /// plain return so it can't surface as a spurious error. Preserve that if this ever gains
    /// cooperative cancellation.
    public func waitForExit(_ handle: Handle) async -> ExitReason {
        await backend.waitForExit(backendHandle(for: handle))
    }

    /// Sends SIGTERM and waits up to `timeout` seconds before escalating to SIGKILL.
    public func terminate(_ handle: Handle, timeout: TimeInterval = 5) async {
        await backend.terminate(backendHandle(for: handle), timeout: timeout)
    }

    /// Terminates every supervised process. SIGTERM (with SIGKILL escalation after `timeout`) is
    /// sent to all live entries concurrently; resolves once each supervision loop has settled.
    /// Marking entries `manuallyTerminated` first means an in-flight `RestartPolicy.onCrash`
    /// backoff is broken instead of waited out. Wire this to the app's quit notification so no
    /// Node / Astro / MCP child outlives the app process.
    public func shutdownAll(timeout: TimeInterval = 5) async {
        await backend.shutdownAll(timeout: timeout)
        for id in Array(processLeases.keys) {
            releaseProcessLease(id: id)
        }
    }

    /// Whether the supervised process behind `handle` is currently alive. `false` for an unknown
    /// handle as well as an exited process — callers polling for liveness don't need to
    /// distinguish the two.
    public func isRunning(_ handle: Handle) async -> Bool {
        await backend.isRunning(backendHandle(for: handle))
    }

    /// File handle for writing to the launched process's stdin. Only available when `launch` was
    /// called with `attachStdin: true`. Returns `nil` if the handle is unknown or stdin wasn't attached.
    public func stdinWriter(_ handle: Handle) async -> StdinHandle? {
        guard let writer = await backend.stdinHandle(backendHandle(for: handle)) else { return nil }
        return StdinHandle(writer: writer)
    }

    /// Writes `bytes` to the launched process's stdin via the backend (`InProcessBackend` writes to
    /// the tracked child's stdin pipe). MCP JSON-RPC framing uses this. Throws if the handle is
    /// unknown or `launch` wasn't called with `attachStdin: true`.
    public func writeStdin(_ handle: Handle, _ bytes: Data) async throws {
        do {
            try await backend.writeStdin(backendHandle(for: handle), bytes)
        } catch let error as SupervisorBackendError {
            throw Self.translate(error)
        }
    }

    private func releaseProcessLease(id: UUID) {
        processLeases.removeValue(forKey: id)?.release()
    }

    // MARK: Error translation

    private static func translate(_ error: SupervisorBackendError) -> SupervisorError {
        switch error {
        case .spawnFailed(let message):
            return .spawnFailed(underlying: NSError(
                domain: "AnglesiteCore.SupervisorBackend",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        case .unknownHandle:
            return .unknownHandle
        case .bookmarkResolutionFailed(let message), .backendUnavailable(let message):
            return .spawnFailed(underlying: NSError(
                domain: "AnglesiteCore.SupervisorBackend",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        }
    }
}
