import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for `A11yAuditRunner` — focuses on the JSON-parsing layer (the script's
/// `--json` output → `[AuditReport.Finding]`). The supervisor seam is injected so we
/// can serve canned JSON instead of actually running `tsx`.
struct A11yAuditRunnerTests {

    @Test("Parses error/warning/notice severities and maps to critical/warning/info")
    func parsesSeveritiesAndMapsCorrectly() throws {
        let raw = """
        {
          "pages": [],
          "issues": [
            {"page": "/", "rule": "alt-text", "severity": "error", "message": "Missing alt", "suggestion": "Add alt attribute"},
            {"page": "/about/", "rule": "heading-order", "severity": "warning", "message": "H1 follows H3", "suggestion": "Use one H1 per page"},
            {"page": "/blog/x/", "rule": "link-text", "severity": "notice", "message": "Generic link text 'click here'", "suggestion": "Use descriptive link text"}
          ],
          "totals": {"errors": 1, "warnings": 1, "notices": 1},
          "toolsRun": ["heuristic"]
        }
        """
        let findings = try A11yAuditRunner.parse(json: Data(raw.utf8))
        #expect(findings.count == 3)
        #expect(findings.allSatisfy { $0.category == .accessibility })
        #expect(findings.map(\.severity) == [.critical, .warning, .info])
        #expect(findings[0].title == "alt-text")
        #expect(findings[0].detail == "Missing alt")
        #expect(findings[0].remediation == "Add alt attribute")
        #expect(findings[0].location == "/")
        #expect(findings[2].location == "/blog/x/")
    }

    @Test("Empty issues array parses to an empty findings list")
    func emptyIssuesParsesToEmpty() throws {
        let raw = #"{"pages": [], "issues": [], "totals": {"errors": 0, "warnings": 0, "notices": 0}, "toolsRun": []}"#
        let findings = try A11yAuditRunner.parse(json: Data(raw.utf8))
        #expect(findings.isEmpty)
    }

    @Test("Unknown severity values throw a parse error")
    func unknownSeverityThrowsParseError() {
        let raw = #"{"issues": [{"page": "/", "rule": "x", "severity": "moderate", "message": "m", "suggestion": "s"}]}"#
        #expect(throws: Error.self) {
            try A11yAuditRunner.parse(json: Data(raw.utf8))
        }
    }

    @Test("Malformed JSON throws a parse error")
    func malformedJSONThrowsParseError() {
        let raw = "{ this is not json"
        #expect(throws: Error.self) {
            try A11yAuditRunner.parse(json: Data(raw.utf8))
        }
    }

    @Test("Tolerates absent optional fields (suggestion, wcag, selector)")
    func toleratesAbsentOptionalFields() throws {
        let raw = #"{"issues": [{"page": "/x", "rule": "r", "severity": "error", "message": "m"}]}"#
        let findings = try A11yAuditRunner.parse(json: Data(raw.utf8))
        #expect(findings.count == 1)
        #expect(findings[0].remediation == nil)
    }

    @Test("run() parses successful executor output into findings")
    func runParsesExecutorOutput() async throws {
        let raw = #"{"issues": [{"page": "/", "rule": "img-alt-missing", "severity": "error", "message": "m", "suggestion": "s"}]}"#
        let executor = FakeAuditExecutor(result: AuditStepResult(exitCode: 0, output: raw))
        let runner = A11yAuditRunner()
        let findings = try await runner.run(
            siteDirectory: URL(fileURLWithPath: "/site"), executor: executor, logCenter: LogCenter(), source: "audit:s:accessibility"
        )
        #expect(findings.count == 1)
        #expect(findings[0].title == "img-alt-missing")
    }

    @Test("run() throws scriptFailed when the executor reports no exit code (container unavailable)")
    func runThrowsWhenExecutorUnavailable() async {
        let executor = FakeAuditExecutor(result: AuditStepResult(exitCode: nil, output: "container isn't running"))
        let runner = A11yAuditRunner()
        await #expect(throws: A11yAuditRunner.Error.self) {
            _ = try await runner.run(
                siteDirectory: URL(fileURLWithPath: "/site"), executor: executor, logCenter: LogCenter(), source: "audit:s:accessibility"
            )
        }
    }
}

private struct FakeAuditExecutor: AuditExecutor {
    let result: AuditStepResult
    func run(step: AuditStep, siteDirectory: URL, source: String) async -> AuditStepResult { result }
}
