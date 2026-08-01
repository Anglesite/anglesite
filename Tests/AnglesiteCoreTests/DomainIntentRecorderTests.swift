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

    @Test("recordBuyIntent writes a nil-hostname buy declaration")
    func recordBuyIntentWritesDomainSection() throws {
        let dir = try makeSiteDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        DomainIntentRecorder.recordBuyIntent(siteDirectory: dir)

        let config = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(config.domain == DomainConfig.Domain(hostname: nil, choice: "buy", attach: false))
    }
}
