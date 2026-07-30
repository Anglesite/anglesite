import Foundation

/// Pluggable seam for one audit category (accessibility, SEO, performance, security).
/// Production implementations shell out to the plugin's audit scripts and parse their
/// `--json` output; tests inject closures or fakes that return canned `[Finding]`.
///
/// `source` is the `LogCenter` tag the runner should use for any subprocess output
/// (`audit:<siteID>:<runner>`), so the drawer/sheet can distinguish phases.
public protocol AuditRunner: Sendable {
    var category: AuditReport.Finding.Category { get }
    func run(
        siteDirectory: URL,
        supervisor: ProcessSupervisor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding]
}

/// One-shot orchestrator for the deterministic structured-audit path that replaces
/// the chat-routed `/anglesite:check` pill (#86). Pairs with the LLM-routed skill,
/// which retains the broader surface (plain-English translation, troubleshooting,
/// Cloudflare doc lookups, drafting fixes).
///
/// Steps:
///   1. `npm run build` so `dist/` is fresh (the audit scripts walk built HTML).
///      Streams to `LogCenter` under `audit:<siteID>:build`. A non-zero exit
///      short-circuits to `.failed` — runners can't audit what didn't build.
///   2. For each `AuditRunner`, call its `run(...)`. Successful runs add their
///      findings + record the category in `runnersExecuted`. Throwing runs are
///      recorded in `runnersSkipped` — one runner's missing tooling shouldn't
///      kill the whole audit.
///
/// Returns the aggregated `AuditReport` in `.succeeded`. The actor doesn't decide
/// what counts as a "passing" audit — that's the UI's job (e.g. show a green
/// badge if no `.critical` findings, regardless of warnings).
public actor AuditCommand {
    public enum Result: Sendable, Equatable {
        case succeeded(report: AuditReport, duration: TimeInterval)
        /// `logTail` carries the captured `audit:<siteID>:build` lines so the failure
        /// sheet can show *why* the build failed without the owner having to open the
        /// Debug pane. Empty for pre-spawn refusals (`.unavailable`, spawn errors) where
        /// no subprocess produced output.
        case failed(reason: String, exitCode: Int32?, logTail: [LogCenter.LogLine])
    }

    /// How to run a subprocess for a site directory — or why it can't be run.
    /// Reused from `DeployCommand` shape so both actors share the resolver pattern.
    public enum LaunchPlan: Sendable, Equatable {
        case run(executable: URL, arguments: [String])
        case unavailable(reason: String)
    }

    public typealias CommandResolver = @Sendable (_ siteDirectory: URL) -> LaunchPlan

    /// Reached lazily, at the moment the build step actually runs — mirrors
    /// `DeployModel`/`AstroHTMLValidator`'s `ContainerControlProvider` (#823), since the container
    /// may not have finished booting yet when `AuditCommand` is constructed.
    public typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    private let resolveBuildCommand: CommandResolver
    private let containerControlProvider: ContainerControlProvider
    private let runners: [any AuditRunner]

    public init(
        supervisor: ProcessSupervisor = .shared,
        logCenter: LogCenter = .shared,
        resolveBuildCommand: @escaping CommandResolver = AuditCommand.resolveBuildCommand,
        containerControlProvider: @escaping ContainerControlProvider = { nil },
        runners: [any AuditRunner]? = nil
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.resolveBuildCommand = resolveBuildCommand
        self.containerControlProvider = containerControlProvider
        self.runners = runners ?? AuditCommand.defaultRunners(containerControlProvider: containerControlProvider)
    }

    /// Run the audit pipeline against `siteDirectory`. Reaches `.succeeded` even when
    /// individual runners throw — those are surfaced via `report.runnersSkipped`.
    public func audit(siteID: String, siteDirectory: URL, onProgress: ProgressHandler? = nil) async -> Result {
        let started = Date()
        onProgress?(.auditBuilding)

        // Build dist/ first. Streamed so the UI can show progress.
        switch await runBuild(siteID: siteID, siteDirectory: siteDirectory) {
        case .success: break
        case .failure(let result): return result
        }

        // Run each runner in declared order. Failures are non-fatal at this layer.
        var findings: [AuditReport.Finding] = []
        var executed: [AuditReport.Finding.Category] = []
        var skipped: [AuditReport.SkippedRunner] = []

        for (index, runner) in runners.enumerated() {
            if Task.isCancelled { break }   // CancellableIntent cancel — stop before the next runner
            onProgress?(.auditRunning(category: runner.category.rawValue, index: index, of: runners.count))
            let source = "audit:\(siteID):\(runner.category.rawValue)"
            do {
                let runnerFindings = try await runner.run(
                    siteDirectory: siteDirectory,
                    supervisor: supervisor,
                    logCenter: logCenter,
                    source: source
                )
                findings.append(contentsOf: runnerFindings)
                executed.append(runner.category)
            } catch {
                // Record the skip AND log it — a runner that throws before it can emit anything
                // itself (e.g. a spawn failure) would otherwise be invisible in the drawer.
                await logCenter.append(
                    source: source,
                    stream: .stderr,
                    text: "\(runner.category.rawValue) audit skipped — \(error)"
                )
                skipped.append(.init(category: runner.category, reason: "\(error)"))
            }
        }

        if Task.isCancelled {
            return .failed(reason: "audit canceled", exitCode: nil, logTail: [])
        }
        onProgress?(.auditFinalizing)
        let report = AuditReport(findings: findings, runnersExecuted: executed, runnersSkipped: skipped)
        return .succeeded(report: report, duration: Date().timeIntervalSince(started))
    }

    // MARK: - Build step

    private enum BuildOutcome { case success; case failure(Result) }

    private func runBuild(siteID: String, siteDirectory: URL) async -> BuildOutcome {
        let source = "audit:\(siteID):build"
        if let (containerSiteID, control) = await containerControlProvider() {
            return await runContainerBuild(
                containerSiteID: containerSiteID, control: control, siteDirectory: siteDirectory, source: source
            )
        }

        let plan = resolveBuildCommand(siteDirectory)
        let executable: URL
        let arguments: [String]
        switch plan {
        case .unavailable(let reason):
            return .failure(.failed(reason: reason, exitCode: nil, logTail: []))
        case .run(let exe, let args):
            executable = exe
            arguments = args
        }

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
            return .failure(.failed(reason: "couldn't spawn build: \(error)", exitCode: nil, logTail: []))
        }

        let reason = await withTaskCancellationHandler {
            await supervisor.waitForExit(handle)
        } onCancel: {
            // The audit was cancelled (e.g. a Shortcuts/Siri CancellableIntent). The backend
            // resumes our wait as `.terminated`, but the OS build process would otherwise keep
            // running — actually SIGTERM it so it doesn't finish after we've reported cancellation.
            Task { await supervisor.terminate(handle) }
        }
        // `waitForExit` only returns after the supervisor's per-pipe drain Tasks have finished,
        // so every byte the build wrote is already in `LogCenter` — filtering the snapshot by
        // source gives us the complete captured output for this build run.
        let tail = await logCenter.snapshot().filter { $0.source == source }
        switch reason {
        case .exited(let code) where code == 0:
            return .success
        case .exited(let code):
            return .failure(.failed(reason: "build failed", exitCode: code, logTail: tail))
        case .terminated:
            return .failure(.failed(reason: "build was terminated", exitCode: nil, logTail: tail))
        case .retriesExhausted(let lastCode):
            return .failure(.failed(reason: "build retries exhausted", exitCode: lastCode, logTail: tail))
        }
    }

    /// Runs `npm run build` inside the site's running container via `ContainerDeployExecutor` —
    /// the same `.build` step the deploy path uses (`DeployExecutor.swift`) — instead of the host
    /// process path, which is permanently unavailable after host Node's retirement (#70).
    private func runContainerBuild(
        containerSiteID: String,
        control: any LocalContainerControl,
        siteDirectory: URL,
        source: String
    ) async -> BuildOutcome {
        let executor = ContainerDeployExecutor(control: control, siteID: containerSiteID, logCenter: logCenter)
        let result = await executor.run(step: .build, siteDirectory: siteDirectory, environment: [:], source: source)
        let tail = await logCenter.snapshot().filter { $0.source == source }
        switch result.exitCode {
        case 0:
            return .success
        case nil:
            let reason = result.output.isEmpty ? "build was terminated" : result.output
            return .failure(.failed(reason: reason, exitCode: nil, logTail: tail))
        case let code?:
            return .failure(.failed(reason: "build failed", exitCode: code, logTail: tail))
        }
    }

    // MARK: - Default seams

    /// Host Node is retired (#70). Falls back to this only when `containerControlProvider` resolves
    /// nil (no running container) — the production path runs the build inside the container instead
    /// (see `runContainerBuild`).
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("audit build"))
    }

    /// Default runner set: `A11yAuditRunner` plus `SecurityTxtAuditRunner` (#843). SEO / perf /
    /// link-check runners are mechanical follow-ups that slot into this list without changing
    /// the actor or sheet UI (#86 follow-ups). `A11yAuditRunner` needs the same container access as
    /// the build step — its script also requires the guest's Node/tsx toolchain.
    public static func defaultRunners(containerControlProvider: @escaping ContainerControlProvider) -> [any AuditRunner] {
        [
            A11yAuditRunner(containerControlProvider: containerControlProvider),
            SecurityTxtAuditRunner()
        ]
    }
}
