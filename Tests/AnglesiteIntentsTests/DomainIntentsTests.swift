import Testing
import Foundation
@testable import AnglesiteIntents
import AnglesiteCore

extension AppIntentsTests {
    @Suite("DomainIntents")
    struct DomainIntentsTests {
        @Test("ListDNSRecordsIntent summarizes the domain's records")
        func listSummarizes() async throws {
            let fake = FakeDomainOps(records: [
                DNSRecord(id: "r1", type: "MX", name: "example.com", content: "mail.example.com", ttl: 1, proxied: false),
            ])
            var intent = ListDNSRecordsIntent()
            intent.domain = "example.com"
            let dialog = await DomainOperationsOverride.$scoped.withValue(fake) {
                await intent.performForTesting()
            }
            #expect(dialog.contains("1 DNS record"))
            #expect(dialog.contains("Email routing"))
        }

        @Test("ListDNSRecordsIntent reports zero records in plain English")
        func listEmpty() async throws {
            let fake = FakeDomainOps(records: [])
            var intent = ListDNSRecordsIntent()
            intent.domain = "example.com"
            let dialog = await DomainOperationsOverride.$scoped.withValue(fake) {
                await intent.performForTesting()
            }
            #expect(dialog == "example.com has no DNS records.")
        }

        @Test("ListDNSRecordsIntent surfaces a failure")
        func listFails() async throws {
            let fake = FakeDomainOps(listError: .noToken)
            var intent = ListDNSRecordsIntent()
            intent.domain = "example.com"
            let dialog = await DomainOperationsOverride.$scoped.withValue(fake) {
                await intent.performForTesting()
            }
            #expect(dialog.contains("Couldn't"))
        }

        @Test("AddDNSRecordIntent adds the record and reports success")
        func addSucceeds() async throws {
            let fake = FakeDomainOps()
            var intent = AddDNSRecordIntent()
            intent.domain = "example.com"
            intent.type = "TXT"
            intent.name = "_atproto"
            intent.content = "did=did:plc:abc"
            intent.ttl = 1
            let dialog = await DomainOperationsOverride.$scoped.withValue(fake) {
                await intent.applyForTesting()
            }
            #expect(dialog.contains("Added"))
            #expect(fake.addedRecords.count == 1)
            #expect(fake.addedRecords.first?.name == "_atproto")
            #expect(fake.addedRecords.first?.priority == nil)
        }

        @Test("AddDNSRecordIntent threads priority through for MX records")
        func addMXWithPriority() async throws {
            let fake = FakeDomainOps()
            var intent = AddDNSRecordIntent()
            intent.domain = "example.com"
            intent.type = "MX"
            intent.name = "example.com"
            intent.content = "mail.example.com"
            intent.ttl = 1
            intent.priority = 10
            let dialog = await DomainOperationsOverride.$scoped.withValue(fake) {
                await intent.applyForTesting()
            }
            #expect(dialog.contains("Added"))
            #expect(fake.addedRecords.first?.priority == 10)
        }

        @Test("DeleteDNSRecordIntent deletes the record and reports success")
        func deleteSucceeds() async throws {
            let fake = FakeDomainOps()
            var intent = DeleteDNSRecordIntent()
            intent.domain = "example.com"
            intent.recordID = "r1"
            let dialog = await DomainOperationsOverride.$scoped.withValue(fake) {
                await intent.applyForTesting()
            }
            #expect(dialog.contains("Deleted"))
            #expect(fake.deletedRecordIDs == ["r1"])
        }
    }
}

final class FakeDomainOps: DomainOperationsService, @unchecked Sendable {
    private let records: [DNSRecord]
    private let listError: DomainOperationError?
    private(set) var addedRecords: [(name: String, type: String, priority: Int?)] = []
    private(set) var deletedRecordIDs: [String] = []

    init(records: [DNSRecord] = [], listError: DomainOperationError? = nil) {
        self.records = records
        self.listError = listError
    }

    func listRecords(domain: String) async -> Result<[DNSRecord], DomainOperationError> {
        if let listError { return .failure(listError) }
        return .success(records)
    }
    func addRecord(
        domain: String, type: String, name: String, content: String, ttl: Int, priority: Int?,
        purpose: String?, sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        addedRecords.append((name: name, type: type, priority: priority))
        return .success(())
    }
    func deleteRecord(
        domain: String, recordID: String, type: String?, name: String?, content: String?,
        sourceDirectory: URL?
    ) async -> Result<Void, DomainOperationError> {
        deletedRecordIDs.append(recordID)
        return .success(())
    }
}
