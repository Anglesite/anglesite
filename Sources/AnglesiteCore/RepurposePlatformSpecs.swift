import Foundation

/// Per-platform constraints for repurposed posts — the repurpose skill's table as Swift data.
/// Char limits are enforced in Swift (spec §5.3), never trusted to the model.
public struct PlatformPostSpec: Sendable, Equatable {
    /// Display name of the platform, used verbatim in the chat reply and generation prompts.
    public let platform: String
    /// Hard character ceiling, enforced deterministically via ``RepurposePlatformSpecs/fits(_:spec:)``
    /// — an over-limit variant is rejected, not trimmed by the model.
    public let charLimit: Int
    /// Whether the post should end with the canonical post URL (Instagram strips links).
    public let includesURL: Bool
    /// Whether hashtags are idiomatic on this platform (they read as spam on Facebook/Nextdoor).
    public let allowsHashtags: Bool
    /// Free-form tone/format guidance fed into the generation prompt for this platform.
    public let styleHint: String

    /// Memberwise initializer — public so tests (and any future user-configurable platform list)
    /// can build specs beyond the built-in ``RepurposePlatformSpecs/all`` table.
    public init(platform: String, charLimit: Int, includesURL: Bool, allowsHashtags: Bool, styleHint: String) {
        self.platform = platform
        self.charLimit = charLimit
        self.includesURL = includesURL
        self.allowsHashtags = allowsHashtags
        self.styleHint = styleHint
    }
}

/// The built-in platform table the repurpose feature targets (#465). Kept as Swift data (not
/// model output or user config) so the char limits below are always the ones actually enforced.
public enum RepurposePlatformSpecs {
    /// Every platform a post is repurposed for, in the order variants appear in the chat reply.
    public static let all: [PlatformPostSpec] = [
        PlatformPostSpec(platform: "Instagram", charLimit: 2200, includesURL: false, allowsHashtags: true,
                         styleHint: "engaging caption; mention 'link in bio'; end with a handful of relevant hashtags"),
        PlatformPostSpec(platform: "Facebook", charLimit: 500, includesURL: true, allowsHashtags: false,
                         styleHint: "conversational, one short paragraph"),
        PlatformPostSpec(platform: "Google Business", charLimit: 1500, includesURL: true, allowsHashtags: false,
                         styleHint: "informative and action-oriented for local searchers"),
        PlatformPostSpec(platform: "Nextdoor", charLimit: 800, includesURL: true, allowsHashtags: false,
                         styleHint: "neighborly, local framing"),
        PlatformPostSpec(platform: "X", charLimit: 280, includesURL: true, allowsHashtags: true,
                         styleHint: "punchy single post"),
        PlatformPostSpec(platform: "Bluesky", charLimit: 300, includesURL: true, allowsHashtags: true,
                         styleHint: "punchy single post"),
    ]

    /// The deterministic length gate (spec §5.3): character count against ``PlatformPostSpec/charLimit``,
    /// in Swift, so a model that ignores its length instruction can't ship an over-limit post.
    public static func fits(_ text: String, spec: PlatformPostSpec) -> Bool {
        text.count <= spec.charLimit
    }
}
