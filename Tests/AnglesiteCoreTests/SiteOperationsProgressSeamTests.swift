import Testing
import Foundation
@testable import AnglesiteCore

@Suite(.serialized)
struct SiteOperationsProgressSeamTests {
    @Test("the no-onProgress overload still resolves and forwards nil")
    func overloadCompiles() async {
        // A SiteOperations with a fake factory whose commands return immediately.
        let ops = SiteOperations(factory: NoopCommandFactory(), store: .shared)
        // Just assert the zero-arg overload is callable (compile-level contract).
        let site = SiteStore.Site(
            id: "nope",
            name: "nope",
            packageURL: URL(fileURLWithPath: "/tmp/nope.anglesite"),
            isValid: false,
            missingSentinels: []
        )
        _ = await ops.deploy(site: site)                    // overload
        _ = await ops.deploy(site: site, onProgress: nil)  // primary
    }
}

/// Minimal CommandFactory whose actors fail fast (no subprocess) — we only exercise signatures here.
private struct NoopCommandFactory: CommandFactory {
    func deploy() -> DeployCommand { DeployCommand(tokenSource: { nil }) }
    func backup() -> BackupCommand { BackupCommand(runner: { _, _ in .init(stdout: "", stderr: "", exitCode: 1) }, streamer: { _, _, _ in (1, "") }) }
    func audit() -> AuditCommand {
        AuditCommand(
            executor: HostAuditExecutor(resolveCommand: { _ in { _ in .unavailable(reason: "noop") } }),
            runners: []
        )
    }
    func socialWorkerProvision() -> SocialWorkerProvisionCommand { SocialWorkerProvisionCommand(tokenSource: { nil }) }
}
