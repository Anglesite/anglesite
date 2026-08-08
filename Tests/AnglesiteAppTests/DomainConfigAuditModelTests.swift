import Foundation
import Testing
import AnglesiteCore
import AnglesiteTestSupport
@testable import AnglesiteAppCore

private final class StubReader: CloudflareReading, @unchecked Sendable {
    private let zoneID: String?
    private let state: CloudflareZoneState
    private let records: [DNSRecord]
    private(set) var resolvedDomain: String?
    private(set) var listedZoneID: String?

    init(zoneID: String? = "z1", state: CloudflareZoneState = StubReader.cleanState, records: [DNSRecord] = []) {
        self.zoneID = zoneID
        self.state = state
        self.records = records
    }

    static let cleanState = CloudflareZoneState(
        dnssecActive: true, sslMode: "strict", alwaysUseHTTPS: true,
        hsts: nil, caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [])

    func resolveZoneID(domain: String, apiToken: String) async throws -> String? {
        resolvedDomain = domain
        return zoneID
    }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState { state }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] {
        listedZoneID = zoneID
        return records
    }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

private final class StubWriter: CloudflareWriting, @unchecked Sendable {
    private(set) var addedRecords: [DNSRecordPayload] = []

    func enableDNSSEC(zoneID: String, apiToken: String) async throws {}
    func setAlwaysUseHTTPS(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setHSTS(zoneID: String, maxAge: Int, includeSubdomains: Bool, preload: Bool, apiToken: String) async throws {}
    func addDNSRecord(zoneID: String, record: DNSRecordPayload, apiToken: String) async throws {
        addedRecords.append(record)
    }
    func deleteDNSRecord(zoneID: String, recordID: String, apiToken: String) async throws {}
    func setBotFightMode(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func createWAFCustomRule(zoneID: String, rule: WAFRulePayload, apiToken: String) async throws {}
    func setSpeedBrain(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func setECH(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableZstandardCompression(zoneID: String, apiToken: String) async throws {}
    func setPageShield(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult {
        .attached
    }
    func setMarkdownForAgents(hostname: String, enabled: Bool, apiToken: String) async throws -> Bool { true }
}

/// `.timeLimit`: see #1349 — the full `AnglesiteAppTests` target has hung indefinitely under
/// local machine contention (many concurrent `swift test` runs oversubscribing the cooperative
/// thread pool), with this suite one of the observed stall points. A wedged test now fails as an
/// unambiguous time-limit violation instead of hanging the whole run forever.
@Suite(.serialized, .timeLimit(.minutes(1)))
struct DomainConfigAuditModelTests {
    /// A per-case scratch service (see `KeychainStore`'s own doc comment) so these tests never
    /// touch the developer's real login keychain — every test that claims `CLOUDFLARE_API_TOKEN`
    /// via `CloudflareAPITokenTestEnvironment` should never fall through to the keychain at all,
    /// but a scratch service keeps the model's `try? keychain.readCloudflareToken()` call from
    /// racing a concurrent keychain read/prompt in another worktree if it ever does.
    private let keychain = KeychainStore(service: "io.dwk.anglesite.tests.domainConfigAudit." + UUID().uuidString)

    private func tempSite(declaring config: DomainConfig? = nil) throws -> (CurrentSite, () -> Void) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        if let config {
            try DomainConfigStore(sourceDirectory: tmp).save(config)
        }
        let site = CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp)
        return (site, { try? FileManager.default.removeItem(at: tmp) })
    }

    @MainActor
    @Test("runAudit() surfaces a clear error when no domain is declared")
    func runAuditNoDomainDeclared() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        defer { cfToken.release() }
        let (site, cleanup) = try tempSite()
        defer { cleanup() }
        let model = DomainConfigAuditModel(reader: StubReader(), writer: StubWriter(), keychain: keychain)
        model.configure(site: site)

        model.runAudit()
        while model.isRunning { await Task.yield() }

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("domain"))
    }

    @MainActor
    @Test("runAudit() surfaces a clear error when the zone isn't found")
    func runAuditZoneNotFound() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        defer { cfToken.release() }
        let declared = DomainConfig(domain: .init(hostname: "example.com"))
        let (site, cleanup) = try tempSite(declaring: declared)
        defer { cleanup() }
        let model = DomainConfigAuditModel(reader: StubReader(zoneID: nil), writer: StubWriter(), keychain: keychain)
        model.configure(site: site)

        model.runAudit()
        while model.isRunning { await Task.yield() }

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("example.com"))
    }

    /// Regression coverage for the #1211 restructuring: the token check moved from a synchronous
    /// pre-`Task` guard into the async task body, since resolving via `CloudflareAPICredentials`
    /// needs an `await` hop. `phase` must still flip to `.auditing` synchronously (so `isRunning`
    /// is observably true) before the in-task token check can land on `.failed` — this pins both
    /// halves of that contract, not just the eventual outcome.
    @MainActor
    @Test("runAudit() surfaces the no-token failure after isRunning has already flipped true")
    func runAuditNoTokenAvailable() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }
        let declared = DomainConfig(domain: .init(hostname: "example.com"))
        let (site, cleanup) = try tempSite(declaring: declared)
        defer { cleanup() }
        let model = DomainConfigAuditModel(reader: StubReader(), writer: StubWriter(), keychain: InMemorySecretStore())
        model.configure(site: site)

        model.runAudit()
        #expect(model.isRunning)
        while model.isRunning { await Task.yield() }

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("token"))
    }

    /// Same regression coverage as ``runAuditNoTokenAvailable()``, for `reconcile()`'s identical
    /// restructuring.
    @MainActor
    @Test("reconcile() surfaces the no-token failure after isRunning has already flipped true")
    func reconcileNoTokenAvailable() async throws {
        let record = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let declared = DomainConfig(domain: .init(hostname: "example.com"), dns: .init(managedRecords: [record]))
        let (site, cleanup) = try tempSite(declaring: declared)
        defer { cleanup() }
        // Token available for the audit step, so phase reaches `.results` with a non-empty plan —
        // reconcile()'s own guard requires that starting phase. Claimed explicitly via the shared
        // coordinator (#1211 review) rather than relying on ambient/leaked env state.
        let model = DomainConfigAuditModel(reader: StubReader(zoneID: "z1"), writer: StubWriter(), keychain: InMemorySecretStore())
        model.configure(site: site)
        let auditToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        model.runAudit()
        while model.isRunning { await Task.yield() }
        auditToken.release()
        guard case .results = model.phase else {
            Issue.record("expected .results before exercising reconcile()'s no-token path, got \(model.phase)")
            return
        }

        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimClear()
        defer { cfToken.release() }

        model.reconcile()
        #expect(model.isRunning)
        while model.isRunning { await Task.yield() }

        guard case .failed(let reason) = model.phase else {
            Issue.record("expected .failed, got \(model.phase)")
            return
        }
        #expect(reason.contains("token"))
    }

    @MainActor
    @Test("runAudit() computes findings against the declared config and resolved zone")
    func runAuditComputesFindings() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        defer { cfToken.release() }
        let record = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let declared = DomainConfig(domain: .init(hostname: "example.com"), dns: .init(managedRecords: [record]))
        let (site, cleanup) = try tempSite(declaring: declared)
        defer { cleanup() }
        let reader = StubReader(zoneID: "z1", state: StubReader.cleanState, records: [])
        let model = DomainConfigAuditModel(reader: reader, writer: StubWriter(), keychain: keychain)
        model.configure(site: site)

        model.runAudit()
        while model.isRunning { await Task.yield() }

        guard case .results(let findings, let plan, let domain, let zoneID) = model.phase else {
            Issue.record("expected .results, got \(model.phase)")
            return
        }
        #expect(reader.resolvedDomain == "example.com")
        #expect(domain == "example.com")
        #expect(zoneID == "z1")
        #expect(findings.count == 1)
        #expect(plan.items == [.createManagedRecord(record)])
    }

    @MainActor
    @Test("reconcile() delegates to DomainConfigReconciler and reports the applied plan")
    func reconcileAppliesPlan() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        defer { cfToken.release() }
        let record = DomainConfig.DNSRecord(
            type: "TXT", name: "_atproto", content: "did=did:plc:abc", purpose: "verification:bluesky")
        let declared = DomainConfig(domain: .init(hostname: "example.com"), dns: .init(managedRecords: [record]))
        let (site, cleanup) = try tempSite(declaring: declared)
        defer { cleanup() }
        let writer = StubWriter()
        let model = DomainConfigAuditModel(reader: StubReader(zoneID: "z1"), writer: writer, keychain: keychain)
        model.configure(site: site)

        model.runAudit()
        while model.isRunning { await Task.yield() }

        model.reconcile()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let result) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)")
            return
        }
        #expect(result.appliedCount == 1)
        #expect(writer.addedRecords.first?.content == "did=did:plc:abc")
    }

    @MainActor
    @Test("openSheet() resets phase")
    func openSheetResets() {
        // No CloudflareAPITokenTestEnvironment claim needed: openSheet() never calls apiToken().
        let model = DomainConfigAuditModel(reader: StubReader(), writer: StubWriter(), keychain: keychain)
        model.openSheet()
        #expect(model.sheetPresented == true)
        #expect(model.phase == .idle)
    }

    @MainActor
    @Test("dismissSheet() clears the presented flag")
    func dismissSheetClearsPresented() {
        // No CloudflareAPITokenTestEnvironment claim needed: neither method calls apiToken().
        let model = DomainConfigAuditModel(reader: StubReader(), writer: StubWriter(), keychain: keychain)
        model.openSheet()
        model.dismissSheet()
        #expect(model.sheetPresented == false)
    }
}
