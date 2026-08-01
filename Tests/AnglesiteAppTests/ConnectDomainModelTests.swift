import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

private actor FakeRDAPLookupService: RDAPLookupService {
    private let result: RDAPDomainInfo?
    init(result: RDAPDomainInfo?) { self.result = result }
    func lookup(hostname: String) async -> RDAPDomainInfo? { result }
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
}
