import Testing
import Foundation
@testable import AnglesiteCore

/// When a `LocalContainerControl` is supplied to `AuditCommand` via `ContainerAuditExecutor`,
/// the audit routes through it; when absent (`HostAuditExecutor`) it never touches a container.
/// Mirrors `DeployExecutorSelectionTests`.
@Suite("AuditExecutor selection")
struct AuditExecutorSelectionTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    // MARK: - Container path

    @Test("when a container control is supplied, exec() is called on it for the build step")
    func containerControlRoutesExecToContainer() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: #"{"issues":[]}"#, stderr: ""),
            execStdoutLines: []
        )
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-1", logCenter: LogCenter())
        let cmd = AuditCommand(executor: executor, runners: [])
        _ = await cmd.audit(siteID: "site-1", siteDirectory: tmpDir)
        let calls = await fake.execCalls
        #expect(calls.count == 1, "the build step must route through container control.exec()")
        #expect(calls[0].siteID == "site-1")
        #expect(calls[0].argv == ["npm", "run", "build"])
    }

    @Test("all runners' steps route through the container executor, in order, after a successful build")
    func runnerStepsRouteViaContainer() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: #"{"issues":[]}"#, stderr: ""),
            execStdoutLines: []
        )
        let executor = ContainerAuditExecutor(control: fake, siteID: "site-1", logCenter: LogCenter())
        let cmd = AuditCommand(executor: executor, runners: [A11yAuditRunner()])
        let result = await cmd.audit(siteID: "site-1", siteDirectory: tmpDir)
        guard case .succeeded = result else {
            Issue.record("expected .succeeded, got \(result)")
            return
        }
        let calls = await fake.execCalls
        #expect(calls.count == 2)
        #expect(calls[0].argv == ["npm", "run", "build"])
        #expect(calls[1].argv == ["npx", "tsx", "scripts/a11y-audit.ts", "--json"])
    }

    // MARK: - Host path (no container control → no exec calls on any container control)

    @Test("when no container control is supplied, container control exec() is never called")
    func hostPathDoesNotCallContainerExec() async {
        let fake = FakeLocalContainerControl(
            startResult: .failure(.virtualizationUnavailable),
            execResult: ContainerExecResult(exitCode: 0, stdout: "", stderr: ""),
            execStdoutLines: []
        )
        let hostExecutor = HostAuditExecutor(
            resolveCommand: { _ in { _ in .unavailable(reason: "host path chosen") } }
        )
        let cmd = AuditCommand(executor: hostExecutor, runners: [])
        _ = await cmd.audit(siteID: "site-1", siteDirectory: tmpDir)
        let calls = await fake.execCalls
        #expect(calls.isEmpty, "container control.exec() must NOT be called when the host executor is used")
    }
}
