import Foundation

/// Per-site cache of follower display identities, persisted in the `.anglesite` package's
/// `Config/` directory.
///
/// `Config/` — not `Source/` — because this is app-owned per-site state that must never enter
/// the site's git repo (#242). Follows `POSSESyndicationLog`'s shape: an envelope-wrapped JSON
/// file, ISO-8601 dates, atomic write, and `nil` rather than a throw on a corrupt file.
public struct ActorProfileCache: Equatable, Sendable {
    public static let filename = "activitypub-follower-profiles.json"

    /// Seven days. Display names and avatars change rarely, so a few days of staleness costs
    /// nothing — while re-fetching on every launch would ping every follower's home instance
    /// for no benefit, and disclose the owner's IP to all of them each time.
    public static let timeToLive: TimeInterval = 7 * 24 * 60 * 60

    /// Keyed by the actor IRI's string form: `URL` is not `Hashable`-stable enough across
    /// normalizations to key on directly.
    private var profiles: [String: ActorProfile]

    public init(profiles: [ActorProfile] = []) {
        self.profiles = profiles.reduce(into: [:]) { $0[$1.actor.absoluteString] = $1 }
    }

    /// The cached profile, or `nil` when absent or older than ``timeToLive``.
    public func profile(for actor: URL, now: Date = Date()) -> ActorProfile? {
        guard let cached = profiles[actor.absoluteString] else { return nil }
        guard now.timeIntervalSince(cached.fetchedAt) < Self.timeToLive else { return nil }
        return cached
    }

    public mutating func store(_ profile: ActorProfile) {
        profiles[profile.actor.absoluteString] = profile
    }

    private struct Envelope: Codable { let profiles: [ActorProfile] }

    public static func load(from configDirectory: URL) -> ActorProfileCache? {
        guard let data = try? Data(contentsOf: configDirectory.appendingPathComponent(filename))
        else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return ActorProfileCache(profiles: envelope.profiles)
    }

    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(
            at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(
            Envelope(profiles: profiles.values.sorted { $0.actor.absoluteString < $1.actor.absoluteString }))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
