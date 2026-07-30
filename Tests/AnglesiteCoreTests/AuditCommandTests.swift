import Testing
import Foundation
@testable import AnglesiteCore

/// Tests for `AuditCommand` — the deterministic structured-audit path that replaces
/// the chat-routed `/anglesite:check` pill for one-click audits (#86).
///
/// The actor owns a build step + a list of pluggable `AuditRunner`s. Tests use a
/// `FakeAuditRunner` to script `[Finding]` results without spawning `tsx`. The
/// `JSONAuditRunnerTests` cover the parser separately so `AuditCommand` only has to
/// know about runner success/failure, not the audit script's JSON shape.
struct AuditCommandTests {

    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeCommand(
        runners: [any AuditRunner],
        build: @escaping AuditCommand.CommandResolver = { _ in
            .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: [])
        }
    ) -> (AuditCommand, ProcessSupervisor, LogCenter) {
        let supervisor = ProcessSupervisor()
        let center = LogCenter()
        let cmd = AuditCommand(
            supervisor: supervisor,
            logCenter: center,
            resolveBuildCommand: build,
            runners: runners
        )
        return (cmd, supervisor, center)
    }

    private func shFixture(_ script: String) -> AuditCommand.LaunchPlan {
        .run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", script])
    }

    @Test("default build resolver fails explicitly after host Node retirement")
    func defaultBuildResolverUnavailable() {
        #expect(
            AuditCommand.resolveBuildCommand(tmpDir)
                == .unavailable(reason: "audit build must run in the container runtime; host Node has been retired")
        )
    }

    // MARK: Cancellation

    /// Poll `center` for a marker line up to `timeout`. Returns true once it appears.
    private func waitForMarker(_ marker: String, in center: LogCenter, timeout: Duration = .seconds(3)) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            if await center.snapshot().contains(where: { $0.text.contains(marker) }) { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return false
    }

    @Test("Cancelling the task actually SIGTERMs the in-flight build subprocess")
    func cancellationTerminatesBuild() async {
        // The fixture sets a SIGTERM trap, echoes __STARTED__, then blocks. We cancel exactly once
        // the build is running (synchronized on __STARTED__, not a fixed delay), and assert the
        // result is `.failed(terminated)` AND the process reports the SIGTERM trap — proving it was
        // actually killed, not orphaned.
        let (cmd, _, center) = makeCommand(
            runners: [FakeAuditRunner(category: .accessibility, result: .success([]))],
            build: { _ in self.shFixture("trap 'echo __SIGTERM__; exit 143' TERM; echo __STARTED__; sleep 20; echo __COMPLETED__") }
        )
        let task = Task { await cmd.audit(siteID: "site", siteDirectory: tmpDir) }
        #expect(await waitForMarker("__STARTED__", in: center, timeout: .seconds(10)), "build never started")
        task.cancel()
        let result = await task.value
        guard case .failed(let reason, _, _) = result else {
            Issue.record("expected .failed(terminated), got \(result)")
            return
        }
        #expect(reason.contains("terminated"))
        #expect(await waitForMarker("__SIGTERM__", in: center, timeout: .seconds(10)), "build subprocess was not actually SIGTERM'd")
    }

    // MARK: Build failure

    @Test("Fails when the build step exits non-zero")
    func failsWhenBuildExitsNonZero() async {
        let (cmd, _, _) = makeCommand(
            runners: [FakeAuditRunner(category: .accessibility, result: .success([]))],
            build: { _ in self.shFixture("exit 1") }
        )
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit, _) = result else {
            Issue.record("expected .failed, got \(result)")
            return
        }
        #expect(reason.lowercased().contains("build"), "reason should name the failing step: \(reason)")
        #expect(!reason.lowercased().contains("exit"), "exit code lives in the exitCode field; encoding it into reason caused the view to render '(exit N) (exit N)'")
        #expect(exit == 1)
    }

    @Test("Failed build carries its captured stdout+stderr as logTail so the failure sheet can show why")
    func failedBuildCapturesLogTail() async {
        let (cmd, _, _) = makeCommand(
            runners: [FakeAuditRunner(category: .accessibility, result: .success([]))],
            build: { _ in self.shFixture("echo build-started; echo build-broke >&2; exit 1") }
        )
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .failed(_, _, let tail) = result else {
            Issue.record("expected .failed, got \(result)")
            return
        }
        let texts = tail.map(\.text)
        #expect(texts.contains("build-started"), "stdout line missing from logTail: \(texts)")
        #expect(texts.contains("build-broke"), "stderr line missing from logTail: \(texts)")
        #expect(tail.allSatisfy { $0.source == "audit:site:build" },
                "logTail must only contain this build's output, not unrelated LogCenter sources")
        #expect(tail.contains { $0.stream == .stderr },
                "stderr stream metadata must be preserved so the sheet can color it red")
    }

    @Test("Fails when the build resolver reports unavailable")
    func failsWhenBuildResolverReportsUnavailable() async {
        let (cmd, _, _) = makeCommand(
            runners: [FakeAuditRunner(category: .accessibility, result: .success([]))],
            build: { _ in .unavailable(reason: "vendored npm not found — rebuild the app") }
        )
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit, let tail) = result else {
            Issue.record("expected .failed, got \(result)")
            return
        }
        #expect(reason == "vendored npm not found — rebuild the app")
        #expect(exit == nil)
        #expect(tail.isEmpty, "pre-spawn refusals have no build output to show")
    }

    // MARK: Empty runner list

    @Test("Empty runners list returns a success with no findings")
    func emptyRunnersListReturnsSuccessWithNoFindings() async {
        let (cmd, _, _) = makeCommand(runners: [])
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .succeeded(let report, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(report.findings.isEmpty)
        #expect(report.runnersExecuted.isEmpty)
        #expect(report.runnersSkipped.isEmpty)
    }

    // MARK: Happy path — single runner

    @Test("Single accessibility runner: findings are returned and category is recorded")
    func singleAccessibilityRunnerSucceeds() async {
        let finding = AuditReport.Finding(
            category: .accessibility,
            severity: .critical,
            title: "Missing alt text",
            detail: "<img> on /about/ has no alt attribute",
            remediation: "Add a one-sentence description",
            location: "src/pages/about.astro"
        )
        let (cmd, _, _) = makeCommand(
            runners: [FakeAuditRunner(category: .accessibility, result: .success([finding]))]
        )
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .succeeded(let report, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(report.findings == [finding])
        #expect(report.runnersExecuted == [.accessibility])
        #expect(report.runnersSkipped.isEmpty)
    }

    // MARK: Runner failure → skipped, not fatal

    @Test("A runner that throws is recorded as skipped — the audit still succeeds")
    func runnerThatThrowsIsRecordedAsSkipped() async {
        struct BoomError: Error { var localizedDescription: String { "a11y tooling missing" } }
        let accessibilityFinding = AuditReport.Finding(
            category: .accessibility, severity: .info, title: "fine", detail: "", remediation: nil, location: nil
        )
        let (cmd, _, _) = makeCommand(runners: [
            FakeAuditRunner(category: .accessibility, result: .success([accessibilityFinding])),
            FakeAuditRunner(category: .performance, result: .failure(BoomError()))
        ])
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .succeeded(let report, _) = result else {
            Issue.record("expected .succeeded (runner failures are not fatal), got \(result)")
            return
        }
        #expect(report.findings == [accessibilityFinding])
        #expect(report.runnersExecuted == [.accessibility])
        #expect(report.runnersSkipped.count == 1)
        #expect(report.runnersSkipped.first?.category == .performance)
    }

    // MARK: Multiple runners — order preserved

    @Test("Findings from multiple runners are concatenated in runner order")
    func findingsFromMultipleRunnersAreConcatenated() async {
        let a = AuditReport.Finding(category: .accessibility, severity: .critical, title: "a", detail: "", remediation: nil, location: nil)
        let s = AuditReport.Finding(category: .seo, severity: .warning, title: "s", detail: "", remediation: nil, location: nil)
        let p = AuditReport.Finding(category: .performance, severity: .info, title: "p", detail: "", remediation: nil, location: nil)
        let (cmd, _, _) = makeCommand(runners: [
            FakeAuditRunner(category: .accessibility, result: .success([a])),
            FakeAuditRunner(category: .seo, result: .success([s])),
            FakeAuditRunner(category: .performance, result: .success([p]))
        ])
        let result = await cmd.audit(siteID: "site", siteDirectory: tmpDir)
        guard case .succeeded(let report, _) = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        #expect(report.findings == [a, s, p])
        #expect(report.runnersExecuted == [.accessibility, .seo, .performance])
    }

    // MARK: Container-routed build (#1101)

    /// Before #1101, `AuditCommand` always used `resolveBuildCommand` (permanently `.unavailable`
    /// after host Node's retirement) even when a container was running — the audit could never
    /// succeed. This proves the build step now runs inside an available container instead.
    @Test("Build runs inside the container when a containerControlProvider resolves one")
    func buildRunsInContainerWhenAvailable() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "built", stderr: "")
        )
        let cmd = AuditCommand(
            // A resolver that would fail the audit if it were ever consulted — proves the
            // container path is taken instead of falling through to the host resolver.
            resolveBuildCommand: { _ in .unavailable(reason: "should not be consulted") },
            containerControlProvider: { (siteID: "site-abc", control: fake) },
            runners: [FakeAuditRunner(category: .accessibility, result: .success([]))]
        )
        let result = await cmd.audit(siteID: "site-abc", siteDirectory: tmpDir)
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        let calls = await fake.execCalls
        #expect(calls.count == 1)
        #expect(calls[0].argv == ["npm", "run", "build"])
        #expect(calls[0].siteID == "site-abc")
    }

    @Test("A non-zero container build exit fails the audit with logTail from the guest output")
    func containerBuildFailureCarriesLogTail() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 1, stdout: "build broke", stderr: ""),
            execStdoutLines: ["build broke"]
        )
        let cmd = AuditCommand(
            resolveBuildCommand: { _ in .unavailable(reason: "should not be consulted") },
            containerControlProvider: { (siteID: "site-abc", control: fake) },
            runners: [FakeAuditRunner(category: .accessibility, result: .success([]))]
        )
        let result = await cmd.audit(siteID: "site-abc", siteDirectory: tmpDir)
        guard case .failed(let reason, let exit, let tail) = result else {
            Issue.record("expected .failed, got \(result)")
            return
        }
        #expect(reason.lowercased().contains("build"))
        #expect(exit == 1)
        #expect(tail.contains { $0.text == "build broke" })
    }
}

// MARK: - Fake runner

private struct FakeAuditRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    let result: Result<[AuditReport.Finding], Error>

    func run(siteDirectory: URL, supervisor: ProcessSupervisor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] {
        switch result {
        case .success(let findings): return findings
        case .failure(let error):    throw error
        }
    }
}
