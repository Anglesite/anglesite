// Sources/AnglesiteCore/AnnouncedPost.swift
import Foundation

/// Schema for a member post snapshotted from a hosted community's Worker outbox into `Source/`
/// git (V-5.2b, #908). FEP-1b12 is author-owns-post: the member's canonical copy stays on their
/// own site/actor; this is the community repo's snapshot of what the group announced to its
/// membership. Sibling schema to `ReceivedInteraction` (V-3.4, #362) — same id/author-snapshot
/// discipline — but the timeline *is* the page (not a comment thread) and the data always comes
/// from this site's own hosted Group actor, never a third party's D1/webmention inbox.
///
/// One file per announced post at `Source/data/community-posts/{id}.json`. See
/// `docs/superpowers/specs/2026-07-22-v5-communities-design.md` §4.3.
///
/// **Sanitisation contract:** `id` is validated at construction time — only `[A-Za-z0-9_-]+`
/// is accepted — to prevent path-traversal through `gitPath`. `content` is stored as-is from the
/// Worker; the Astro template must render it as text (e.g. `set:text`, never `set:html`).
///
/// **No verification-status field.** Unlike a webmention, a post only ever reaches this schema
/// after the Worker has already validated it came from a current member and wrapped it in a
/// Group-authored `Announce` (see `davidwkeith/workers` PR #401's "does not announce a
/// non-member's post") — there is no unverified/pending state this schema could ever hold.
public struct AnnouncedPost: Codable, Sendable, Equatable, Identifiable {
    /// AS2 object type of the wrapped post, per the Worker's own classification.
    public enum ObjectType: String, Codable, Sendable, Equatable {
        case note
        case article
        case page
        case video
        case event
    }

    /// Frozen point-in-time snapshot of the member's identity at announce time.
    ///
    /// Not live-updated — if the member later changes their name/photo, the old values persist
    /// in the snapshot, same as `ReceivedInteraction.Author`.
    public struct Author: Codable, Sendable, Equatable {
        public let name: String?
        public let url: URL?
        public let photo: URL?

        public init(name: String?, url: URL?, photo: URL?) {
            self.name = name
            self.url = url
            self.photo = photo
        }
    }

    /// Stable, unique ID assigned by the Worker for the wrapped post.
    public let id: String
    /// AS2 type of the wrapped post.
    public let objectType: ObjectType
    /// Canonical URL of the member's own post — their site remains authoritative (FEP-1b12).
    public let sourceURL: URL
    /// Frozen point-in-time snapshot of the member's identity (optional).
    public let author: Author?
    /// Text content of the post. Stored as-is from the Worker — callers must render as text, not
    /// raw HTML.
    public let content: String?
    /// When the member originally published the post (ISO 8601).
    public let published: Date
    /// When the group announced (fanned out) the post to its membership (ISO 8601).
    public let announcedAt: Date

    /// The relative path within `Source/` where this post is stored in git.
    ///
    /// For example: `"data/community-posts/ap-abc123.json"`
    public var gitPath: String { "data/community-posts/\(id).json" }

    public enum ValidationError: Error, Sendable {
        case invalidID(String)
    }

    public init(
        id: String,
        objectType: ObjectType,
        sourceURL: URL,
        author: Author?,
        content: String?,
        published: Date,
        announcedAt: Date
    ) throws {
        guard id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            throw ValidationError.invalidID(id)
        }
        self.id = id
        self.objectType = objectType
        self.sourceURL = sourceURL
        self.author = author
        self.content = content
        self.published = published
        self.announcedAt = announcedAt
    }
}
