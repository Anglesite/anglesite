import Testing
import Foundation
@testable import AnglesiteCore

@Suite("DomainConfigStore.update")
struct DomainConfigStoreUpdateTests {
    private func tempSourceDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DomainConfigStoreUpdateTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("mutates a default config when no file exists yet, and saves it")
    func mutatesDefaultConfigWhenMissing() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let saved = DomainConfigStore.update(sourceDirectory: dir) { config in
            config.domain = DomainConfig.Domain(hostname: "example.com")
        }

        #expect(saved)
        let reloaded = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(reloaded.domain?.hostname == "example.com")
    }

    @Test("mutates the currently-saved config rather than starting fresh")
    func mutatesExistingConfig() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = DomainConfigStore(sourceDirectory: dir)
        try store.save(DomainConfig(email: .init(provider: "icloud", dmarcReportEmail: "postmaster@example.com")))

        DomainConfigStore.update(sourceDirectory: dir) { config in
            config.domain = DomainConfig.Domain(hostname: "example.com")
        }

        let reloaded = try store.load()
        #expect(reloaded.domain?.hostname == "example.com")
        #expect(reloaded.email?.provider == "icloud", "update() must not clobber sections it didn't touch")
    }

    @Test("falls back to a default config when the on-disk file is malformed, rather than throwing")
    func fallsBackToDefaultOnMalformedFile() throws {
        let dir = try tempSourceDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try "not json {".write(
            to: dir.appendingPathComponent("anglesite.json"), atomically: true, encoding: .utf8)

        let saved = DomainConfigStore.update(sourceDirectory: dir) { config in
            config.domain = DomainConfig.Domain(hostname: "example.com")
        }

        #expect(saved)
        let reloaded = try DomainConfigStore(sourceDirectory: dir).load()
        #expect(reloaded.domain?.hostname == "example.com")
    }

    @Test("returns false when the save fails, without throwing")
    func returnsFalseOnSaveFailure() throws {
        let missingDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("DomainConfigStoreUpdateTests-missing-\(UUID().uuidString)", isDirectory: true)

        let saved = DomainConfigStore.update(sourceDirectory: missingDir) { config in
            config.domain = DomainConfig.Domain(hostname: "example.com")
        }

        #expect(!saved)
    }
}
