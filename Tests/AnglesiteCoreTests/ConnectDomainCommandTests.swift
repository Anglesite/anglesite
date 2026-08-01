import Testing
import Foundation
@testable import AnglesiteCore

struct ConnectDomainCommandTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeSiteDir() throws -> URL {
        let dir = tmpDir.appendingPathComponent("connect-domain-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("recordBuy writes DOMAIN_CHOICE=buy to .site-config and a buy intent to anglesite.json")
    func recordBuyWritesBothFiles() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        ConnectDomainCommand.recordBuy(siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=buy"))
        #expect(!config.contains("DOMAIN="))

        let domainConfig = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(domainConfig.domain == DomainConfig.Domain(hostname: nil, choice: "buy", attach: false))
    }

    @Test("recordTransfer writes DOMAIN_CHOICE/DOMAIN to .site-config and a transfer intent to anglesite.json")
    func recordTransferWritesBothFiles() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        ConnectDomainCommand.recordTransfer(hostname: "example.com", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN_CHOICE=transfer"))
        #expect(config.contains("DOMAIN=example.com"))

        let domainConfig = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(domainConfig.domain == DomainConfig.Domain(hostname: "example.com", choice: "transfer", attach: true))
    }

    @Test("recordTransfer overwrites a previous hostname rather than duplicating the DOMAIN line")
    func recordTransferOverwritesPreviousHostname() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        ConnectDomainCommand.recordTransfer(hostname: "old.example.com", siteDirectory: dir)
        ConnectDomainCommand.recordTransfer(hostname: "new.example.com", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("DOMAIN=new.example.com"))
        #expect(!config.contains("DOMAIN=old.example.com"))
        let domainLines = config.split(separator: "\n").filter { $0.hasPrefix("DOMAIN=") }
        #expect(domainLines.count == 1)
    }

    @Test("recordBuy preserves unrelated existing .site-config lines")
    func recordBuyPreservesUnrelatedLines() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try "SITE_NAME=My Site\n".write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        ConnectDomainCommand.recordBuy(siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SITE_NAME=My Site"))
        #expect(config.contains("DOMAIN_CHOICE=buy"))
    }
}
