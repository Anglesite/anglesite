import Testing
import Foundation
@testable import AnglesiteCore

private final class FakeMarkdownWriter: CloudflareWriting, @unchecked Sendable {
    var result: Swift.Result<Bool, Error> = .success(true)
    private(set) var calls: [(hostname: String, enabled: Bool)] = []

    func setMarkdownForAgents(hostname: String, enabled: Bool, apiToken: String) async throws -> Bool {
        calls.append((hostname, enabled))
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
    func attachWorkersCustomDomain(
        hostname: String, workerScriptName: String, apiToken: String
    ) async throws -> CustomDomainAttachResult {
        .attached
    }
}

private struct FakeError: Error {}

struct MarkdownForAgentsCommandTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeConfigDir() throws -> URL {
        let dir = tmpDir.appendingPathComponent("markdown-for-agents-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("applies the zone setting when no opt-out is configured")
    func appliesWhenNotOptedOut() async throws {
        let dir = try makeConfigDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeMarkdownWriter()
        let command = MarkdownForAgentsCommand(client: writer)
        let result = await command.apply(hostname: "example.com", configDirectory: dir, apiToken: "t")
        #expect(result == .applied(hostname: "example.com"))
        #expect(writer.calls.count == 1)
        #expect(writer.calls.first?.hostname == "example.com")
        #expect(writer.calls.first?.enabled == true)
    }

    @Test("applies with no configDirectory at all (defaults to enabled)")
    func appliesWithNoConfigDirectory() async throws {
        let writer = FakeMarkdownWriter()
        let command = MarkdownForAgentsCommand(client: writer)
        let result = await command.apply(hostname: "example.com", configDirectory: nil, apiToken: "t")
        #expect(result == .applied(hostname: "example.com"))
        #expect(writer.calls.count == 1)
    }

    @Test("opts out with no network call when the owner disabled it in Site Settings")
    func optsOutWhenDisabled() async throws {
        let dir = try makeConfigDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try await SiteConfigStore(configDirectory: dir).save(SiteSettings(markdownForAgentsDisabled: true))
        let writer = FakeMarkdownWriter()
        let command = MarkdownForAgentsCommand(client: writer)
        let result = await command.apply(hostname: "example.com", configDirectory: dir, apiToken: "t")
        #expect(result == .optedOut)
        #expect(writer.calls.isEmpty)
    }

    @Test("reports .zoneNotFound when the token can't see the zone yet")
    func reportsZoneNotFound() async throws {
        let dir = try makeConfigDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeMarkdownWriter()
        writer.result = .success(false)
        let command = MarkdownForAgentsCommand(client: writer)
        let result = await command.apply(hostname: "example.com", configDirectory: dir, apiToken: "t")
        #expect(result == .zoneNotFound(hostname: "example.com"))
    }

    @Test("reports .failed without throwing when the Cloudflare API call fails")
    func reportsFailedOnThrow() async throws {
        let dir = try makeConfigDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let writer = FakeMarkdownWriter()
        writer.result = .failure(FakeError())
        let command = MarkdownForAgentsCommand(client: writer)
        let result = await command.apply(hostname: "example.com", configDirectory: dir, apiToken: "t")
        #expect(result == .failed(hostname: "example.com"))
    }
}
