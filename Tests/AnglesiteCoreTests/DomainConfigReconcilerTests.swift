import Testing
import Foundation
@testable import AnglesiteCore

struct DomainConfigReconcilerTests {
    @Test("an empty plan produces zero applied, no failures, and re-audits")
    func emptyPlanNoOps() async {
        let reader = MockCloudflareReader()
        let writer = MockCloudflareWriter()
        let reconciler = DomainConfigReconciler(reader: reader, writer: writer)
        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: []),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())
        #expect(result.appliedCount == 0)
        #expect(result.failedItems.isEmpty)
        #expect(writer.calls.isEmpty)
    }

    @Test("createManagedRecord calls addDNSRecord with the declared content and a namespaced comment")
    func createManagedRecordAddsWithComment() async {
        let writer = MockCloudflareWriter()
        let reconciler = DomainConfigReconciler(reader: MockCloudflareReader(), writer: writer)
        let record = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: [.createManagedRecord(record)]),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())

        #expect(result.appliedCount == 1)
        #expect(result.failedItems.isEmpty)
        let added = writer.addedRecords.first
        #expect(added?.type == "TXT")
        #expect(added?.name == "_atproto")
        #expect(added?.content == "did=did:plc:abc")
        #expect(added?.comment == "anglesite:verification:bluesky")
    }

    @Test("createManagedRecord with no purpose adds with no comment")
    func createManagedRecordWithNoPurposeAddsWithNoComment() async {
        let writer = MockCloudflareWriter()
        let reconciler = DomainConfigReconciler(reader: MockCloudflareReader(), writer: writer)
        let record = DomainConfig.DNSRecord(type: "A", name: "@", content: "192.0.2.1")
        _ = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: [.createManagedRecord(record)]),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())
        #expect(writer.addedRecords.first?.comment == nil)
    }

    @Test("replaceManagedRecord deletes the stale record then creates the declared one")
    func replaceManagedRecordDeletesThenCreates() async {
        let writer = MockCloudflareWriter()
        let reconciler = DomainConfigReconciler(reader: MockCloudflareReader(), writer: writer)
        let record = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:NEW", purpose: "verification:bluesky")
        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: [.replaceManagedRecord(staleRecordID: "stale1", declared: record)]),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())

        #expect(result.appliedCount == 1)
        #expect(writer.calls.contains("deleteDNSRecord:stale1"))
        #expect(writer.addedRecords.first?.content == "did=did:plc:NEW")
        #expect(writer.addedRecords.first?.comment == "anglesite:verification:bluesky")
    }

    @Test("hardenEdge items apply via the writer, same as HardenExecutor")
    func hardenEdgeItemsApplyViaWriter() async {
        let writer = MockCloudflareWriter()
        let reconciler = DomainConfigReconciler(reader: MockCloudflareReader(), writer: writer)
        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: [.hardenEdge(.enableDNSSEC), .hardenEdge(.enableBotFightMode)]),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())

        #expect(result.appliedCount == 2)
        #expect(writer.calls.contains("enableDNSSEC"))
        #expect(writer.calls.contains("setBotFightMode"))
    }

    @Test("a per-item failure does not abort remaining items")
    func perItemFailureResilience() async {
        let writer = MockCloudflareWriter()
        writer.failOn = "enableDNSSEC"
        let reconciler = DomainConfigReconciler(reader: MockCloudflareReader(), writer: writer)
        let record = DomainConfig.DNSRecord(type: "A", name: "@", content: "192.0.2.1")
        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: [.hardenEdge(.enableDNSSEC), .createManagedRecord(record)]),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())

        #expect(result.appliedCount == 1)
        #expect(result.failedItems.count == 1)
        #expect(result.failedItems[0].item == .hardenEdge(.enableDNSSEC))
    }

    @Test("post-audit findings are recomputed against fresh live state")
    func postAuditFindingsRecomputed() async {
        let reader = MockCloudflareReader()
        reader.dnsRecords = []
        let writer = MockCloudflareWriter()
        let reconciler = DomainConfigReconciler(reader: reader, writer: writer)
        let stillMissing = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let declared = DomainConfig(dns: .init(managedRecords: [stillMissing]))

        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: []),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: declared)

        #expect(result.postAuditFindings.contains { $0.title == "Missing managed DNS record" })
        #expect(result.auditError == nil)
    }

    @Test("reader failure during re-audit yields empty post-audit findings and populates auditError")
    func readerFailureDuringReauditYieldsError() async {
        let reader = MockCloudflareReader()
        reader.shouldFail = true
        let reconciler = DomainConfigReconciler(reader: reader, writer: MockCloudflareWriter())
        let result = await reconciler.execute(
            plan: DomainConfigReconcilePlan(items: [.hardenEdge(.enableDNSSEC)]),
            zoneID: "z", domain: "example.com", apiToken: "t", declared: DomainConfig())

        #expect(result.appliedCount == 1)
        #expect(result.postAuditFindings.isEmpty)
        #expect(result.auditError != nil)
    }
}
