import Testing
import Foundation
@testable import AnglesiteCore

@Suite("CommunitiesLedger")
struct CommunitiesLedgerTests {
    private static func sample(handle: String = "@birding@lemmy.ml") -> JoinedCommunity {
        JoinedCommunity(
            actorID: URL(string: "https://lemmy.ml/c/birding")!,
            outboxURL: URL(string: "https://lemmy.ml/c/birding/outbox")!,
            handle: handle,
            displayName: "Birding",
            joinedAt: Date(timeIntervalSince1970: 1_700_000_000),
            followActivityID: "https://example.com/users/site/outbox/1")
    }

    @Test("record then contains reports true for the same actorID")
    func recordAndContains() {
        var ledger = CommunitiesLedger()
        #expect(!ledger.contains(actorID: Self.sample().actorID))
        ledger.record(Self.sample())
        #expect(ledger.contains(actorID: Self.sample().actorID))
        #expect(ledger.communities.count == 1)
    }

    @Test("recording the same actorID twice does not duplicate")
    func recordIsIdempotent() {
        var ledger = CommunitiesLedger()
        ledger.record(Self.sample())
        ledger.record(Self.sample(handle: "@birding@lemmy.ml"))
        #expect(ledger.communities.count == 1)
    }

    @Test("remove drops the matching community and leaves the rest")
    func remove() {
        var ledger = CommunitiesLedger()
        ledger.record(Self.sample())
        let other = JoinedCommunity(
            actorID: URL(string: "https://mastodon.social/c/other")!, outboxURL: nil,
            handle: nil, displayName: nil, joinedAt: Date(), followActivityID: nil)
        ledger.record(other)

        ledger.remove(actorID: Self.sample().actorID)

        #expect(ledger.communities == [other])
    }

    @Test("save then load round-trips through JSON on disk")
    func saveAndLoadRoundTrip() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-ledger-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: tempDir) }

        var ledger = CommunitiesLedger()
        ledger.record(Self.sample())
        try ledger.save(to: tempDir)

        let loaded = try #require(CommunitiesLedger.load(from: tempDir))
        #expect(loaded == ledger)
    }

    @Test("load returns nil when no ledger file exists yet")
    func loadMissingFileReturnsNil() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("communities-ledger-missing-\(UUID().uuidString)")
        #expect(CommunitiesLedger.load(from: tempDir) == nil)
    }
}
