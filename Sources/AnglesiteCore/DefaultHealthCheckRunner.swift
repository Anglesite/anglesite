import Foundation

/// Production `HealthCheckRunner` for the Phase 9 health badge. Runs
/// `npm run build` (streamed to `LogCenter` under `health:<siteID>:build`)
/// then invokes `PreDeployCheck.defaultPreflight` to scan the result.
///
/// Throws `HealthRunnerError.build` when the build step fails, surfacing
/// the exit code; the scan's `.error` outcome is forwarded as-is via the
/// `PreDeployCheck.Outcome` return so the badge can render the actual
/// remediation `PreDeployCheck` already computed.
public struct DefaultHealthCheckRunner: HealthCheckRunner {
    private let supervisor: ProcessSupervisor
    private let logCenter: LogCenter
    private let resolveBuildCommand: @Sendable (URL) -> DeployCommand.LaunchPlan
    private let preflight: DeployCommand.PreflightChecker

    /// Every dependency is an injectable seam with a production default, so tests can drive a
    /// full health run without spawning real processes; note the *build* default is
    /// ``DeployCommand/resolveBuildCommand`` (which reports host-Node retirement), so a
    /// default-constructed runner only works where a container runtime injects a real resolver.
    public init(
        supervisor: ProcessSupervisor = .shared,
        logCenter: LogCenter = .shared,
        resolveBuildCommand: @escaping @Sendable (URL) -> DeployCommand.LaunchPlan = DeployCommand.resolveBuildCommand,
        preflight: @escaping DeployCommand.PreflightChecker = DeployCommand.defaultPreflight
    ) {
        self.supervisor = supervisor
        self.logCenter = logCenter
        self.resolveBuildCommand = resolveBuildCommand
        self.preflight = preflight
    }

    /// Builds the site, then scans the fresh `dist/` — the `HealthCheckRunner` requirement.
    /// Any non-zero/terminated build throws `HealthRunnerError.build(_:)` with a human-readable
    /// reason; a scan that ran but found problems is *not* a throw — it comes back as the
    /// returned outcome, so the badge can render the remediation `PreDeployCheck` computed.
    public func run(siteID: String, siteDirectory: URL) async throws -> PreDeployCheck.Outcome {
        // 1. Build. Stream output under a health-namespaced source so the Debug pane
        //    can distinguish health rebuilds from deploy rebuilds.
        let plan = resolveBuildCommand(siteDirectory)
        let executable: URL
        let arguments: [String]
        switch plan {
        case .unavailable(let reason):
            throw HealthRunnerError.build(reason)
        case .run(let exe, let args):
            executable = exe
            arguments = args
        }

        let source = "health:\(siteID):build"
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
            throw HealthRunnerError.build("couldn't spawn build: \(error)")
        }

        let reason = await supervisor.waitForExit(handle)
        switch reason {
        case .exited(let code) where code == 0:
            break
        case .exited(let code):
            throw HealthRunnerError.build("npm run build failed (exit \(code))")
        case .terminated:
            throw HealthRunnerError.build("build was terminated")
        case .retriesExhausted(let lastCode):
            throw HealthRunnerError.build("build retries exhausted (exit \(lastCode))")
        }

        // 2. Scan. Forward .passed / .blocked / .error as-is — the .error case carries
        //    its own remediation string and the badge surfaces it via lastOutcome.
        return await preflight(siteDirectory)
    }
}
