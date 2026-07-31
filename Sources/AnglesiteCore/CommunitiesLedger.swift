import Foundation

/// One community this site has joined (V-5.1a, #368).
public struct JoinedCommunity: Codable, Equatable, Sendable, Identifiable {
    /// The community's canonical ActivityPub actor id URL — the identity key the ledger dedupes
    /// and removes by.
    public let actorID: URL
    /// For `GroupTimelineClient` — `nil` if the actor document didn't advertise one.
    public let outboxURL: URL?
    /// Fediverse handle (e.g. `@garden@example.social`), when discovery resolved one. Display
    /// nicety only — never used as identity, since handles can change while ``actorID`` can't.
    public let handle: String?
    /// The actor's self-declared display name, when the actor document carried one.
    public let displayName: String?
    /// When this site joined — recorded locally at join time because no public collection
    /// exists to recover it from later.
    public let joinedAt: Date
    /// The `Follow` activity id `CommunityMembershipClient.follow(target:)` returned — threaded
    /// back into `unfollow(target:followActivityID:)` on leave.
    public let followActivityID: String?

    /// `Identifiable` via the actor id string, so SwiftUI lists key rows by the same identity
    /// the ledger itself uses.
    public var id: String { actorID.absoluteString }

    /// Memberwise initializer; the join flow assembles this from the fetched actor document plus
    /// the follow call's returned activity id.
    public init(
        actorID: URL, outboxURL: URL?, handle: String?, displayName: String?, joinedAt: Date,
        followActivityID: String?
    ) {
        self.actorID = actorID
        self.outboxURL = outboxURL
        self.handle = handle
        self.displayName = displayName
        self.joinedAt = joinedAt
        self.followActivityID = followActivityID
    }
}

/// Durable per-site record of which fediverse communities this site has joined —
/// `Config/activitypub-communities.json`, app-owned, never in git. There is no public "following"
/// collection to read this back from (`@dwk/activitypub` exposes `followers`, not `following`, as
/// a public AS2 collection), so this ledger — not the Worker — is the source of truth for what the
/// Communities pane lists. Same shape and crash-safety contract as `ActivityPubOutboxLedger`.
public struct CommunitiesLedger: Codable, Equatable, Sendable {
    /// The ledger's file name inside the site's `Config/` directory.
    public static let filename = "activitypub-communities.json"

    /// The joined communities, in join order. `private(set)` so every mutation goes through
    /// ``record(_:)``/``remove(actorID:)`` and their dedupe contract can't be bypassed.
    public private(set) var communities: [JoinedCommunity]

    /// Starts empty by default — the state of a site that has never joined a community.
    public init(communities: [JoinedCommunity] = []) {
        self.communities = communities
    }

    /// Whether `actorID` is already recorded — the membership check the Communities UI and
    /// ``record(_:)``'s idempotence both rest on.
    public func contains(actorID: URL) -> Bool {
        communities.contains { $0.actorID == actorID }
    }

    /// No-ops if `actorID` is already recorded — matches `ActivityPubOutboxLedger.record`'s
    /// idempotent-insert contract.
    public mutating func record(_ community: JoinedCommunity) {
        guard !contains(actorID: community.actorID) else { return }
        communities.append(community)
    }

    /// Removes the entry for `actorID`; a no-op when it was never recorded, so a leave that
    /// races a stale UI can't fail.
    public mutating func remove(actorID: URL) {
        communities.removeAll { $0.actorID == actorID }
    }

    private struct Envelope: Codable {
        let communities: [JoinedCommunity]
    }

    /// Reads the ledger from `configDirectory`, or `nil` when the file is absent or undecodable —
    /// callers treat both as "no communities yet" rather than failing, since a fresh site
    /// legitimately has no ledger file.
    public static func load(from configDirectory: URL) -> CommunitiesLedger? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return CommunitiesLedger(communities: envelope.communities)
    }

    /// Persists the ledger into `configDirectory` (creating it if needed). The write is atomic so
    /// a crash mid-save can't leave a truncated file, and the JSON is pretty-printed with sorted
    /// keys so successive saves diff cleanly — the same crash-safety contract as
    /// `ActivityPubOutboxLedger`.
    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(communities: communities))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
