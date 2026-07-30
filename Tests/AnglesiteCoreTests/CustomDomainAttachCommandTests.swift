import Testing
import Foundation
@testable import AnglesiteCore

/// A `CloudflareWriting` fake whose `attachWorkersCustomDomain` result is controlled per test.
/// Not `private` — reused by `DeployCommandTests` (Task 3) in the same test target.
final class FakeCloudflareWriting: CloudflareWriting, @unchecked Sendable {
    var result: Swift.Result<CustomDomainAttachResult, Error> = .success(.attached)
    private(set) var calls: [(hostname: String, workerScriptName: String)] = []

    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        calls.append((hostname, workerScriptName))
        return try result.get()
    }

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
}

struct CustomDomainAttachCommandTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeSiteDir(config: String) throws -> URL {
        let dir = tmpDir.appendingPathComponent("domain-attach-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try config.write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        return dir
    }

    @Test("skips when DOMAIN_CHOICE is not transfer")
    func skipsWhenNotTransfer() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=later\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("skips when DOMAIN is empty")
    func skipsWhenDomainEmpty() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("skips when already attached")
    func skipsWhenAlreadyPersisted() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\nCF_DOMAIN_ATTACHED=true\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("skips without calling out when CF_PROJECT_NAME is missing")
    func skipsWhenNoProjectName() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .skipped)
        #expect(writer.calls.isEmpty)
    }

    @Test("confirms and persists CF_DOMAIN_ATTACHED on a fresh attach")
    func confirmsFreshAttach() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.attached)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .confirmed(hostname: "example.com"))
        #expect(writer.calls.first?.hostname == "example.com")
        #expect(writer.calls.first?.workerScriptName == "my-site")
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CF_DOMAIN_ATTACHED=true"))
    }

    @Test("confirms and persists when already attached to this site's own Worker")
    func confirmsAlreadyOwnAttachment() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.alreadyAttached)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .confirmed(hostname: "example.com"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CF_DOMAIN_ATTACHED=true"))
    }

    @Test("reports not connected with no persistence when the zone isn't found yet")
    func notConnectedNoPersistence() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.zoneNotFound)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .notConnected(hostname: "example.com"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(!config.contains("CF_DOMAIN_ATTACHED"))
    }

    @Test("reports conflict with no persistence when claimed by a different Worker")
    func conflictNoPersistence() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .success(.conflict(ownedBy: "other-site"))
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .conflict(hostname: "example.com", ownedBy: "other-site"))
        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(!config.contains("CF_DOMAIN_ATTACHED"))
    }

    @Test("a Cloudflare API failure degrades to notConnected rather than throwing")
    func apiFailureDegradesGracefully() async throws {
        let dir = try makeSiteDir(config: "DOMAIN_CHOICE=transfer\nDOMAIN=example.com\nCF_PROJECT_NAME=my-site\n")
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeCloudflareWriting()
        writer.result = .failure(CloudflareError.malformedResponse)
        let command = CustomDomainAttachCommand(client: writer)
        let result = await command.attach(siteDirectory: dir, apiToken: "t")
        #expect(result == .notConnected(hostname: "example.com"))
    }
}
