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

    // MARK: - Container routing (#1101)

    @Test("When a container is available, the script runs inside it via npx tsx")
    func runsInContainerWhenAvailable() async throws {
        let raw = #"{"issues": [{"page": "/", "rule": "alt-text", "severity": "error", "message": "Missing alt"}]}"#
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: raw, stderr: "")
        )
        let runner = A11yAuditRunner(containerControlProvider: { (siteID: "site-abc", control: fake) })
        let findings = try await runner.run(
            siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
            supervisor: ProcessSupervisor(),
            logCenter: LogCenter(),
            source: "audit:site-abc:accessibility"
        )
        #expect(findings.count == 1)
        #expect(findings[0].title == "alt-text")

        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].siteID == "site-abc")
        #expect(calls[0].argv == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
        #expect(calls[0].cwd == "/workspace/site")
    }

    @Test("A non-severity exit code from the container run is a runner failure")
    func containerNonSeverityExitCodeThrows() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 3, stdout: "", stderr: "tsx crashed")
        )
        let runner = A11yAuditRunner(containerControlProvider: { (siteID: "site-abc", control: fake) })
        await #expect(throws: A11yAuditRunner.Error.self) {
            try await runner.run(
                siteDirectory: URL(fileURLWithPath: "/host/irrelevant"),
                supervisor: ProcessSupervisor(),
                logCenter: LogCenter(),
                source: "audit:site-abc:accessibility"
            )
        }
    }
}
