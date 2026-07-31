import Foundation

/// Deterministic platform recommendation by business type — ported from the social-media
/// skill's business-type→platform table (v1: a representative subset; enriching from the SMB
/// guides is a tracked follow-up). Cadence is posts per week.
public struct SocialPlatformProfile: Sendable, Equatable {
    /// Display name of the platform — also the key ``SocialMediaPlan/bios`` and calendar entries
    /// join on.
    public let platform: String
    /// The platform's profile-bio character limit, enforced deterministically by the planner (one
    /// retry, then omit) rather than trusted to the model.
    public let bioCharLimit: Int
    /// Recommended posting cadence, stated as a fact in the week-generation prompt.
    public let postsPerWeek: Int
    /// One-line platform character note (audience/format), included in prompts so generated
    /// copy fits the platform's register.
    public let note: String

    /// Memberwise initializer — public mainly so tests and future catalog sources can build
    /// profiles beyond the built-in table.
    public init(platform: String, bioCharLimit: Int, postsPerWeek: Int, note: String) {
        self.platform = platform
        self.bioCharLimit = bioCharLimit
        self.postsPerWeek = postsPerWeek
        self.note = note
    }
}

/// The built-in business-type→platform lookup table (see ``SocialPlatformProfile`` for its
/// provenance). Deterministic on purpose: which platforms a business should be on is a
/// known-answer question, so it never goes through the model.
public enum SocialPlatformCatalog {
    static let instagram = SocialPlatformProfile(platform: "Instagram", bioCharLimit: 150, postsPerWeek: 4, note: "visual-first; photos and reels")
    static let facebook = SocialPlatformProfile(platform: "Facebook", bioCharLimit: 255, postsPerWeek: 3, note: "community updates and events")
    static let googleBusiness = SocialPlatformProfile(platform: "Google Business", bioCharLimit: 750, postsPerWeek: 2, note: "posts show in local search")
    static let nextdoor = SocialPlatformProfile(platform: "Nextdoor", bioCharLimit: 500, postsPerWeek: 1, note: "neighborhood word of mouth")
    static let bluesky = SocialPlatformProfile(platform: "Bluesky", bioCharLimit: 256, postsPerWeek: 3, note: "conversational, link-friendly")

    /// The recommended platform set for a business type (matched case-insensitively against the
    /// wizard's business-type identifiers). Unknown or `nil` types get the generic
    /// Facebook/Instagram/Google Business trio rather than an empty set — every owner gets a
    /// usable plan.
    public static func recommended(businessType: String?) -> [SocialPlatformProfile] {
        switch businessType?.lowercased() {
        case "restaurant", "cafe", "bakery", "food-truck":
            return [instagram, facebook, googleBusiness]
        case "trades", "landscaping", "cleaning", "handyman", "plumber", "electrician":
            return [facebook, nextdoor, googleBusiness]
        case "web-artist", "photographer", "designer", "artist", "studio":
            return [instagram, bluesky]
        case "retail", "boutique", "shop":
            return [instagram, facebook, googleBusiness]
        case "salon", "barber", "spa", "wellness":
            return [instagram, googleBusiness, facebook]
        default:
            return [facebook, instagram, googleBusiness]
        }
    }
}
