import Foundation
import Testing
@testable import AnglesiteCore

@Suite("ActivityPubOutboxLedger")
struct ActivityPubOutboxLedgerTests {
    func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test("load returns nil when no ledger file exists yet")
    func loadReturnsNilWhenAbsent() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(ActivityPubOutboxLedger.load(from: dir) == nil)
    }

    @Test("record then contains reports true for that canonical URL")
    func recordThenContains() throws {
        var ledger = ActivityPubOutboxLedger()
        #expect(!ledger.contains(canonicalURL: "https://owner.example/blog/hello/"))

        ledger.record(.init(
            canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: Date()
        ))

        #expect(ledger.contains(canonicalURL: "https://owner.example/blog/hello/"))
    }

    @Test("recording the same canonical URL twice does not duplicate the entry")
    func recordIsIdempotent() throws {
        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: Date()))
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "different-id", syncedAt: Date()))

        #expect(ledger.entries.count == 1)
        #expect(ledger.entries.first?.activityID == "abc123") // first write wins
    }

    @Test("save then load round-trips entries through JSON")
    func saveThenLoadRoundTrips() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        var ledger = ActivityPubOutboxLedger()
        let syncedAt = ISO8601DateFormatter().date(from: "2026-07-24T12:00:00Z")!
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: syncedAt))
        try ledger.save(to: dir)

        let loaded = try #require(ActivityPubOutboxLedger.load(from: dir))
        #expect(loaded.entries.count == 1)
        #expect(loaded.entries.first?.canonicalURL == "https://owner.example/blog/hello/")
        #expect(loaded.entries.first?.activityID == "abc123")
        #expect(loaded.entries.first?.syncedAt == syncedAt)
    }

    @Test("save creates the configDirectory if it doesn't exist yet")
    func saveCreatesDirectory() throws {
        let dir = try makeTempDir().appendingPathComponent("nested/config")
        defer { try? FileManager.default.removeItem(at: dir) }

        var ledger = ActivityPubOutboxLedger()
        ledger.record(.init(canonicalURL: "https://owner.example/blog/hello/", activityID: "abc123", syncedAt: Date()))

        try ledger.save(to: dir)

        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent(ActivityPubOutboxLedger.filename).path))
    }
}
