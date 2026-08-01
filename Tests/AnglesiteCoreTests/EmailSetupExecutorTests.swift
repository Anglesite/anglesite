import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct EmailSetupExecutorTests {
    private actor RecordingOps: DomainOperationsService {
        var addedPurposes: [String?] = []
        var addedTypes: [String] = []
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> {
            addedPurposes.append(purpose)
            addedTypes.append(type)
            return .success(())
        }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }

    @Test func applyAddsEveryRecordTaggedWithProvider() async {
        let ops = RecordingOps()
        let plan = EmailSetupPlanner.dnsPlan(for: .fastmail, domain: "example.com", dmarcReportEmail: "me@example.com")
        let executor = EmailSetupExecutor(ops: ops)
        let result = await executor.apply(plan: plan, domain: "example.com", dmarcReportEmail: "me@example.com", sourceDirectory: nil)
        #expect(result.addedCount == plan.records.count)
        #expect(result.failures.isEmpty)
        let purposes = await ops.addedPurposes
        #expect(purposes.allSatisfy { $0 == "email:fastmail" })
    }

    @Test func applyWritesEmailSectionThrough() async throws {
        // Uses the real `DomainOperations` (backed by `FakeReader`/`FakeWriter` from
        // `DomainOperationsServiceTests.swift`, visible here since both files are in the same
        // `AnglesiteCoreTests` target) rather than `RecordingOps`, so this test exercises
        // `addRecord`'s actual documented `dns.managedRecords` write-through instead of any
        // bookkeeping `EmailSetupExecutor` might otherwise duplicate.
        let ops = DomainOperations(reader: FakeReader(zoneID: "z1"), writer: FakeWriter(), tokenProvider: { "tok" })
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let plan = EmailSetupPlanner.dnsPlan(for: .icloudPlus, domain: "example.com", dmarcReportEmail: "me@example.com")
        let executor = EmailSetupExecutor(ops: ops)
        _ = await executor.apply(plan: plan, domain: "example.com", dmarcReportEmail: "me@example.com", sourceDirectory: tmp)

        let config = try DomainConfigStore(sourceDirectory: tmp).load()
        #expect(config.email?.provider == "icloud-plus")
        #expect(config.email?.dmarcReportEmail == "me@example.com")
        #expect(config.dns?.managedRecords?.count == plan.records.count)
    }

    @Test func applyContinuesPastPerRecordFailures() async {
        let ops = FailingOps()
        let plan = EmailSetupPlanner.dnsPlan(for: .zohoMail, domain: "example.com", dmarcReportEmail: "me@example.com")
        let executor = EmailSetupExecutor(ops: ops)
        let result = await executor.apply(plan: plan, domain: "example.com", dmarcReportEmail: "me@example.com", sourceDirectory: nil)
        #expect(result.addedCount == 0)
        #expect(result.failures.count == plan.records.count)
    }

    private actor FailingOps: DomainOperationsService {
        func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> { .success([]) }
        func addRecord(
            domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
            purpose: String?, sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .failure(.noToken) }
        func deleteRecord(
            domain: String, recordID: String, type: String?, name: String?, content: String?,
            sourceDirectory: URL?
        ) async -> Result<Void, DomainOperationError> { .success(()) }
    }
}
