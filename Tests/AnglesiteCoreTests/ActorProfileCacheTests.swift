import Testing
import Foundation
@testable import AnglesiteCore

@Suite("ActorProfileCache")
struct ActorProfileCacheTests {
    private static let alice = URL(string: "https://mastodon.social/users/alice")!

    private static func profile(fetchedAt: Date) -> ActorProfile {
        ActorProfile(
            actor: alice,
            preferredUsername: "alice",
            name: "Alice Example",
            iconURL: URL(string: "https://cdn.example.com/a.png"),
            fetchedAt: fetchedAt)
    }

    private static func makeConfigDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ActorProfileCacheTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("round-trips profiles through save and load")
    func roundTrips() throws {
        let directory = try Self.makeConfigDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date()

        var cache = ActorProfileCache()
        cache.store(Self.profile(fetchedAt: now))
        try cache.save(to: directory)

        let loaded = try #require(ActorProfileCache.load(from: directory))
        let restored = try #require(loaded.profile(for: Self.alice, now: now))
        #expect(restored.name == "Alice Example")
        #expect(restored.iconURL?.absoluteString == "https://cdn.example.com/a.png")
    }

    @Test("treats a profile older than the TTL as absent")
    func expiresStaleProfiles() throws {
        let now = Date()
        var cache = ActorProfileCache()
        cache.store(Self.profile(fetchedAt: now.addingTimeInterval(-ActorProfileCache.timeToLive - 1)))

        #expect(cache.profile(for: Self.alice, now: now) == nil)
    }

    @Test("returns a profile inside the TTL")
    func returnsFreshProfiles() throws {
        let now = Date()
        var cache = ActorProfileCache()
        cache.store(Self.profile(fetchedAt: now.addingTimeInterval(-60)))

        #expect(cache.profile(for: Self.alice, now: now)?.name == "Alice Example")
    }

    @Test("returns nil for an actor it has never seen")
    func returnsNilForUnknownActor() throws {
        let cache = ActorProfileCache()
        #expect(cache.profile(for: Self.alice) == nil)
    }

    /// A truncated or hand-edited cache must degrade to "no cache", never crash the pane.
    @Test("returns nil for a corrupt cache file instead of throwing")
    func toleratesCorruptFile() throws {
        let directory = try Self.makeConfigDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data("{ not json".utf8).write(
            to: directory.appendingPathComponent(ActorProfileCache.filename))

        #expect(ActorProfileCache.load(from: directory) == nil)
    }

    @Test("returns nil when no cache file exists yet")
    func toleratesMissingFile() throws {
        let directory = try Self.makeConfigDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        #expect(ActorProfileCache.load(from: directory) == nil)
    }

    @Test("storing the same actor twice keeps the newer profile")
    func storeOverwrites() throws {
        let now = Date()
        var cache = ActorProfileCache()
        cache.store(Self.profile(fetchedAt: now.addingTimeInterval(-60)))
        cache.store(ActorProfile(
            actor: Self.alice, preferredUsername: "alice", name: "Alice Renamed",
            iconURL: nil, fetchedAt: now))

        #expect(cache.profile(for: Self.alice, now: now)?.name == "Alice Renamed")
    }
}
