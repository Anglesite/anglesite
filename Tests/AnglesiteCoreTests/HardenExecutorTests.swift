import Testing
import Foundation
@testable import AnglesiteCore

struct HardenExecutorTests {
    private func makeExecutor(
        reader: MockCloudflareReader = MockCloudflareReader(),
        writer: MockCloudflareWriter = MockCloudflareWriter()
    ) -> (HardenExecutor, MockCloudflareWriter, MockCloudflareReader) {
        let exec = HardenExecutor(reader: reader, writer: writer)
        return (exec, writer, reader)
    }

    @Test("an empty plan produces zero applied, no failures, and re-audits")
    func emptyPlanNoOps() async {
        let (exec, writer, _) = makeExecutor()
        let result = await exec.execute(
            plan: HardenPlan(items: []),
            zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(result.appliedCount == 0)
        #expect(result.failedItems.isEmpty)
        #expect(writer.calls.isEmpty)
    }

    @Test("each item type calls the correct writer method")
    func itemsDispatchCorrectly() async {
        let writer = MockCloudflareWriter()
        let exec = HardenExecutor(reader: MockCloudflareReader(), writer: writer)
        let plan = HardenPlan(items: [
            .enableDNSSEC,
            .addCAARecord(ca: "letsencrypt.org"),
            .enableAlwaysUseHTTPS,
            .enableHSTS(maxAge: 31_536_000, includeSubdomains: true, preload: false),
            .enableBotFightMode,
            .addNullMX,
            .addSPFRejectAll,
            .addDMARCReject,
            .addWAFRule(description: "Block dotfiles", expression: "(x)", action: "block"),
            .enableSpeedBrain,
            .enableZstandardCompression,
            .enableECH,
            .enablePageShieldMonitoring,
        ])
        let result = await exec.execute(
            plan: plan, zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(result.appliedCount == 13)
        #expect(result.failedItems.isEmpty)
        #expect(writer.calls.contains("enableDNSSEC"))
        #expect(writer.calls.contains { $0.hasPrefix("addDNSRecord:CAA") })
        #expect(writer.calls.contains("setAlwaysUseHTTPS"))
        #expect(writer.calls.contains("setHSTS"))
        #expect(writer.calls.contains("setBotFightMode"))
        #expect(writer.calls.contains("addDNSRecord:MX:."))
        #expect(writer.calls.contains("addDNSRecord:TXT:v=spf1 -all"))
        #expect(writer.calls.contains("addDNSRecord:TXT:v=DMARC1; p=reject"))
        #expect(writer.calls.contains("createWAFCustomRule"))
        #expect(writer.calls.contains("setSpeedBrain"))
        #expect(writer.calls.contains("enableZstandardCompression"))
        #expect(writer.calls.contains("setECH"))
        #expect(writer.calls.contains("setPageShield"))
    }

    @Test("a per-item failure does not abort remaining items")
    func perItemFailureResilience() async {
        let writer = MockCloudflareWriter()
        writer.failOn = "enableDNSSEC"
        let exec = HardenExecutor(reader: MockCloudflareReader(), writer: writer)
        let plan = HardenPlan(items: [
            .enableDNSSEC,
            .enableAlwaysUseHTTPS,
            .enableBotFightMode,
        ])
        let result = await exec.execute(
            plan: plan, zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(result.appliedCount == 2)
        #expect(result.failedItems.count == 1)
        #expect(result.failedItems[0].item == .enableDNSSEC)
    }

    @Test("post-audit findings are populated from re-read state")
    func postAuditFindings() async {
        let state = CloudflareZoneState(
            dnssecActive: false, sslMode: "flexible", alwaysUseHTTPS: false,
            hsts: nil, caaRecords: [], mxRecords: [],
            spfRecords: [], dmarcRecords: [])
        let reader = MockCloudflareReader(state: state)
        let exec = HardenExecutor(reader: reader, writer: MockCloudflareWriter())
        let result = await exec.execute(
            plan: HardenPlan(items: []),
            zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(!result.postAuditFindings.isEmpty)
        #expect(result.postAuditFindings.contains { $0.title.contains("DNSSEC") })
    }

    @Test("reader failure yields empty post-audit findings and populates auditError")
    func readerFailureYieldsEmptyFindings() async {
        let reader = MockCloudflareReader()
        reader.shouldFail = true
        let exec = HardenExecutor(reader: reader, writer: MockCloudflareWriter())
        let result = await exec.execute(
            plan: HardenPlan(items: [.enableDNSSEC]),
            zoneID: "z", domain: "example.com", apiToken: "t")
        #expect(result.appliedCount == 1)
        #expect(result.postAuditFindings.isEmpty)
        #expect(result.auditError != nil)
    }
}

// MARK: - Mocks

final class MockCloudflareReader: CloudflareReading, @unchecked Sendable {
    private let state: CloudflareZoneState
    var shouldFail = false

    init(state: CloudflareZoneState = CloudflareZoneState(
        dnssecActive: true, sslMode: "strict", alwaysUseHTTPS: true,
        hsts: .init(maxAge: 31_536_000, includeSubdomains: true, preload: false),
        caaRecords: [], mxRecords: [], spfRecords: ["v=spf1 -all"],
        dmarcRecords: ["v=DMARC1; p=reject"], botFightMode: true,
        speedBrain: true, ech: true, zstdCompression: true,
        pageShield: .init(enabled: true, scriptHosts: []))) {
        self.state = state
    }

    func resolveZoneID(domain: String, apiToken: String) async throws -> String? { "z" }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState {
        if shouldFail { throw CloudflareError.malformedResponse }
        return state
    }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] { [] }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

final class MockCloudflareWriter: CloudflareWriting, @unchecked Sendable {
    private let lock = NSLock()
    private var _calls: [String] = []
    var failOn: String?

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return _calls
    }

    private func record(_ call: String) throws {
        lock.lock()
        defer { lock.unlock() }
        if call == failOn { throw CloudflareError.api(message: "mock failure") }
        _calls.append(call)
    }

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {
        try record("enableDNSSEC")
    }
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try record("setAlwaysUseHTTPS")
    }
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool,
                 apiToken: String) async throws {
        try record("setHSTS")
    }
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {
        try self.record("addDNSRecord:\(record.type)\(record.content.isEmpty ? "" : ":\(record.content)")")
    }
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {
        try record("deleteDNSRecord:\(recordID)")
    }
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try record("setBotFightMode")
    }
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {
        try record("createWAFCustomRule")
    }
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try record("setSpeedBrain")
    }
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try record("setECH")
    }
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {
        try record("enableZstandardCompression")
    }
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try record("setPageShield")
    }
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {
        try record("enableOnionRouting")
    }
    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        try record("attachWorkersCustomDomain:\(hostname)")
        return .attached
    }
}
