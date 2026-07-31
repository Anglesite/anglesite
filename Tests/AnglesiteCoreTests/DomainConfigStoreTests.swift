import Testing
import Foundation
@testable import AnglesiteCore

@Suite("DomainConfigStore")
struct DomainConfigStoreTests {
    private func tempSourceDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DomainConfigStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("load on a missing file returns a default config, not a throw")
    func loadMissingReturnsDefault() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = DomainConfigStore(sourceDirectory: dir)
        #expect(try store.load() == DomainConfig())
    }

    @Test("save then load round-trips a fully populated config")
    func saveLoadRoundTrips() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = DomainConfigStore(sourceDirectory: dir)
        let config = DomainConfig(
            version: 1,
            domain: .init(hostname: "example.com", choice: "transfer", attach: true),
            dns: .init(managedRecords: [
                .init(type: "MX", name: "@", content: "mx01.mail.icloud.com", priority: 10, purpose: "email:icloud"),
            ]),
            edge: .init(
                dnssec: true,
                alwaysUseHTTPS: true,
                hsts: .init(maxAge: 31536000, includeSubdomains: true, preload: false),
                cloudflare: .init(botFightMode: true, wafRules: [
                    .init(description: "Block bad bots", expression: "cf.client.bot", action: "block"),
                ])
            ),
            email: .init(provider: "icloud", dmarcReportEmail: "postmaster@example.com"),
            workers: .init(active: ["webmention-receive", "micropub"])
        )
        try store.save(config)
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("anglesite.json").path))
        #expect(try store.load() == config)
    }

    @Test("load throws on malformed JSON")
    func loadThrowsOnMalformedJSON() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try "not json {".write(to: dir.appendingPathComponent("anglesite.json"), atomically: true, encoding: .utf8)
        let store = DomainConfigStore(sourceDirectory: dir)
        #expect(throws: (any Error).self) { try store.load() }
    }

    @Test("load defaults version to 1 when the file omits it")
    func loadDefaultsMissingVersion() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try #"{"domain":{"hostname":"example.com"}}"#.write(
            to: dir.appendingPathComponent("anglesite.json"), atomically: true, encoding: .utf8
        )
        let store = DomainConfigStore(sourceDirectory: dir)
        let config = try store.load()
        #expect(config.version == 1)
        #expect(config.domain?.hostname == "example.com")
    }

    @Test("save preserves an unrecognized top-level key")
    func savePreservesUnknownTopLevelKey() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("anglesite.json")
        try #"{"version":1,"futureSection":{"foo":"bar"}}"#.write(to: fileURL, atomically: true, encoding: .utf8)

        let store = DomainConfigStore(sourceDirectory: dir)
        try store.save(DomainConfig(domain: .init(hostname: "example.com")))

        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)) as? [String: Any]
        let future = raw?["futureSection"] as? [String: Any]
        #expect(future?["foo"] as? String == "bar")
        #expect((raw?["domain"] as? [String: Any])?["hostname"] as? String == "example.com")
    }

    @Test("save preserves an unrecognized key nested inside a known section")
    func savePreservesUnknownNestedKey() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let fileURL = dir.appendingPathComponent("anglesite.json")
        try #"{"version":1,"domain":{"hostname":"old.example.com","futureField":"x"}}"#.write(
            to: fileURL, atomically: true, encoding: .utf8
        )

        let store = DomainConfigStore(sourceDirectory: dir)
        try store.save(DomainConfig(domain: .init(hostname: "new.example.com")))

        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: fileURL)) as? [String: Any]
        let domain = raw?["domain"] as? [String: Any]
        #expect(domain?["hostname"] as? String == "new.example.com")
        #expect(domain?["futureField"] as? String == "x")
    }
}
