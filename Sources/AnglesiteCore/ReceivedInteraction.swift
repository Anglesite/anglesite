// Sources/AnglesiteCore/ReceivedInteraction.swift
import Foundation

/// Schema for a received interaction snapshotted from the Worker's inbox store into `Source/` git.
///
/// This is the data contract between the Worker (D1 → JSON serialization) and the Astro template
/// (glob loader → render). One file per interaction at `Source/data/interactions/{id}.json`.
/// See `docs/specs/2026-06-29-c3-received-interaction-canonicality.md` for the full design.
///
/// **Sanitisation contract:** `id` is validated at construction time — only `[A-Za-z0-9_-]+`
/// is accepted — to prevent path-traversal through `gitPath`. `content` is stored as-is from
/// the Worker; the Astro template must sanitise it before rendering as HTML (e.g. use
/// `set:text` not `set:html`, or run through a sanitiser first).
public struct ReceivedInteraction: Codable, Sendable, Equatable, Identifiable {
    /// Protocol source of the interaction.
    public enum ProtocolType: String, Codable, Sendable, Equatable {
        /// Delivered to the site's Webmention endpoint (IndieWeb).
        case webmention
        /// Delivered via ActivityPub (fediverse) federation.
        case activitypub
        /// Created through the site's Micropub endpoint.
        case micropub
    }

    /// What kind of interaction this represents.
    public enum InteractionType: String, Codable, Sendable, Equatable {
        /// A comment on the target — the only kind that renders threaded (``isComment``).
        case reply
        /// A like/favourite of the target — rendered as a facepile avatar, not a comment.
        case like
        /// A reshare/boost of the target — rendered as a facepile avatar, not a comment.
        case repost
        /// The sender bookmarked the target.
        case bookmark
        /// The source page links to the target without any more specific relation.
        case mention

        /// Whether this interaction renders as a threaded comment.
        public var isComment: Bool { self == .reply }
        /// Whether this interaction renders as a facepile avatar.
        public var isFacepile: Bool { self == .like || self == .repost }
    }

    /// Verification state of the interaction.
    public enum VerificationStatus: String, Codable, Sendable, Equatable {
        /// The Worker fetched the source and confirmed it really links to the target.
        case verified
        /// Verification hasn't completed yet.
        case pending
        /// The source couldn't be verified — unreachable, or it no longer links to the target.
        case failed
    }

    /// Frozen point-in-time snapshot of the sender's identity at verification time.
    ///
    /// This is not live-updated — if the sender changes their name/photo, the old values
    /// persist in the snapshot. This is standard IndieWeb practice.
    public struct Author: Codable, Sendable, Equatable {
        /// Display name at verification time, if the source exposed one.
        public let name: String?
        /// The author's profile URL, if the source exposed one.
        public let url: URL?
        /// Avatar URL at verification time, if the source exposed one.
        public let photo: URL?

        /// Creates a snapshot. Every field is optional because sources routinely omit author
        /// metadata — a like from a bare URL is still a valid interaction.
        public init(name: String?, url: URL?, photo: URL?) {
            self.name = name
            self.url = url
            self.photo = photo
        }
    }

    /// Stable, unique ID assigned by the Worker (e.g. `wm-{hash}`, `ap-{hash}`).
    public let id: String
    /// Protocol source — webmention, activitypub, or micropub.
    public let type: ProtocolType
    /// The URL that sent the interaction.
    public let source: URL
    /// The URL on this site that received it.
    public let target: URL
    /// What kind of interaction this represents.
    public let interactionType: InteractionType
    /// Frozen point-in-time snapshot of the sender's identity (optional).
    public let author: Author?
    /// Text/HTML content of the interaction (optional, may be truncated to ~500 chars).
    /// Stored as-is from the Worker — callers must sanitise before rendering as raw HTML.
    public let content: String?
    /// When the source published the interaction (ISO 8601).
    public let published: Date
    /// When the Worker verified the interaction (ISO 8601).
    public let verified: Date
    /// Current verification state of the interaction.
    public let verificationStatus: VerificationStatus

    /// The relative path within `Source/` where this interaction is stored in git.
    ///
    /// For example: `"data/interactions/wm-abc123.json"`
    public var gitPath: String { "data/interactions/\(id).json" }

    /// Construction-time failures enforcing the type-level sanitisation contract.
    public enum ValidationError: Error, Sendable {
        /// The given `id` contains characters outside `[A-Za-z0-9_-]`, which could otherwise
        /// traverse paths through ``ReceivedInteraction/gitPath``.
        case invalidID(String)
    }

    /// Creates an interaction, validating `id` against `[A-Za-z0-9_-]+` first — the sanitisation
    /// contract that keeps ``gitPath`` path-traversal-safe (see the type-level doc).
    ///
    /// - Throws: ``ValidationError/invalidID(_:)`` when `id` contains any other character.
    public init(
        id: String,
        type: ProtocolType,
        source: URL,
        target: URL,
        interactionType: InteractionType,
        author: Author?,
        content: String?,
        published: Date,
        verified: Date,
        verificationStatus: VerificationStatus
    ) throws {
        guard id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            throw ValidationError.invalidID(id)
        }
        self.id = id
        self.type = type
        self.source = source
        self.target = target
        self.interactionType = interactionType
        self.author = author
        self.content = content
        self.published = published
        self.verified = verified
        self.verificationStatus = verificationStatus
    }
}
