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

    /// Without a prune the file grows monotonically with every follower the site has ever had,
    /// and every debounced save re-encodes the whole accumulated history — for entries
    /// `profile(for:now:)` already refuses to return.
    @Test("save drops entries past the TTL")
    func savePrunesExpiredProfiles() throws {
        let directory = try Self.makeConfigDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date()
        let stale = try #require(URL(string: "https://example.social/users/bob"))

        var cache = ActorProfileCache()
        cache.store(Self.profile(fetchedAt: now.addingTimeInterval(-60)))
        cache.store(ActorProfile(
            actor: stale, preferredUsername: "bob", name: "Bob",
            iconURL: nil,
            fetchedAt: now.addingTimeInterval(-ActorProfileCache.timeToLive - 1)))
        try cache.save(to: directory, now: now)

        // Asserted against the file itself, not just the reloaded cache: an expired entry is
        // already invisible through `profile(for:now:)`, so only the bytes on disk show the prune.
        let written = try Data(
            contentsOf: directory.appendingPathComponent(ActorProfileCache.filename))
        let object = try JSONSerialization.jsonObject(with: written) as? [String: Any]
        let persisted = try #require(object?["profiles"] as? [[String: Any]])
        #expect(persisted.count == 1)
        #expect(persisted.first?["actor"] as? String == Self.alice.absoluteString)

        // Reloading must not resurrect it, even asked with a `now` that would make it fresh.
        let reloaded = try #require(ActorProfileCache.load(from: directory))
        #expect(reloaded.profile(for: stale, now: now.addingTimeInterval(-ActorProfileCache.timeToLive)) == nil)
        #expect(reloaded.profile(for: Self.alice, now: now)?.name == "Alice Example")
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
