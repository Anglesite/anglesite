// Tests/AnglesiteCoreTests/AuditCommandProgressTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite(.serialized)
struct AuditCommandProgressTests {
    @Test("emits building, one running-per-runner with fractions, then finalizing")
    func milestones() async {
        let recorder = ProgressRecorder()
        let r1 = PassRunner(category: .accessibility)
        let r2 = PassRunner(category: .seo)
        let executor = HostAuditExecutor(
            resolveCommand: { step in
                switch step {
                case .build: return { _ in .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: []) }
                case .a11y: return { _ in .unavailable(reason: "not used by this fixture") }
                }
            }
        )
        let cmd = AuditCommand(executor: executor, runners: [r1, r2])
        _ = await cmd.audit(siteID: "s", siteDirectory: URL(fileURLWithPath: NSTemporaryDirectory()),
                            onProgress: { recorder.record($0) })
        let phases = recorder.phases()
        #expect(phases == ["building", "running", "running", "finalizing"])
    }
}

private struct PassRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    func run(siteDirectory: URL, executor: any AuditExecutor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] { [] }
}
