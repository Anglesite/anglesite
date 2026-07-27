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

    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    private let resolveBuildCommand: CommandResolver
    private let runners: [any AuditRunner]

    public init(
        supervisor: ProcessSupervisor = .shared,
        logCenter: LogCenter = .shared,
        resolveBuildCommand: @escaping CommandResolver = AuditCommand.resolveBuildCommand,
        runners: [any AuditRunner] = AuditCommand.defaultRunners
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.resolveBuildCommand = resolveBuildCommand
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

        let source = "audit:\(siteID):build"
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

    // MARK: - Default seams

    /// Host Node is retired (#70). Audits must run through the container runtime once validation
    /// lands; until then the command fails explicitly instead of spawning embedded Node.
    public static let resolveBuildCommand: CommandResolver = { siteDirectory in
        .unavailable(reason: HostNodeRetirement.reason("audit build"))
    }

    /// Default runner set. Starts with just `A11yAuditRunner`; SEO / perf / link-check
    /// runners are mechanical follow-ups that slot into this list without changing
    /// the actor or sheet UI (#86 follow-ups).
    public static let defaultRunners: [any AuditRunner] = [
        A11yAuditRunner(),
        SecurityTxtAuditRunner()
    ]
}
