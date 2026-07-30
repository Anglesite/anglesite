import Foundation

/// `AuditRunner` for accessibility: runs the plugin's `a11y-audit.ts` script with
/// `--json`, parses its structured output into `[AuditReport.Finding]`.
///
/// The script's report shape (`A11yAuditReport`) maps to `Finding`s as:
///   - `issue.severity == "error"`   → `.critical`
///   - `issue.severity == "warning"` → `.warning`
///   - `issue.severity == "notice"`  → `.info`
///   - `issue.rule`                  → `title`
///   - `issue.message`               → `detail`
///   - `issue.suggestion`            → `remediation`
///   - `issue.page`                  → `location`
///
/// The runner stays thin and stateless — all the parsing is a single static method
/// so it's trivially testable without spawning `tsx`.
public struct A11yAuditRunner: AuditRunner {
    public let category: AuditReport.Finding.Category = .accessibility

    /// Reached lazily, at the moment the script actually runs — mirrors
    /// `AuditCommand.ContainerControlProvider` / `AstroHTMLValidator.ContainerControlProvider`.
    public typealias ContainerControlProvider = @Sendable () async -> (siteID: String, control: any LocalContainerControl)?

    private let containerControlProvider: ContainerControlProvider

    public init(containerControlProvider: @escaping ContainerControlProvider = { nil }) {
        self.containerControlProvider = containerControlProvider
    }

    public func run(
        siteDirectory: URL,
        supervisor: ProcessSupervisor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
        let stdout = try await runScript(siteDirectory: siteDirectory, supervisor: supervisor)

        // The stdout may contain the markdown report (always written) plus the JSON object.
        // Find the JSON object by scanning for the first `{` and parsing from there.
        guard let jsonStart = stdout.firstIndex(of: "{") else {
            throw Error.noJSONInOutput
        }
        let jsonString = String(stdout[jsonStart...])
        return try Self.parse(json: Data(jsonString.utf8))
    }

    /// Runs `a11y-audit.ts --json` in the site's running container when one is available — the
    /// script needs the guest's Node/tsx toolchain, which no longer exists on the host after Node's
    /// retirement (#70) — falling back to the host `ProcessSupervisor` path otherwise (tests, and
    /// any caller that hasn't wired a container).
    private func runScript(siteDirectory: URL, supervisor: ProcessSupervisor) async throws -> String {
        if let (containerSiteID, control) = await containerControlProvider() {
            let result = try await control.exec(
                siteID: containerSiteID,
                argv: ["npx", "tsx", "scripts/a11y-audit.ts", "--json"],
                environment: [:],
                workingDirectory: "/workspace/site",
                onOutput: { _, _ in }
            )
            // Exit code is severity-aware — see the host-path comment below for the full contract.
            guard [0, 1, 2].contains(result.exitCode) else {
                throw Error.scriptFailed(exitCode: result.exitCode, stderr: result.stderr)
            }
            return result.stdout
        }

        let scriptPath = siteDirectory.appendingPathComponent("scripts/a11y-audit.ts").path
        // Routed through the supervisor so the spawn goes through the one supervised path
        // (under MAS sandbox, inherits the app-held per-site folder grant).
        let result = try await supervisor.run(
            executable: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: ["npx", "tsx", scriptPath, "--json"],
            currentDirectoryURL: siteDirectory
        )

        // The script writes a markdown report to `reports/a11y-report.md` *and* prints the
        // JSON on stdout when `--json` is passed. Exit code is severity-aware:
        //   0 → no errors AND no warnings
        //   1 → at least one WCAG violation
        //   2 → warnings only
        // We treat all three as "the script ran" — the findings list reflects the severity.
        // Anything else (3+) is unexpected; mirror it as a runner failure so the UI can show
        // "audit script couldn't run" rather than silently ignoring the issue.
        guard [0, 1, 2].contains(result.exitCode) else {
            throw Error.scriptFailed(exitCode: result.exitCode, stderr: result.stderr)
        }
        return result.stdout
    }

    public enum Error: Swift.Error, Equatable {
        case scriptFailed(exitCode: Int32, stderr: String)
        case noJSONInOutput
        case unknownSeverity(String)
    }

    // MARK: - JSON parsing

    /// Parses an `a11y-audit.ts --json` report into `[Finding]`. Exposed for tests.
    public static func parse(json data: Data) throws -> [AuditReport.Finding] {
        let decoded = try JSONDecoder().decode(WireReport.self, from: data)
        return try decoded.issues.map { issue in
            AuditReport.Finding(
                category: .accessibility,
                severity: try mapSeverity(issue.severity),
                title: issue.rule,
                detail: issue.message,
                remediation: issue.suggestion,
                location: issue.page
            )
        }
    }

    private static func mapSeverity(_ raw: String) throws -> AuditReport.Finding.Severity {
        switch raw {
        case "error":   return .critical
        case "warning": return .warning
        case "notice":  return .info
        default:        throw Error.unknownSeverity(raw)
        }
    }

    /// Wire shape of the audit script's `--json` output. We only decode the fields we use.
    private struct WireReport: Decodable {
        let issues: [WireIssue]

        struct WireIssue: Decodable {
            let page: String
            let rule: String
            let severity: String
            let message: String
            let suggestion: String?
        }
    }
}
