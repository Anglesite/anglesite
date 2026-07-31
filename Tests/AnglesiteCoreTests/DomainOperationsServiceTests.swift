import Foundation
import Testing
@testable import AnglesiteCore

// `Result` is only `Equatable` when `Success: Equatable`, and `Void` doesn't conform.
// Provide a narrow `==` overload so `result == .success(())` reads naturally below.
private func == (lhs: Result<Void, DomainOperationError>, rhs: Result<Void, DomainOperationError>) -> Bool {
    switch (lhs, rhs) {
    case (.success, .success): return true
    case (.failure(let a), .failure(let b)): return a == b
    default: return false
    }
}

struct DomainOperationsServiceTests {
    private func service(
        reader: FakeReader = FakeReader(),
        writer: FakeWriter = FakeWriter(),
        token: String? = "tok"
    ) -> DomainOperations {
        DomainOperations(reader: reader, writer: writer, tokenProvider: { token })
    }

    @Test("listRecords resolves the zone then lists its records")
    func listSucceeds() async {
        let reader = FakeReader(zoneID: "z1", records: [
            DNSRecord(id: "r1", type: "MX", name: "example.com", content: "mail.example.com", ttl: 1, proxied: false),
        ])
        let result = await service(reader: reader).listRecords(domain: "example.com")
        guard case .success(let records) = result else { Issue.record("expected success"); return }
        #expect(records.count == 1)
        #expect(reader.resolvedDomain == "example.com")
        #expect(reader.listedZoneID == "z1")
    }

    @Test("listRecords fails with .noToken when no token is available")
    func listNoToken() async {
        let result = await service(token: nil).listRecords(domain: "example.com")
        #expect(result == .failure(.noToken))
    }

    @Test("listRecords fails with .zoneNotFound when the zone can't be resolved")
    func listZoneNotFound() async {
        let reader = FakeReader(zoneID: nil)
        let result = await service(reader: reader).listRecords(domain: "absent.com")
        #expect(result == .failure(.zoneNotFound(domain: "absent.com")))
    }

    @Test("listRecords surfaces a CloudflareError as .cloudflare")
    func listCloudflareError() async {
        let reader = FakeReader(zoneID: "z1", listError: .unauthorized)
        let result = await service(reader: reader).listRecords(domain: "example.com")
        #expect(result == .failure(.cloudflare(.unauthorized)))
    }

    @Test("addRecord resolves the zone then posts the record")
    func addSucceeds() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer)
            .addRecord(domain: "example.com", type: "TXT", name: "_atproto", content: "did=abc", ttl: 1, priority: nil)
        #expect(result == .success(()))
        #expect(writer.addedRecords == [DNSRecordPayload(type: "TXT", name: "_atproto", content: "did=abc", ttl: 1, priority: nil)])
    }

    @Test("addRecord threads priority through to the payload for MX records")
    func addMXWithPriority() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer)
            .addRecord(domain: "example.com", type: "MX", name: "example.com", content: "mail.example.com", ttl: 1, priority: 10)
        #expect(result == .success(()))
        #expect(writer.addedRecords == [DNSRecordPayload(type: "MX", name: "example.com", content: "mail.example.com", ttl: 1, priority: 10)])
    }

    @Test("addRecord fails with .noToken when no token is available")
    func addNoToken() async {
        let result = await service(token: nil).addRecord(domain: "example.com", type: "TXT", name: "n", content: "c", ttl: 1, priority: nil)
        #expect(result == .failure(.noToken))
    }

    @Test("addRecord surfaces a CloudflareError as .cloudflare")
    func addCloudflareError() async {
        let writer = FakeWriter(addError: .api(message: "bad request"))
        let result = await service(reader: FakeReader(zoneID: "z1"), writer: writer)
            .addRecord(domain: "example.com", type: "TXT", name: "n", content: "c", ttl: 1, priority: nil)
        #expect(result == .failure(.cloudflare(.api(message: "bad request"))))
    }

    @Test("deleteRecord resolves the zone then deletes the record")
    func deleteSucceeds() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer).deleteRecord(domain: "example.com", recordID: "r1")
        #expect(result == .success(()))
        #expect(writer.deletedRecordIDs == ["r1"])
    }

    @Test("deleteRecord fails with .zoneNotFound when the zone can't be resolved")
    func deleteZoneNotFound() async {
        let result = await service(reader: FakeReader(zoneID: nil)).deleteRecord(domain: "absent.com", recordID: "r1")
        #expect(result == .failure(.zoneNotFound(domain: "absent.com")))
    }

    @Test("addRecord stamps a comment from purpose and writes dns.managedRecords")
    func addRecordWithPurposeWritesThroughAndStampsComment() async throws {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let result = await service(reader: reader, writer: writer).addRecord(
            domain: "example.com", type: "TXT", name: "_atproto", content: "did=abc", ttl: 1,
            priority: nil, purpose: "verification:bluesky", sourceDirectory: tmp)

        #expect(result == .success(()))
        #expect(writer.addedRecords == [
            DNSRecordPayload(type: "TXT", name: "_atproto", content: "did=abc", ttl: 1, priority: nil,
                             comment: "anglesite:verification:bluesky"),
        ])
        let config = try DomainConfigStore(sourceDirectory: tmp).load()
        #expect(config.dns?.managedRecords == [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ])
    }

    @Test("addRecord with no sourceDirectory does not write a file")
    func addRecordWithoutSourceDirectorySkipsWriteThrough() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer).addRecord(
            domain: "example.com", type: "TXT", name: "n", content: "c", ttl: 1, priority: nil,
            purpose: nil, sourceDirectory: nil)
        #expect(result == .success(()))
        #expect(writer.addedRecords == [DNSRecordPayload(type: "TXT", name: "n", content: "c", ttl: 1, priority: nil, comment: nil)])
    }

    @Test("addRecord short overload (no purpose/sourceDirectory) still succeeds")
    func addRecordShortOverloadStillWorks() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer)
            .addRecord(domain: "example.com", type: "TXT", name: "n", content: "c", ttl: 1, priority: nil)
        #expect(result == .success(()))
        #expect(writer.addedRecords == [DNSRecordPayload(type: "TXT", name: "n", content: "c", ttl: 1, priority: nil, comment: nil)])
    }

    @Test("deleteRecord with type/name/content removes the matching managedRecords entry")
    func deleteRecordWritesThroughRemoval() async throws {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let store = DomainConfigStore(sourceDirectory: tmp)
        try store.save(DomainConfig(dns: .init(managedRecords: [
            .init(type: "TXT", name: "_atproto", content: "did=abc", purpose: "verification:bluesky"),
        ])))

        let result = await service(reader: reader, writer: writer).deleteRecord(
            domain: "example.com", recordID: "r1", type: "TXT", name: "_atproto", content: "did=abc",
            sourceDirectory: tmp)

        #expect(result == .success(()))
        let config = try store.load()
        #expect(config.dns?.managedRecords?.isEmpty == true)
    }

    @Test("deleteRecord short overload (no write-through args) still succeeds")
    func deleteRecordShortOverloadStillWorks() async {
        let reader = FakeReader(zoneID: "z1")
        let writer = FakeWriter()
        let result = await service(reader: reader, writer: writer).deleteRecord(domain: "example.com", recordID: "r1")
        #expect(result == .success(()))
        #expect(writer.deletedRecordIDs == ["r1"])
    }
}

// MARK: - Fakes

final class FakeReader: CloudflareReading, @unchecked Sendable {
    private let zoneID: String?
    private let records: [DNSRecord]
    private let listError: CloudflareError?
    private(set) var resolvedDomain: String?
    private(set) var listedZoneID: String?

    init(zoneID: String? = "z1", records: [DNSRecord] = [], listError: CloudflareError? = nil) {
        self.zoneID = zoneID
        self.records = records
        self.listError = listError
    }

    func resolveZoneID(domain: String, apiToken: String) async throws -> String? {
        resolvedDomain = domain
        return zoneID
    }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState {
        fatalError("not used by DomainOperations")
    }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] {
        listedZoneID = zoneID
        if let listError { throw listError }
        return records
    }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

final class FakeWriter: CloudflareWriting, @unchecked Sendable {
    private let addError: CloudflareError?
    private(set) var addedRecords: [DNSRecordPayload] = []
    private(set) var deletedRecordIDs: [String] = []

    init(addError: CloudflareError? = nil) {
        self.addError = addError
    }

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {
        if let addError { throw addError }
        addedRecords.append(record)
    }
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {
        deletedRecordIDs.append(recordID)
    }
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {}
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult {
        return .attached
    }
}
