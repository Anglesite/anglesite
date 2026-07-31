import Foundation

/// Pluggable seam for one audit category (accessibility, SEO, performance, security).
/// Production implementations run against the container-executed build (see `AuditExecutor`);
/// tests inject closures or fakes that return canned `[Finding]`.
///
/// `source` is the `LogCenter` tag the runner should use for any subprocess output
/// (`audit:<siteID>:<runner>`), so the drawer/sheet can distinguish phases.
public protocol AuditRunner: Sendable {
    /// The single category every finding from this runner belongs to — also how
    /// ``AuditCommand`` labels the runner in `runnersExecuted`/`runnersSkipped`, so one runner
    /// never spans categories.
    var category: AuditReport.Finding.Category { get }
    /// Produces this category's findings against the already-built site (``AuditCommand`` runs
    /// the build step first). Returning `[]` means "checked, clean"; throwing means "couldn't
    /// check" — ``AuditCommand`` records the throw as a skip rather than failing the audit.
    func run(
        siteDirectory: URL,
        executor: any AuditExecutor,
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
///   1. `executor.run(step: .build, ...)` so `dist/` is fresh (the audit scripts walk built
///      HTML). Streams to `LogCenter` under `audit:<siteID>:build`. A non-zero exit (or a
///      pre-spawn refusal / cancellation) short-circuits to `.failed` — runners can't audit
///      what didn't build.
///   2. For each `AuditRunner`, call its `run(...)`. Successful runs add their
///      findings + record the category in `runnersExecuted`. Throwing runs are
///      recorded in `runnersSkipped` — one runner's missing tooling shouldn't
///      kill the whole audit.
///
/// Returns the aggregated `AuditReport` in `.succeeded`. The actor doesn't decide
/// what counts as a "passing" audit — that's the UI's job (e.g. show a green
/// badge if no `.critical` findings, regardless of warnings).
public actor AuditCommand {
    /// Terminal outcome of one audit run. "Succeeded" means the pipeline completed, not that the
    /// site is clean — a report full of critical findings is still `.succeeded`; only a failed
    /// build (or cancellation) produces `.failed`, because runners can't audit output that
    /// doesn't exist.
    public enum Result: Sendable, Equatable {
        /// The build completed and the runners were attempted; `report` aggregates their
        /// findings and skips. `duration` covers the whole pipeline for the UI's "took Ns" line.
        case succeeded(report: AuditReport, duration: TimeInterval)
        /// `logTail` carries the captured `audit:<siteID>:build` lines so the failure
        /// sheet can show *why* the build failed without the owner having to open the
        /// Debug pane. Empty for pre-spawn refusals (`.unavailable`, spawn errors) where
        /// no subprocess produced output.
        case failed(reason: String, exitCode: Int32?, logTail: [LogCenter.LogLine])
    }

    /// How to run a subprocess for a site directory — or why it can't be run. Consumed by
    /// `HostAuditExecutor`'s injectable resolver; the default `resolveBuildCommand`/
    /// `resolveA11yCommand` values below live here for the same reason `DeployCommand` keeps
    /// `LaunchPlan`/`CommandResolver` even though only `HostDeployExecutor` uses them now.
    public enum LaunchPlan: Sendable, Equatable {
        /// Spawn this executable (host-side, via `ProcessSupervisor`) for the step.
        case run(executable: URL, arguments: [String])
        /// The step can't run in this environment; `reason` becomes the step's failure output.
        /// This is the production default for every host-side step — host Node is retired (#70).
        case unavailable(reason: String)
    }

    /// Maps a site directory to a ``LaunchPlan`` for one step — the injection point tests use to
    /// substitute a stub executable for the retired host toolchain.
    public typealias CommandResolver = @Sendable (_ siteDirectory: URL) -> LaunchPlan

    private let logCenter: LogCenter
    private let executor: any AuditExecutor
    private let runners: [any AuditRunner]

    /// The defaults produce a command that fails explicitly rather than silently: the default
    /// ``HostAuditExecutor`` refuses both steps post host-Node retirement (#70), so production
    /// callers must inject a ``ContainerAuditExecutor`` for a live container. Tests swap
    /// `executor`/`runners` for fakes.
    public init(
        logCenter: LogCenter = .shared,
        executor: any AuditExecutor = HostAuditExecutor(),
        runners: [any AuditRunner] = AuditCommand.defaultRunners
    ) {
        self.logCenter = logCenter
        self.executor = executor
        self.runners = runners
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
                    executor: executor,
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
        let result = await executor.run(step: .build, siteDirectory: siteDirectory, source: source)
        let tail = await logCenter.snapshot().filter { $0.source == source }

        guard let code = result.exitCode else {
            // nil exit code → unavailable resolver, spawn failure, or termination (cancellation).
            if Task.isCancelled {
                return .failure(.failed(reason: "build was terminated", exitCode: nil, logTail: tail))
            }
            return .failure(.failed(reason: result.output, exitCode: nil, logTail: tail))
        }
        guard code == 0 else {
            return .failure(.failed(reason: "build failed", exitCode: code, logTail: tail))
        }
        return .success
    }

    // MARK: - Default seams

    /// Host Node is retired (#70). Audits must run through the container runtime — see
    /// `ContainerAuditExecutor`. `HostAuditExecutor.defaultResolver` uses this for the `.build`
    /// step so the command fails explicitly instead of spawning embedded Node.
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("audit build"))
    }

    /// Same as `resolveBuildCommand`, for the `.a11y` step. `A11yAuditRunner` used to spawn
    /// `npx tsx` on the host directly (bypassing this convention entirely); it now goes through
    /// `HostAuditExecutor.defaultResolver` like every other step.
    public static let resolveA11yCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("accessibility audit"))
    }

    /// Default runner set: `A11yAuditRunner` plus `SecurityTxtAuditRunner` (#843). SEO / perf /
    /// link-check runners are mechanical follow-ups that slot into this list without changing
    /// the actor or sheet UI (#86 follow-ups).
    public static let defaultRunners: [any AuditRunner] = [
        A11yAuditRunner(),
        SecurityTxtAuditRunner()
    ]
}
