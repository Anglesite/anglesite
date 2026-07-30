// Tests/AnglesiteCoreTests/AuditCommandCancellationTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite(.serialized)
struct AuditCommandCancellationTests {
    @Test("cancelling after the first runner skips the remaining runners")
    func cancelBetweenRunners() async throws {
        let counter = RunCounter()
        let holder = AuditTaskHolder()
        let first = ClosureRunner(category: .accessibility) { await counter.bump(); await holder.cancel(); return [] }
        let second = ClosureRunner(category: .seo) { await counter.bump(); return [] }
        // The build must succeed (exit 0 via `true`) so the runner loop is reached at all.
        let executor = HostAuditExecutor(
            resolveCommand: { step in
                switch step {
                case .build: return { _ in .run(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: []) }
                case .a11y: return { _ in .unavailable(reason: "not used by this fixture") }
                }
            }
        )
        let cmd = AuditCommand(executor: executor, runners: [first, second])
        let task = Task { await cmd.audit(siteID: "s", siteDirectory: URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)) }
        await holder.hold(task)
        let result = await task.value
        #expect(await counter.value == 1)   // only the first runner ran
        // A cancelled audit must return .failed, not .succeeded with a partial report
        #expect(result == .failed(reason: "audit canceled", exitCode: nil, logTail: []))
    }
}

private actor RunCounter { private(set) var value = 0; func bump() { value += 1 } }
private actor AuditTaskHolder {
    private var pending = false
    private var task: Task<AuditCommand.Result, Never>?
    func cancel() { pending = true; task?.cancel() }
    func hold(_ t: Task<AuditCommand.Result, Never>) { task = t; if pending { t.cancel() } }
}
private struct ClosureRunner: AuditRunner {
    let category: AuditReport.Finding.Category
    let body: @Sendable () async -> [AuditReport.Finding]
    func run(siteDirectory: URL, executor: any AuditExecutor, logCenter: LogCenter, source: String) async throws -> [AuditReport.Finding] {
        await body()
    }
}
