import Foundation
import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

private final class StubReader: CloudflareReading, @unchecked Sendable {
    private let zoneID: String?
    private let state: CloudflareZoneState
    private(set) var resolvedDomain: String?

    init(zoneID: String? = "z1", state: CloudflareZoneState = StubReader.defaultState) {
        self.zoneID = zoneID
        self.state = state
    }

    static let defaultState = CloudflareZoneState(
        dnssecActive: false, sslMode: "flexible", alwaysUseHTTPS: false, hsts: nil,
        caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [])

    func resolveZoneID(domain: String, apiToken: String) async throws -> String? {
        resolvedDomain = domain
        return zoneID
    }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState {
        state
    }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] { [] }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

private final class StubWriter: CloudflareWriting, @unchecked Sendable {
    private(set) var lastZoneID: String?
    private(set) var lastEnabled: Bool?
    var errorToThrow: CloudflareError?

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {}
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {}
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {}
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {
        if let errorToThrow { throw errorToThrow }
        lastZoneID = zoneID
        lastEnabled = enabled
    }
    func attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult {
        return .attached
    }
}

/// A `final class` (not a `struct`) so `deinit` can release its claim on `CLOUDFLARE_API_TOKEN` via
/// `CloudflareAPITokenTestEnvironment` — without it, the env var set below leaks into every later
/// test in the process (see #1282).
@Suite(.serialized)
final class OnionRoutingModelTests {
    init() {
        // `apiToken()` checks this env var before falling back to the real Keychain — acquire it so
        // these tests are deterministic regardless of what's provisioned on the host.
        CloudflareAPITokenTestEnvironment.shared.acquire()
    }

    deinit {
        CloudflareAPITokenTestEnvironment.shared.release()
    }

    @MainActor
    @Test("load() ignores blank domain input")
    func loadIgnoresBlankDomain() async throws {
        let reader = StubReader()
        let model = OnionRoutingModel(reader: reader, writer: StubWriter())
        model.domainInput = "   "
        model.load()
        #expect(model.phase == .idle)
        #expect(reader.resolvedDomain == nil)
    }

    @MainActor
    @Test("load() trims/lowercases the domain and reports the current zone state")
    func loadSucceeds() async throws {
        let state = CloudflareZoneState(
            dnssecActive: false, sslMode: "flexible", alwaysUseHTTPS: false, hsts: nil,
            caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [], onionRouting: true)
        let reader = StubReader(zoneID: "z1", state: state)
        let model = OnionRoutingModel(reader: reader, writer: StubWriter())

        model.domainInput = "  Example.com "
        model.load()
        while model.isRunning { await Task.yield() }

        #expect(reader.resolvedDomain == "example.com")
        #expect(model.phase == .configured(domain: "example.com", enabled: true))
    }

    @MainActor
    @Test("load() surfaces a clear error when the zone isn't found")
    func loadZoneNotFound() async throws {
        let reader = StubReader(zoneID: nil)
        let model = OnionRoutingModel(reader: reader, writer: StubWriter())

        model.domainInput = "missing.com"
        model.load()
        while model.isRunning { await Task.yield() }

        guard case .error(let message) = model.phase else {
            Issue.record("expected .error phase, got \(model.phase)")
            return
        }
        #expect(message.contains("missing.com"))
    }

    @MainActor
    @Test("toggle() flips the loaded setting and writes through the zone that was resolved")
    func toggleFlipsAndWrites() async throws {
        let state = CloudflareZoneState(
            dnssecActive: false, sslMode: "flexible", alwaysUseHTTPS: false, hsts: nil,
            caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [], onionRouting: false)
        let reader = StubReader(zoneID: "z1", state: state)
        let writer = StubWriter()
        let model = OnionRoutingModel(reader: reader, writer: writer)

        model.domainInput = "example.com"
        model.load()
        while model.isRunning { await Task.yield() }

        model.toggle()
        while model.isRunning { await Task.yield() }

        #expect(writer.lastZoneID == "z1")
        #expect(writer.lastEnabled == true)
        #expect(model.phase == .configured(domain: "example.com", enabled: true))
    }

    @MainActor
    @Test("toggle() is a no-op before a zone has been loaded")
    func toggleNoopWhenIdle() async throws {
        let writer = StubWriter()
        let model = OnionRoutingModel(reader: StubReader(), writer: writer)

        model.toggle()
        while model.isRunning { await Task.yield() }

        #expect(writer.lastEnabled == nil)
        #expect(model.phase == .idle)
    }

    @MainActor
    @Test("openSheet() resets phase and clears any previously entered domain")
    func openSheetResets() {
        let model = OnionRoutingModel(reader: StubReader(), writer: StubWriter())
        model.domainInput = "leftover.com"

        model.openSheet()

        #expect(model.sheetPresented == true)
        #expect(model.domainInput == "")
        #expect(model.phase == .idle)
    }

    @MainActor
    @Test("dismissSheet() clears the presented flag")
    func dismissSheetClearsPresented() {
        let model = OnionRoutingModel(reader: StubReader(), writer: StubWriter())
        model.openSheet()

        model.dismissSheet()

        #expect(model.sheetPresented == false)
    }
}
