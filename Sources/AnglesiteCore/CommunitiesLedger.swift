import Foundation

/// One community this site has joined (V-5.1a, #368).
public struct JoinedCommunity: Codable, Equatable, Sendable, Identifiable {
    public let actorID: URL
    /// For `GroupTimelineClient` — `nil` if the actor document didn't advertise one.
    public let outboxURL: URL?
    public let handle: String?
    public let displayName: String?
    public let joinedAt: Date
    /// The `Follow` activity id `CommunityMembershipClient.follow(target:)` returned — threaded
    /// back into `unfollow(target:followActivityID:)` on leave.
    public let followActivityID: String?

    public var id: String { actorID.absoluteString }

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
    public static let filename = "activitypub-communities.json"

    public private(set) var communities: [JoinedCommunity]

    public init(communities: [JoinedCommunity] = []) {
        self.communities = communities
    }

    public func contains(actorID: URL) -> Bool {
        communities.contains { $0.actorID == actorID }
    }

    /// No-ops if `actorID` is already recorded — matches `ActivityPubOutboxLedger.record`'s
    /// idempotent-insert contract.
    public mutating func record(_ community: JoinedCommunity) {
        guard !contains(actorID: community.actorID) else { return }
        communities.append(community)
    }

    public mutating func remove(actorID: URL) {
        communities.removeAll { $0.actorID == actorID }
    }

    private struct Envelope: Codable {
        let communities: [JoinedCommunity]
    }

    public static func load(from configDirectory: URL) -> CommunitiesLedger? {
        let url = configDirectory.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        return CommunitiesLedger(communities: envelope.communities)
    }

    public func save(to configDirectory: URL) throws {
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(Envelope(communities: communities))
        try data.write(to: configDirectory.appendingPathComponent(Self.filename), options: .atomic)
    }
}
