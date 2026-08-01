import Testing
import Foundation
@testable import AnglesiteAppCore
@testable import AnglesiteCore

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
}
