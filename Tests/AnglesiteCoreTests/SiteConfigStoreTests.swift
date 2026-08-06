import Testing
import Foundation
@testable import AnglesiteCore

struct SiteConfigStoreTests {
    private func tempConfigDir() throws -> URL {
        let d = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("siteconfig-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("Config", isDirectory: true)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test("load returns empty settings when the file is absent")
    func loadDefaultsWhenMissing() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)
        let settings = try await store.load()
        #expect(settings == SiteSettings())
    }

    @Test("save then load round-trips settings through settings.plist")
    func saveLoadRoundTrips() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)
        try await store.save(SiteSettings(displayName: "Acme HQ"))

        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("settings.plist").path))
        let loaded = try await store.load()
        #expect(loaded.displayName == "Acme HQ")
    }

    @Test("save creates the Config directory if it does not exist")
    func saveCreatesConfigDir() async throws {
        let parent = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("siteconfig-\(UUID().uuidString)", isDirectory: true)
        let dir = parent.appendingPathComponent("Config", isDirectory: true)   // not yet created
        defer { try? FileManager.default.removeItem(at: parent) }
        let store = SiteConfigStore(configDirectory: dir)
        try await store.save(SiteSettings(displayName: "X"))
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("settings.plist").path))
    }

    @Test("load falls back to defaults when settings.plist is corrupt/incompatible")
    func loadFallsBackOnUndecodable() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        try Data("not a plist".utf8).write(to: dir.appendingPathComponent("settings.plist"))
        let store = SiteConfigStore(configDirectory: dir)
        #expect(try await store.load() == SiteSettings())
    }

    @Test("a second save overwrites the first (atomic replace, not merge)")
    func saveOverwritesPrevious() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)
        try await store.save(SiteSettings(displayName: "First"))
        try await store.save(SiteSettings(displayName: "Second"))
        #expect(try await store.load() == SiteSettings(displayName: "Second"))
        // Clearing a field round-trips too (overwrite, not stale-merge).
        try await store.save(SiteSettings(displayName: nil))
        #expect(try await store.load() == SiteSettings())
    }

    @Test("deployedSourceBundleCommit round-trips through save/load")
    func deployedSourceBundleCommitRoundTrips() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)

        var settings = try await store.load()
        #expect(settings.deployedSourceBundleCommit == nil)

        settings.deployedSourceBundleCommit = "abc123def456"
        try await store.save(settings)

        let reloaded = try await store.load()
        #expect(reloaded.deployedSourceBundleCommit == "abc123def456")
    }

    // MARK: - Synchronous `read` seam (#266)

    @Test("read returns empty settings when the file is absent")
    func readDefaultsWhenMissing() throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        #expect(try SiteConfigStore.read(from: dir) == SiteSettings())
    }

    @Test("read decodes the same settings the actor's load returns")
    func readMatchesLoad() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)
        try await store.save(SiteSettings(displayName: "Acme HQ"))
        #expect(try SiteConfigStore.read(from: dir) == (try await store.load()))
        #expect(try SiteConfigStore.read(from: dir).displayName == "Acme HQ")
    }

    @Test("read falls back to defaults on a corrupt plist rather than throwing")
    func readDefaultsWhenCorrupt() throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        try Data("not a plist".utf8).write(to: dir.appendingPathComponent("settings.plist"))
        #expect(try SiteConfigStore.read(from: dir) == SiteSettings())
    }

    @Test("save then load round-trips the persisted worker-state fields")
    func saveLoadRoundTripsWorkerState() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)
        let settings = SiteSettings(
            activeWorkerIDs: ["solid-pod", "webdav"],
            lastDeployedWorkerIDs: ["webmention", "indieauth"],
            provisionedWorkerResources: .init(d1DatabaseID: "d1-id", kvNamespaceID: "kv-id", r2BucketName: nil)
        )
        try await store.save(settings)

        let loaded = try await store.load()
        #expect(loaded.activeWorkerIDs == ["solid-pod", "webdav"])
        #expect(loaded.lastDeployedWorkerIDs == ["webmention", "indieauth"])
        #expect(loaded.provisionedWorkerResources == .init(d1DatabaseID: "d1-id", kvNamespaceID: "kv-id", r2BucketName: nil))
    }

    @Test("an old-format settings.plist missing the worker-state keys still decodes")
    func loadOldFormatWithoutWorkerState() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        // Simulates a plist written by a build that predates these fields: only `displayName`.
        let oldFormat = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>displayName</key>
            <string>Old Site</string>
        </dict>
        </plist>
        """
        try oldFormat.write(to: dir.appendingPathComponent("settings.plist"), atomically: true, encoding: .utf8)
        let store = SiteConfigStore(configDirectory: dir)

        let loaded = try await store.load()
        #expect(loaded.displayName == "Old Site")
        #expect(loaded.activeWorkerIDs == nil)
        #expect(loaded.lastDeployedWorkerIDs == nil)
        #expect(loaded.provisionedWorkerResources == nil)
    }

    @Test("webmentionReceivePaidPlanAcknowledged round-trips through save/load")
    func webmentionPaidPlanFlagRoundTrips() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)

        let settings = SiteSettings(webmentionReceivePaidPlanAcknowledged: true)
        try await store.save(settings)

        let loaded = try await store.load()
        #expect(loaded.webmentionReceivePaidPlanAcknowledged == true)
    }

    @Test("a settings.plist written before webmentionReceivePaidPlanAcknowledged existed still decodes (forward-compat)")
    func decodesOldPlistWithoutPaidPlanField() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        // Simulates a plist written by a build that predates this field.
        let oldFormat = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>displayName</key>
            <string>My Site</string>
        </dict>
        </plist>
        """
        try oldFormat.write(to: dir.appendingPathComponent("settings.plist"), atomically: true, encoding: .utf8)
        let store = SiteConfigStore(configDirectory: dir)

        let loaded = try await store.load()
        #expect(loaded.webmentionReceivePaidPlanAcknowledged == nil)
    }

    @Test("communityOutboxURL round-trips through save/load")
    func communityOutboxURLRoundTrips() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)

        let settings = SiteSettings(communityOutboxURL: URL(string: "https://community.example/users/birding/outbox"))
        try await store.save(settings)

        let loaded = try await store.load()
        #expect(loaded.communityOutboxURL == URL(string: "https://community.example/users/birding/outbox"))
    }

    @Test("a settings.plist written before communityOutboxURL existed still decodes (forward-compat)")
    func decodesOldPlistWithoutCommunityOutboxURL() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        // Simulates a plist written by a build that predates this field.
        let oldFormat = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>displayName</key>
            <string>My Site</string>
        </dict>
        </plist>
        """
        try oldFormat.write(to: dir.appendingPathComponent("settings.plist"), atomically: true, encoding: .utf8)
        let store = SiteConfigStore(configDirectory: dir)

        let loaded = try await store.load()
        #expect(loaded.communityOutboxURL == nil)
    }

    @Test("communityActorURL and moderators round-trip through save/load")
    func communityActorURLAndModeratorsRoundTrip() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = SiteConfigStore(configDirectory: dir)

        let settings = SiteSettings(
            communityActorURL: URL(string: "https://community.example/users/birding"),
            moderators: ["https://mod1.example/actor", "https://mod2.example/actor"]
        )
        try await store.save(settings)

        let loaded = try await store.load()
        #expect(loaded.communityActorURL == URL(string: "https://community.example/users/birding"))
        #expect(loaded.moderators == ["https://mod1.example/actor", "https://mod2.example/actor"])
    }

    @Test("a settings.plist written before communityActorURL/moderators existed still decodes (forward-compat)")
    func decodesOldPlistWithoutCommunityActorURLOrModerators() async throws {
        let dir = try tempConfigDir()
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let oldFormat = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>displayName</key>
            <string>My Site</string>
        </dict>
        </plist>
        """
        try oldFormat.write(to: dir.appendingPathComponent("settings.plist"), atomically: true, encoding: .utf8)
        let store = SiteConfigStore(configDirectory: dir)

        let loaded = try await store.load()
        #expect(loaded.communityActorURL == nil)
        #expect(loaded.moderators == nil)
    }

    @Test("inboxCaptureEnabled and ProvisionedResources' inbox fields round-trip through plist encode/decode")
    func inboxCaptureFieldsRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("SiteConfigStoreTests-inbox-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = SiteConfigStore(configDirectory: dir)
        let settings = SiteSettings(
            provisionedWorkerResources: .init(inboxKVNamespaceID: "ns-1", inboxAccountID: "acct-1"),
            inboxCaptureEnabled: true
        )
        try await store.save(settings)
        let loaded = try await store.load()
        #expect(loaded.inboxCaptureEnabled == true)
        #expect(loaded.provisionedWorkerResources?.inboxKVNamespaceID == "ns-1")
        #expect(loaded.provisionedWorkerResources?.inboxAccountID == "acct-1")
    }

    @Test("a settings.plist with no inboxCaptureEnabled key decodes it as nil")
    func inboxCaptureEnabledDefaultsNilOnOldFile() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("SiteConfigStoreTests-inbox-old-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try await SiteConfigStore(configDirectory: dir).save(SiteSettings(displayName: "Old Site"))
        let loaded = try await SiteConfigStore(configDirectory: dir).load()
        #expect(loaded.inboxCaptureEnabled == nil)
        #expect(loaded.displayName == "Old Site")
    }
}
