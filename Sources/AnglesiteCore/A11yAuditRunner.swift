import Foundation

/// `AuditRunner` for accessibility: runs `scripts/a11y-audit.ts` with `--json` via the shared
/// `AuditExecutor` (container-routed when a container is live; explicitly unavailable on host,
/// matching `AuditCommand`'s build step), and parses its structured output into
/// `[AuditReport.Finding]`.
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

    public init() {}

    public func run(
        siteDirectory: URL,
        executor: any AuditExecutor,
        logCenter: LogCenter,
        source: String
    ) async throws -> [AuditReport.Finding] {
        let result = await executor.run(step: .a11y, siteDirectory: siteDirectory, source: source)

        // The script writes a markdown report to `reports/a11y-report.md` *and* prints the
        // JSON on stdout when `--json` is passed. Exit code is severity-aware:
        //   0 → no errors AND no warnings
        //   1 → at least one WCAG violation
        //   2 → warnings only
        // We treat all three as "the script ran" — the findings list reflects the severity.
        // Anything else (including a nil exit code — pre-spawn refusal, container not running,
        // or a thrown exec) is unexpected; mirror it as a runner failure so the UI can show
        // "audit script couldn't run" rather than silently ignoring the issue.
        guard let exitCode = result.exitCode, [0, 1, 2].contains(exitCode) else {
            throw Error.scriptFailed(exitCode: result.exitCode, output: result.output)
        }

        // The output may contain the markdown report (always written) plus the JSON object.
        // Find the JSON object by scanning for the first `{` and parsing from there.
        guard let jsonStart = result.output.firstIndex(of: "{") else {
            throw Error.noJSONInOutput
        }
        let jsonString = String(result.output[jsonStart...])
        return try Self.parse(json: Data(jsonString.utf8))
    }

    public enum Error: Swift.Error, Equatable, CustomStringConvertible {
        case scriptFailed(exitCode: Int32?, output: String)
        case noJSONInOutput
        case unknownSeverity(String)

        /// Owner-facing text — this is what ends up in `AuditReport.SkippedRunner.reason` (via
        /// `AuditCommand`'s `"\(error)"` interpolation) and gets rendered verbatim in
        /// `AuditSheetView`, so it must never be the raw enum dump. `.scriptFailed` usually
        /// already carries an owner-facing message in `output` (e.g. `ContainerAuditExecutor`'s
        /// "Container isn't running…" or a build-tool error) — surface it as-is rather than
        /// re-wrapping it in jargon.
        public var description: String {
            switch self {
            case .scriptFailed(let exitCode, let output):
                if !output.isEmpty { return output }
                return "the accessibility check exited unexpectedly (code \(exitCode?.description ?? "unknown"))"
            case .noJSONInOutput:
                return "the accessibility check didn't produce a report — see the Debug pane for details."
            case .unknownSeverity(let raw):
                return "the accessibility check reported an unrecognized severity (\"\(raw)\")."
            }
        }
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
