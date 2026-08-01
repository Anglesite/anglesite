import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

private actor FakeRDAPLookupService: RDAPLookupService {
    private let result: RDAPDomainInfo?
    init(result: RDAPDomainInfo?) { self.result = result }
    func lookup(hostname: String) async -> RDAPDomainInfo? { result }
}

/// A `RDAPLookupService` whose calls suspend until the test explicitly resolves them, in whatever
/// order the test chooses — used to exercise overlapping/superseded lookups (race-condition
/// coverage for #1194 review round 2) where resolution order doesn't match call order.
private actor ControllableRDAPLookupService: RDAPLookupService {
    private var continuations: [CheckedContinuation<RDAPDomainInfo?, Never>] = []

    func lookup(hostname: String) async -> RDAPDomainInfo? {
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    /// Number of `lookup` calls received so far (in call order), for tests to poll against.
    func callCount() -> Int { continuations.count }

    /// Resolves the `index`-th call (0-based, in call order) with `result`.
    func resolve(callIndex index: Int, with result: RDAPDomainInfo?) {
        continuations[index].resume(returning: result)
    }
}

@MainActor
@Suite struct ConnectDomainModelTests {
    private func makeSite() throws -> (site: CurrentSite, dir: URL) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return (CurrentSite(id: "s1", packageURL: tmp, sourceDirectory: tmp), tmp)
    }

    @Test func openSheetResetsToChoosingPhase() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)

        model.hostnameInput = "stale.example.com"
        model.openSheet()

        #expect(model.phase == .choosing)
        #expect(model.hostnameInput.isEmpty)
        #expect(model.sheetPresented)
    }

    @Test func notNowDismissesWithoutWritingSiteConfig() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.notNow()

        #expect(!model.sheetPresented)
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent(".site-config").path))
    }

    @Test func chooseBuyRecordsIntentAndDismisses() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.chooseBuy()

        #expect(!model.sheetPresented)
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=buy"))
    }

    @Test func beginTransferThenSubmitRecordsHostnameAndTransitionsToConnected() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()

        model.beginTransfer()
        #expect(model.phase == .enteringHostname)

        model.hostnameInput = "  Example.com  "
        model.submitTransfer()

        #expect(model.phase == .connected(hostname: "example.com"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=transfer"))
        #expect(config.contains("DOMAIN=example.com"))
    }

    @Test func submitTransferWithEmptyHostnameIsANoOp() throws {
        let model = ConnectDomainModel()
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.beginTransfer()

        model.hostnameInput = "   "
        model.submitTransfer()

        #expect(model.phase == .enteringHostname)
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent(".site-config").path))
    }

    @Test func openSheetJumpsToConnectedWhenTransferAlreadyDeclared() throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(
            DomainConfig(domain: .init(hostname: "example.com", choice: "transfer", attach: true)))

        model.openSheet()

        #expect(model.phase == .connected(hostname: "example.com"))
        #expect(model.sheetPresented)
    }

    @Test func openSheetStaysAtChoosingWhenChoiceIsBuy() throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(
            DomainConfig(domain: .init(hostname: "", choice: "buy", attach: false)))

        model.openSheet()

        #expect(model.phase == .choosing)
    }

    @Test func openSheetSeedsRegistrarInfoFromCachedAnglesiteJSON() throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(
            hostname: "example.com", choice: "transfer", attach: true,
            registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))

        model.openSheet()

        #expect(model.registrarInfo == .available(
            RDAPDomainInfo(registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))
    }

    @Test func submitTransferPersistsFreshRegistrarLookup() async throws {
        let fake = FakeRDAPLookupService(result: RDAPDomainInfo(registrar: "Namecheap", expiresAt: "2028-01-01T00:00:00Z"))
        let model = ConnectDomainModel(rdap: fake)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        model.openSheet()
        model.beginTransfer()
        model.hostnameInput = "example.com"
        model.submitTransfer()

        repeat { await Task.yield() } while model.isLookingUpRegistrarInfo

        #expect(model.registrarInfo == .available(RDAPDomainInfo(registrar: "Namecheap", expiresAt: "2028-01-01T00:00:00Z")))
        let saved = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(saved.domain?.registrar == "Namecheap")
        #expect(saved.domain?.expiresAt == "2028-01-01T00:00:00Z")
    }

    @Test func failedLookupDoesNotClobberCachedRegistrarInfo() async throws {
        let model = ConnectDomainModel(rdap: FakeRDAPLookupService(result: nil))
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(
            hostname: "example.com", choice: "transfer", attach: true,
            registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))

        model.openSheet()
        repeat { await Task.yield() } while model.isLookingUpRegistrarInfo

        #expect(model.registrarInfo == .available(
            RDAPDomainInfo(registrar: "Example Registrar, LLC", expiresAt: "2027-08-13T04:00:00Z")))
    }

    /// Reopening the sheet before the first RDAP lookup resolves spawns a second, overlapping
    /// lookup for the same hostname (review round 2 finding on #1194). The stale first lookup must
    /// not win the race for `registrarInfo`/the persisted `anglesite.json` write, and it must not
    /// clobber `isLookingUpRegistrarInfo` after the newer lookup already cleared it.
    @Test func reopeningBeforeFirstLookupResolvesKeepsNewerResult() async throws {
        let fake = ControllableRDAPLookupService()
        let model = ConnectDomainModel(rdap: fake)
        let (site, dir) = try makeSite()
        defer { try? FileManager.default.removeItem(at: dir) }
        model.configure(site: site)

        // First lookup: opened via the hostname-entry flow, kicks off call #0.
        model.openSheet()
        model.beginTransfer()
        model.hostnameInput = "example.com"
        model.submitTransfer()
        while await fake.callCount() < 1 { await Task.yield() }

        // Dismiss and reopen before call #0 resolves — the still-declared "transfer" hostname
        // takes the sheet straight back to `.connected` and kicks off a second, overlapping
        // lookup (call #1) for the same hostname.
        model.dismissSheet()
        model.openSheet()
        #expect(model.phase == .connected(hostname: "example.com"))
        while await fake.callCount() < 2 { await Task.yield() }

        // Resolve the newer call first, then the stale one — the stale completion must be a
        // complete no-op once superseded.
        let newer = RDAPDomainInfo(registrar: "Newer Registrar", expiresAt: "2029-01-01T00:00:00Z")
        let stale = RDAPDomainInfo(registrar: "Stale Registrar", expiresAt: "2020-01-01T00:00:00Z")
        await fake.resolve(callIndex: 1, with: newer)
        repeat { await Task.yield() } while model.isLookingUpRegistrarInfo
        await fake.resolve(callIndex: 0, with: stale)
        for _ in 0..<10 { await Task.yield() }

        #expect(model.registrarInfo == .available(newer))
        #expect(!model.isLookingUpRegistrarInfo)
        let saved = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(saved.domain?.registrar == "Newer Registrar")
        #expect(saved.domain?.expiresAt == "2029-01-01T00:00:00Z")
    }
}
