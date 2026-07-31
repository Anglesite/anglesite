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
/// is accepted — to prevent path-traversal through `gitPath`. `sourceURL`/`author.url`/
/// `author.photo` are restricted to `http`/`https` schemes at construction time too — these flow
/// straight into `href`/`src` in `CommunityTimeline.astro`, so a `javascript:` (or other
/// non-web) scheme is rejected here rather than relying entirely on the template's zod
/// `httpUrl` refinement (`communityPosts.ts`) to catch it downstream. `content` is stored as-is
/// from the Worker; the Astro template must render it as text (e.g. `set:text`, never
/// `set:html`).
///
/// **No verification-status field.** Unlike a webmention, a post only ever reaches this schema
/// after the Worker has already validated it came from a current member and wrapped it in a
/// Group-authored `Announce` (see `davidwkeith/workers` PR #401's "does not announce a
/// non-member's post") — there is no unverified/pending state this schema could ever hold.
public struct AnnouncedPost: Codable, Sendable, Equatable, Identifiable {
    /// AS2 object type of the wrapped post, per the Worker's own classification.
    public enum ObjectType: String, Codable, Sendable, Equatable {
        /// AS2 `Note` — a short, microblog-style post.
        case note
        /// AS2 `Article` — long-form writing.
        case article
        /// AS2 `Page` — a standalone web page.
        case page
        /// AS2 `Video`.
        case video
        /// AS2 `Event`.
        case event
    }

    /// Frozen point-in-time snapshot of the member's identity at announce time.
    ///
    /// Not live-updated — if the member later changes their name/photo, the old values persist
    /// in the snapshot, same as `ReceivedInteraction.Author`.
    public struct Author: Codable, Sendable, Equatable {
        /// The member's display name at announce time.
        public let name: String?
        /// The member's own profile/site URL. Web-scheme-validated by the enclosing
        /// ``AnnouncedPost``'s initializer, because it flows into an `href`.
        public let url: URL?
        /// The member's avatar URL at announce time. Same web-scheme validation as ``url``, for
        /// the same reason (it flows into a `src`).
        public let photo: URL?

        /// Memberwise initializer. Deliberately non-throwing: the scheme checks live in
        /// ``AnnouncedPost``'s initializer, the single choke point every constructed post — with
        /// or without an author — must pass through.
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

    /// Construction-time rejections enforcing the type-level sanitisation contract.
    public enum ValidationError: Error, Sendable {
        /// The id contained characters outside `[A-Za-z0-9_-]` — rejected so ``gitPath`` can
        /// never be steered outside `data/community-posts/`.
        case invalidID(String)
        /// A URL destined for `href`/`src` carried a non-`http(s)` scheme (`javascript:`,
        /// `data:`, …).
        case insecureURL(URL)
    }

    /// `http`/`https` only — matches `communityPosts.ts`'s `httpUrl` zod refinement exactly.
    /// Anything else (`javascript:`, `data:`, a scheme-less string `URL` still parsed) is rejected
    /// rather than silently accepted and left for the template layer to catch.
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
    ///   ``ValidationError/insecureURL(_:)`` when `sourceURL` — or the author's `url`/`photo` —
    ///   isn't `http`/`https`.
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
        try Self.requireWebScheme(sourceURL)
        if let url = author?.url { try Self.requireWebScheme(url) }
        if let photo = author?.photo { try Self.requireWebScheme(photo) }
        self.id = id
        self.objectType = objectType
        self.sourceURL = sourceURL
        self.author = author
        self.content = content
        self.published = published
        self.announcedAt = announcedAt
    }
}
