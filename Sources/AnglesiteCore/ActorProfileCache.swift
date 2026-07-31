import Foundation

/// Per-site cache of follower display identities, persisted in the `.anglesite` package's
/// `Config/` directory.
///
/// `Config/` — not `Source/` — because this is app-owned per-site state that must never enter
/// the site's git repo (#242). Follows `POSSESyndicationLog`'s shape: an envelope-wrapped JSON
/// file, ISO-8601 dates, atomic write, and `nil` rather than a throw on a corrupt file.
public struct ActorProfileCache: Equatable, Sendable {
    /// The cache's filename inside `Config/`. Namespaced with an `activitypub-` prefix because
    /// `Config/` is a flat directory shared by every app-owned per-site store.
    public static let filename = "activitypub-follower-profiles.json"

    /// Seven days. Display names and avatars change rarely, so a few days of staleness costs
    /// nothing — while re-fetching on every launch would ping every follower's home instance
    /// for no benefit, and disclose the owner's IP to all of them each time.
    public static let timeToLive: TimeInterval = 7 * 24 * 60 * 60

    /// Keyed by the actor IRI's string form: `URL` is not `Hashable`-stable enough across
    /// normalizations to key on directly.
    private var profiles: [String: ActorProfile]

    /// Builds a cache from a flat profile list (the persisted envelope's shape). When two entries
    /// share an actor IRI the later one wins — last write is the freshest.
    public init(profiles: [ActorProfile] = []) {
        self.profiles = profiles.reduce(into: [:]) { $0[$1.actor.absoluteString] = $1 }
    }

    /// The cached profile, or `nil` when absent or older than ``timeToLive``.
    public func profile(for actor: URL, now: Date = Date()) -> ActorProfile? {
        guard let cached = profiles[actor.absoluteString] else { return nil }
        guard now.timeIntervalSince(cached.fetchedAt) < Self.timeToLive else { return nil }
        return cached
    }

    /// Stores (or replaces) the entry for the profile's actor. Expiry is applied on read and on
    /// save, never here — storing a fresh fetch must always win over whatever it replaces.
    public mutating func store(_ profile: ActorProfile) {
        profiles[profile.actor.absoluteString] = profile
    }

    private struct Envelope: Codable { let profiles: [ActorProfile] }

    /// Loads the cache from `configDirectory`, or `nil` when the file is missing or corrupt —
    /// a bad cache costs only re-fetches, so it's discarded silently rather than surfaced as an
    /// error the owner can't act on.
    public static func load(from configDirectory: URL) -> ActorProfileCache? {
        guard let data = try? Data(contentsOf: configDirectory.appendingPathComponent(filename))
        else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return ActorProfileCache(profiles: envelope.profiles)
    }

    /// Writes the cache, dropping entries already past ``timeToLive``.
    ///
    /// The prune is what keeps the file from growing monotonically with every follower the site
    /// has ever had: an expired entry is already invisible to ``profile(for:now:)``, so carrying
    /// it forward only costs bytes on disk and encode time on every subsequent save. Callers save
    /// on a debounce while enrichment streams in, so this runs repeatedly — see
    /// `FollowersModel.scheduleCacheSave`, which also keeps it off the MainActor.
    public func save(to configDirectory: URL, now: Date = Date()) throws {
        try FileManager.default.createDirectory(
            at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let fresh = profiles.values
            .filter { now.timeIntervalSince($0.fetchedAt) < Self.timeToLive }
            .sorted { $0.actor.absoluteString < $1.actor.absoluteString }
        let data = try encoder.encode(Envelope(profiles: fresh))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
