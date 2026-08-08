import Foundation
import Testing
import AnglesiteCore
@testable import AnglesiteAppCore

private final class StubReader: CloudflareReading, @unchecked Sendable {
    private let zoneID: String?
    private let state: CloudflareZoneState

    init(zoneID: String? = "z1", state: CloudflareZoneState = StubReader.cleanState) {
        self.zoneID = zoneID
        self.state = state
    }

    static let cleanState = CloudflareZoneState(
        dnssecActive: true, sslMode: "strict", alwaysUseHTTPS: true,
        hsts: nil, caaRecords: [], mxRecords: [], spfRecords: [], dmarcRecords: [])

    func resolveZoneID(domain: String, apiToken: String) async throws -> String? { zoneID }
    func zoneState(zoneID: String, domain: String, apiToken: String) async throws -> CloudflareZoneState { state }
    func listDNSRecords(zoneID: String, apiToken: String) async throws -> [DNSRecord] { [] }
    func workerScriptNames(apiToken: String) async throws -> [String] { [] }
}

private final class StubWriter: CloudflareWriting, @unchecked Sendable {
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
    func enableOnionRouting(zoneID: String, enabled: Bool, apiToken: String) async throws {}
    func attachWorkersCustomDomain(hostname: String, workerScriptName: String, apiToken: String) async throws -> CustomDomainAttachResult {
        .attached
    }
    func setMarkdownForAgents(hostname: String, enabled: Bool, apiToken: String) async throws -> Bool { true }
}

@Suite(.serialized)
struct HardenModelTests {
    /// A per-case scratch service, matching `DomainConfigAuditModelTests`' rationale: every test
    /// here claims `CLOUDFLARE_API_TOKEN` via `CloudflareAPITokenTestEnvironment`, so a fallback
    /// to the real keychain should never happen, but a scratch service keeps
    /// `CloudflareAPICredentials.resolve()`'s legacy-token read from touching the developer's
    /// actual login keychain if it ever does.
    private let keychain = KeychainStore(service: "io.dwk.anglesite.tests.hardenModel." + UUID().uuidString)

    /// Regression coverage for the #1289 review fix: `resolveAndPlan()`/`apply()` now flip `phase`
    /// out of `.idle`/`.preview` synchronously, before the `Task` (and its `await apiToken()` hop)
    /// starts — pins that `isRunning` is observably true immediately, matching
    /// `DomainConfigAuditModel`'s equivalent contract.
    @MainActor
    @Test("resolveAndPlan() flips isRunning synchronously, before the token resolves")
    func resolveAndPlanFlipsRunningSynchronously() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        defer { cfToken.release() }
        let model = HardenModel(reader: StubReader(), writer: StubWriter(), keychain: keychain)
        model.domainInput = "example.com"

        model.resolveAndPlan()
        #expect(model.isRunning)
        while model.isRunning { await Task.yield() }

        guard case .preview(let plan, let domain, let zoneID) = model.phase else {
            Issue.record("expected .preview, got \(model.phase)")
            return
        }
        #expect(domain == "example.com")
        #expect(zoneID == "z1")
        #expect(!plan.isEmpty)
    }

    /// Regression coverage for the #1289 review fix: previously `apply()`'s only guard was
    /// `case .preview = phase`, with no `isRunning` check, and `phase` didn't flip to `.applying`
    /// until after `await apiToken()` resolved. A second `apply()` call landing while the first
    /// was still resolving its token passed the same guard, cancelled `inFlight`, and silently
    /// restarted. Now that `phase` flips to `.applying` synchronously inside `apply()` itself
    /// (before the `Task` starts), a second call arriving after the first must see phase already
    /// out of `.preview` and no-op.
    @MainActor
    @Test("a second apply() call after the first has started is a no-op, not a silent restart")
    func secondApplyCallIsANoOp() async throws {
        let cfToken = await CloudflareAPITokenTestEnvironment.shared.claimSet()
        defer { cfToken.release() }
        let model = HardenModel(reader: StubReader(), writer: StubWriter(), keychain: keychain)
        model.domainInput = "example.com"
        model.resolveAndPlan()
        while model.isRunning { await Task.yield() }
        guard case .preview(let plan, _, _) = model.phase, !plan.isEmpty else {
            Issue.record("expected a non-empty .preview phase before exercising apply(), got \(model.phase)")
            return
        }

        model.apply()
        #expect(model.isRunning)
        // This second call must observe phase already flipped to `.applying` (not `.preview`), so
        // its own `guard case .preview = phase` rejects it — no second `inFlight` Task, no restart.
        model.apply()
        while model.isRunning { await Task.yield() }

        guard case .succeeded(let result) = model.phase else {
            Issue.record("expected .succeeded, got \(model.phase)")
            return
        }
        #expect(result.appliedCount == plan.items.count)
    }
}
