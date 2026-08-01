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
        // registrar/expiresAt are explicit "" rather than nil (see the method's doc comment) so
        // this call also overwrites any registrar/expiration cached under a previously-declared
        // hostname.
        #expect(config.domain == DomainConfig.Domain(
            hostname: "example.com", choice: "transfer", attach: true, registrar: "", expiresAt: ""))
    }

    @Test("recordBuyIntent writes an empty-string-hostname buy declaration")
    func recordBuyIntentWritesDomainSection() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordBuyIntent(siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        // hostname/registrar/expiresAt are explicit "" rather than nil so this call overwrites
        // (rather than leaves untouched) values declared by a prior recordTransferIntent — see
        // the method's doc comment for why nil can't express that under DomainConfigStore's
        // merge-save.
        #expect(config.domain == DomainConfig.Domain(
            hostname: "", choice: "buy", attach: false, registrar: "", expiresAt: ""))
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

    /// #1194 review round 3, finding 2: a prior domain's cached registrar/expiration must not
    /// survive under a freshly-declared hostname — `DomainConfigStore.save`'s merge otherwise
    /// preserves an omitted (`nil`) field from whatever's already on disk, so a *new*
    /// `recordTransferIntent` call with no registrar/expiresAt of its own would leave the *old*
    /// domain's values sitting there, now mismatched with the new hostname.
    @Test("recordTransferIntent for a new hostname clears a previously-cached registrar/expiresAt")
    func recordTransferIntentClearsStaleRegistrarAndExpiresAt() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(
            hostname: "old.example.com", choice: "transfer", attach: true,
            registrar: "Old Registrar, LLC", expiresAt: "2020-01-01T00:00:00Z")))

        DomainIntentRecorder.recordTransferIntent(hostname: "new.example.com", siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain?.hostname == "new.example.com")
        #expect(config.domain?.registrar != "Old Registrar, LLC")
        #expect(config.domain?.expiresAt != "2020-01-01T00:00:00Z")
    }

    /// Same carryover risk as above, but via the buy path: switching from a previously-declared
    /// transfer (with cached registrar info) to "Buy a domain" must not leave that registrar info
    /// behind under the now-empty hostname.
    @Test("recordBuyIntent after a prior recordTransferIntent clears registrar/expiresAt")
    func recordBuyIntentClearsStaleRegistrarAndExpiresAt() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try DomainConfigStore(sourceDirectory: dir).save(DomainConfig(domain: .init(
            hostname: "old.example.com", choice: "transfer", attach: true,
            registrar: "Old Registrar, LLC", expiresAt: "2020-01-01T00:00:00Z")))

        DomainIntentRecorder.recordBuyIntent(siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain?.registrar != "Old Registrar, LLC")
        #expect(config.domain?.expiresAt != "2020-01-01T00:00:00Z")
    }
}
