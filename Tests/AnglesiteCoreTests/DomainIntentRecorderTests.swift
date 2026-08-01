import Testing
import Foundation
@testable import AnglesiteCore

struct DomainIntentRecorderTests {
    private let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)

    private func makeSiteDir() throws -> URL {
        let dir = tmpDir.appendingPathComponent("domain-intent-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("recordTransferIntent writes hostname/choice/attach into anglesite.json's domain section")
    func recordTransferIntentWritesDomainSection() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordTransferIntent(hostname: "example.com", siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain == DomainConfig.Domain(hostname: "example.com", choice: "transfer", attach: true))
    }

    @Test("recordBuyIntent writes an empty-string-hostname buy declaration")
    func recordBuyIntentWritesDomainSection() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordBuyIntent(siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        // hostname is an explicit "" rather than nil so this call overwrites (rather than
        // leaves untouched) a hostname declared by a prior recordTransferIntent — see the
        // method's doc comment for why nil can't express that under DomainConfigStore's merge-save.
        #expect(config.domain == DomainConfig.Domain(hostname: "", choice: "buy", attach: false))
    }

    @Test("recordBuyIntent after a prior recordTransferIntent clears the hostname")
    func recordBuyIntentAfterTransferIntentClearsHostname() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordTransferIntent(hostname: "old.example.com", siteDirectory: dir)
        DomainIntentRecorder.recordBuyIntent(siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain?.choice == "buy")
        #expect(config.domain?.hostname != "old.example.com")
    }
}
