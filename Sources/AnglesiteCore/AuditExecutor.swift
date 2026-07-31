import Foundation

// MARK: - Types

/// Identifies one logical step in the audit sequence.
public enum AuditStep: Sendable {
    /// `npm run build` — produces `dist/`, which every runner audits.
    case build
    /// `npx tsx scripts/a11y-audit.ts --json` — the accessibility runner's script.
    case a11y
}

/// The result of running a single audit step.
///
/// - `exitCode`: the process exit code, or `nil` for pre-spawn failures (resolver reported
///   `.unavailable`, the process could not be spawned/exec'd at all, or the step was
///   cancelled/terminated).
/// - `output`: captured stdout, used for JSON parsing by `A11yAuditRunner` and as the failure
///   reason text for pre-spawn refusals. Also streamed line-by-line to `LogCenter` under the
///   caller-supplied source during execution.
public struct AuditStepResult: Sendable, Equatable {
    /// `nil` distinguishes "never ran / was killed" from "ran and exited" — callers branch on
    /// that before ever comparing against zero.
    public let exitCode: Int32?
    /// Captured stdout (or the refusal reason when `exitCode` is `nil`); see the type doc.
    public let output: String

    /// Memberwise; public so executor fakes in tests can fabricate step results directly.
    public init(exitCode: Int32?, output: String) {
        self.exitCode = exitCode
        self.output = output
    }
}

// MARK: - Protocol

/// Abstraction over the execution substrate for one audit step. A smaller, audit-scoped mirror
/// of `DeployExecutor` — `HostAuditExecutor` fails explicitly after host Node retirement (#70);
/// `ContainerAuditExecutor` runs inside a live container once one is available.
public protocol AuditExecutor: Sendable {
    /// Runs one step to completion, streaming its output to `LogCenter` under `source` as it
    /// goes ("logs are sacred"). Non-throwing by design: every failure mode is encoded in
    /// ``AuditStepResult`` so ``AuditCommand`` has exactly one result shape to interpret.
    func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult
}

// MARK: - ContainerAuditExecutor

/// Runs audit steps inside a running container via `LocalContainerControl.exec`. Mirrors
/// `ContainerDeployExecutor`'s streaming/cancellation pattern exactly; no environment forwarding
/// (unlike deploy, no secrets cross the host/guest boundary for an audit) and no well-known
/// claim-manifest seam (that's deploy-specific, #744/#748).
public struct ContainerAuditExecutor: AuditExecutor {
    private let control: any LocalContainerControl
    private let siteID: String
    private let logCenter: LogCenter

    /// Bound to one already-running container (`control` + `siteID`) at construction — the
    /// executor doesn't boot containers, it only execs into the one the open site owns.
    public init(
        control: any LocalContainerControl,
        siteID: String,
        logCenter: LogCenter = .shared
    ) {
        self.control = control
        self.siteID = siteID
        self.logCenter = logCenter
    }

    /// Execs the step's argv in the guest at `/workspace/site` (the container's clone of the
    /// site — `siteDirectory` is unused here since the guest works on its own copy). Errors are
    /// folded into the result: cancellation and exec failures come back as a `nil` exit code
    /// with an actionable message, per the ``AuditExecutor`` contract.
    public func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult {
        let argv = Self.guestArgv(for: step)
        // Stream guest output to LogCenter LIVE — see `ContainerDeployExecutor.run` for the full
        // rationale on the detached drain task (survives structured cancellation so a kill-
        // triggered final line isn't dropped).
        let (lines, continuation) = AsyncStream<(String, LogCenter.Stream)>.makeStream(bufferingPolicy: .unbounded)
        let logCenter = self.logCenter
        let drain = Task.detached(priority: .utility) {
            for await (line, stream) in lines {
                await logCenter.append(source: source, stream: stream, text: line)
            }
        }
        let result: ContainerExecResult
        do {
            result = try await control.exec(
                siteID: siteID,
                argv: argv,
                environment: [:],
                workingDirectory: "/workspace/site",
                onOutput: { line, stream in continuation.yield((line, stream)) }
            )
        } catch is CancellationError {
            continuation.finish()
            _ = await drain.value
            return AuditStepResult(exitCode: nil, output: "")
        } catch let error as LocalContainerError {
            continuation.finish()
            _ = await drain.value
            // A dead/never-booted container surfaces as `.bootFailed`; give the user an
            // actionable message instead of the raw error.
            if case .bootFailed = error {
                return AuditStepResult(
                    exitCode: nil,
                    output: "Container isn't running — open/start the site's preview first.")
            }
            return AuditStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)")
        } catch let error {
            continuation.finish()
            _ = await drain.value
            return AuditStepResult(exitCode: nil, output: "couldn't exec in the container: \(error)")
        }
        continuation.finish()
        _ = await drain.value
        return AuditStepResult(exitCode: result.exitCode, output: result.stdout)
    }

    static func guestArgv(for step: AuditStep) -> [String] {
        switch step {
        case .build:
            return ["npm", "run", "build"]
        case .a11y:
            return ["npx", "tsx", "scripts/a11y-audit.ts", "--json"]
        }
    }
}

/// Test-only visibility onto `ContainerAuditExecutor`'s argv mapping — mirrors
/// `ContainerDeployExecutorTestHook`.
enum ContainerAuditExecutorTestHook {
    static func guestArgv(for step: AuditStep) -> [String] {
        ContainerAuditExecutor.guestArgv(for: step)
    }
}

// MARK: - HostAuditExecutor

/// Runs audit steps through `ProcessSupervisor` when a caller injects explicit commands. Mirrors
/// `HostDeployExecutor`: the production default fails explicitly for both steps (host Node is
/// retired, #70) via `AuditCommand.resolveBuildCommand`/`resolveA11yCommand`.
public struct HostAuditExecutor: AuditExecutor {
    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    private let resolveCommand: @Sendable (AuditStep) -> AuditCommand.CommandResolver

    /// `resolveCommand` is the only way to make this executor actually spawn anything — the
    /// default refuses every step (see ``defaultResolver``), so only a caller that explicitly
    /// injects a resolver (tests, mainly) gets host processes.
    public init(
        supervisor: ProcessSupervisor = .shared,
        logCenter: LogCenter = .shared,
        resolveCommand: @escaping @Sendable (AuditStep) -> AuditCommand.CommandResolver =
            HostAuditExecutor.defaultResolver
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.resolveCommand = resolveCommand
    }

    /// Resolves the step to a ``AuditCommand/LaunchPlan`` and either spawns it under
    /// `ProcessSupervisor` (streaming to `LogCenter`, terminated on task cancellation) or
    /// returns the plan's refusal reason as a `nil`-exit-code result.
    public func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult {
        let resolver = resolveCommand(step)
        let plan = resolver(siteDirectory)

        switch plan {
        case .unavailable(let reason):
            return AuditStepResult(exitCode: nil, output: reason)
        case .run(let executable, let arguments):
            return await spawn(executable: executable, arguments: arguments, siteDirectory: siteDirectory, source: source)
        }
    }

    private func spawn(
        executable: URL,
        arguments: [String],
        siteDirectory: URL,
        source: String
    ) async -> AuditStepResult {
        let handle: ProcessSupervisor.Handle
        do {
            handle = try await supervisor.launch(
                source: source,
                executable: executable,
                arguments: arguments,
                currentDirectoryURL: siteDirectory,
                logCenter: logCenter
            )
        } catch {
            return AuditStepResult(exitCode: nil, output: "couldn't spawn process: \(error)")
        }

        let reason = await withTaskCancellationHandler {
            await supervisor.waitForExit(handle)
        } onCancel: {
            Task { await supervisor.terminate(handle) }
        }

        let snapshot = await logCenter.snapshot()
        let output = snapshot
            .filter { $0.source == source && $0.stream == .stdout }
            .map(\.text)
            .joined(separator: "\n")

        switch reason {
        case .exited(let code):
            return AuditStepResult(exitCode: code, output: output)
        case .terminated:
            return AuditStepResult(exitCode: nil, output: output)
        case .retriesExhausted(let lastCode):
            return AuditStepResult(exitCode: lastCode, output: output)
        }
    }

    /// Maps each step to its `AuditCommand.resolve*Command` refusal — the single place the
    /// "host Node is retired" (#70) policy is applied for audits, so no step can quietly grow a
    /// host-spawning default again.
    public static let defaultResolver: @Sendable (AuditStep) -> AuditCommand.CommandResolver = { step in
        switch step {
        case .build:
            return AuditCommand.resolveBuildCommand
        case .a11y:
            return AuditCommand.resolveA11yCommand
        }
    }
}
