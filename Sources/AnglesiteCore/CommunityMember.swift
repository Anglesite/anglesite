// Sources/AnglesiteCore/CommunityMember.swift
import Foundation

/// Schema for one current member of a hosted community, snapshotted from the Group actor's own
/// public followers collection into `Source/` git (V-5.1b, #907). Members = followers (design
/// doc §2 D3) — this mirrors `AnnouncedPost`'s reconcile-against-current-set discipline, but for
/// the membership set rather than the announced-post stream: a member who leaves or is banned
/// simply drops out of the fetched collection, and their snapshot file is removed on the next
/// reconcile (`CommunityMemberCommitter`).
///
/// One file per member at `Source/data/community-members/{id}.json`. See
/// `docs/superpowers/specs/2026-07-22-v5-communities-design.md` §4.2.
///
/// **Sanitisation contract:** `id` is validated at construction time — only `[A-Za-z0-9_-]+` is
/// accepted — to prevent path-traversal through `gitPath`. `actorURL`/`photo` are restricted to
/// `http`/`https` schemes at construction time, mirroring `AnnouncedPost`'s contract exactly:
/// both flow straight into `href`/`src` in `CommunityMembers.astro`.
///
/// **No `joinedAt`.** The AS2 followers collection (`GET <actor>/followers`) is a plain ordered
/// list of actor IRIs with no per-item metadata — there is nothing to snapshot a join timestamp
/// from, so this schema doesn't fabricate one.
public struct CommunityMember: Codable, Sendable, Equatable, Identifiable {
    /// Stable, filesystem-safe id derived from ``actorURL`` (see
    /// `CommunityMembersSync.fileID(for:)`).
    public let id: String
    /// The member's own actor IRI — canonical per FEP-1b12 (their profile/site stays
    /// authoritative; this is only the community's record of who's currently a member).
    public let actorURL: URL
    /// The member's display name, if the actor profile lookup resolved one. `nil` when the
    /// profile fetch failed or the actor omitted a name.
    public let name: String?
    /// The member's avatar URL, if resolved. Same web-scheme validation as ``actorURL``, since it
    /// flows into a `src`.
    public let photo: URL?

    /// The relative path within `Source/` where this member's snapshot is stored in git.
    ///
    /// For example: `"data/community-members/member-0123456789abcdef.json"`
    public var gitPath: String { "data/community-members/\(id).json" }

    /// Construction-time rejections enforcing the type-level sanitisation contract.
    public enum ValidationError: Error, Sendable {
        /// The id contained characters outside `[A-Za-z0-9_-]` — rejected so ``gitPath`` can
        /// never be steered outside `data/community-members/`.
        case invalidID(String)
        /// A URL destined for `href`/`src` carried a non-`http(s)` scheme (`javascript:`,
        /// `data:`, …).
        case insecureURL(URL)
    }

    /// `http`/`https` only — matches `AnnouncedPost.requireWebScheme` and `communityMembers.ts`'s
    /// `httpUrl` zod refinement exactly.
    private static func requireWebScheme(_ url: URL) throws {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw ValidationError.insecureURL(url)
        }
    }

    /// Validating initializer — the choke point for programmatic construction, enforcing the
    /// type-level sanitisation contract. Note the synthesized `Decodable` path does *not* run
    /// these checks; decoded files rely on the template's zod validation downstream.
    ///
    /// - Throws: ``ValidationError/invalidID(_:)`` when `id` strays outside `[A-Za-z0-9_-]+`, or
    ///   ``ValidationError/insecureURL(_:)`` when `actorURL` — or `photo` — isn't `http`/`https`.
    public init(id: String, actorURL: URL, name: String?, photo: URL?) throws {
        guard id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            throw ValidationError.invalidID(id)
        }
        try Self.requireWebScheme(actorURL)
        if let photo { try Self.requireWebScheme(photo) }
        self.id = id
        self.actorURL = actorURL
        self.name = name
        self.photo = photo
    }
}
