import Foundation

/// The kind of site the owner is creating. The wizard collects only these five broad
/// categories; the plugin's fine-grained `bestFor` business types stay with the chat path.
public enum SiteType: String, Sendable, CaseIterable, Codable {
    /// The selectable categories, in the order the Type step lists them. `blank` is the
    /// deliberate escape hatch — a minimal scaffold for owners who don't fit the other four.
    case business, personal, blog, portfolio, organization, blank

    /// Owner-facing label for the Type step.
    public var label: String {
        switch self {
        case .business:     return "Business website"
        case .personal:     return "Personal website"
        case .blog:         return "Blog"
        case .portfolio:    return "Portfolio"
        case .organization: return "Organization website"
        case .blank:        return "Blank website"
        }
    }

    /// One-sentence explanation for the Type step.
    public var description: String {
        switch self {
        case .business:     return "Promote a company, service, or local shop."
        case .personal:     return "Create a home for your bio, links, and projects."
        case .blog:         return "Publish posts, articles, or updates over time."
        case .portfolio:    return "Showcase selected work, case studies, or creative projects."
        case .organization: return "Share a group mission, programs, events, and ways to get involved."
        case .blank:        return "Start with a simple empty website you can shape yourself."
        }
    }

    /// SF Symbol for the Type step row.
    public var symbol: String {
        switch self {
        case .business:     return "building.2"
        case .personal:     return "person.crop.circle"
        case .blog:         return "text.alignleft"
        case .portfolio:    return "square.grid.2x2"
        case .organization: return "person.3"
        case .blank:        return "doc"
        }
    }
}

/// How the owner wants to handle the public domain for the website.
public enum NewSiteDomainChoice: String, Sendable, CaseIterable, Codable {
    /// Buy a new domain — the wizard links out to Cloudflare Domains rather than embedding a
    /// purchase flow.
    case buy
    /// Connect a domain the owner already owns; the only choice that requires
    /// `NewSiteDraft.domain` to validate before the wizard can proceed.
    case transfer
    /// Defer the decision — the site deploys to a temporary Cloudflare Workers subdomain until
    /// a real domain is set up.
    case later
}

/// Reserved theme identifier used when the owner chooses their own colors in the wizard.
public enum CustomTheme {
    /// The sentinel `themeID` marking "owner-picked colors". Double-underscore prefixed so it
    /// can never collide with a real catalog theme id.
    public static let id = "__custom"
    /// Starting primary color for the custom picker (a blue), so the swatch never opens blank.
    public static let defaultPrimary = "#2563eb"
    /// Starting accent color for the custom picker (an amber), chosen to contrast the default
    /// primary.
    public static let defaultAccent = "#f59e0b"

    /// Builds a ``Theme`` from the owner's two picked colors, filling the remaining CSS
    /// variables with system-font defaults so the scaffolder can treat a custom choice exactly
    /// like a catalog theme.
    public static func make(primary: String, accent: String) -> Theme {
        Theme(
            id: id,
            name: "Custom",
            blurb: "Your own colors",
            swatch: [primary, accent],
            cssVars: [
                "color-primary": primary,
                "color-accent": accent,
                "font-heading": "system-ui, -apple-system, sans-serif",
                "font-body": "system-ui, -apple-system, sans-serif",
            ]
        )
    }
}

/// Everything the wizard collects before scaffolding. A plain value — no behavior.
public struct NewSiteDraft: Sendable, Equatable {
    /// The broad category chosen in the Type step; drives which template sections scaffold.
    public var siteType: SiteType
    /// The site's display name; also seeds ``headline`` and the derived folder slug.
    public var name: String
    /// How the owner wants to handle the public domain.
    public var domainChoice: NewSiteDomainChoice
    /// The owner's existing domain. Only meaningful (and only validated) when
    /// ``domainChoice`` is ``NewSiteDomainChoice/transfer``.
    public var domain: String
    /// Short site tagline shown under the name in the scaffolded header.
    public var tagline: String
    /// Where to create the `.anglesite` package. Nil until the owner picks a location
    /// (the default is `~/Sites/`).
    public var saveDirectory: URL?
    /// The package's file name on disk, captured from the save panel. When left empty the
    /// scaffolder derives it from ``name`` via ``SiteSlug``; a missing `.anglesite` suffix is
    /// appended either way.
    public var saveFileName: String
    /// The chosen catalog theme id, or ``CustomTheme/id`` when the owner picked their own
    /// colors. Empty until the Look step is visited.
    public var themeID: String
    /// The owner-picked primary color, kept even while a catalog theme is selected so
    /// switching back to Custom doesn't lose the choice.
    public var customPrimaryColor: String
    /// The owner-picked accent color; same retention rule as ``customPrimaryColor``.
    public var customAccentColor: String
    /// File URL of an optional logo image to copy into the scaffolded site's assets.
    public var logoURL: URL?
    /// The homepage headline; defaults to ``name`` at init so step 4 starts pre-filled.
    public var headline: String
    /// The homepage introductory paragraph.
    public var blurb: String
    /// The owner's free-text description for hero-image generation, folded into the
    /// ``HeroImage`` concepts alongside ``name``, ``siteType``, and ``tagline``.
    public var heroImagePrompt: String
    /// File URL of an optional hero image generated by Image Playground (#92). When set, the
    /// scaffolder copies it into the site's asset dir and references it from the homepage. Nil
    /// when the owner skipped generation or Apple Intelligence is unavailable.
    public var heroImageURL: URL?

    /// Creates a draft with everything but ``siteType`` and ``name`` defaulted, matching how
    /// the wizard starts: those two are the only values the first steps require. Passing
    /// `headline: nil` defaults it to `name` so step 4 starts pre-filled.
    public init(
        siteType: SiteType,
        name: String,
        domainChoice: NewSiteDomainChoice = .later,
        domain: String = "",
        tagline: String = "",
        saveDirectory: URL? = nil,
        saveFileName: String = "",
        themeID: String = "",
        customPrimaryColor: String = CustomTheme.defaultPrimary,
        customAccentColor: String = CustomTheme.defaultAccent,
        logoURL: URL? = nil,
        headline: String? = nil,
        blurb: String = "",
        heroImagePrompt: String = "",
        heroImageURL: URL? = nil
    ) {
        self.siteType = siteType
        self.name = name
        self.domainChoice = domainChoice
        self.domain = domain
        self.tagline = tagline
        self.saveDirectory = saveDirectory
        self.saveFileName = saveFileName
        self.themeID = themeID
        self.customPrimaryColor = customPrimaryColor
        self.customAccentColor = customAccentColor
        self.logoURL = logoURL
        // Default the homepage headline to the site name so step 4 starts pre-filled.
        self.headline = headline ?? name
        self.blurb = blurb
        self.heroImagePrompt = heroImagePrompt
        self.heroImageURL = heroImageURL
    }
}

/// Derives a filesystem-safe folder slug from a site name.
public enum SiteSlug {
    /// Lowercases, transliterates non-Latin characters to Latin, strips diacritics,
    /// and collapses any run of non-alphanumeric characters to a single hyphen.
    public static func derive(from name: String) -> String {
        let transliterated = name.applyingTransform(.toLatin, reverse: false) ?? name
        let folded = transliterated.folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US_POSIX"))
        var out = ""
        var lastWasHyphen = false
        for scalar in folded.lowercased().unicodeScalars {
            if (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9") {
                out.unicodeScalars.append(scalar)
                lastWasHyphen = false
            } else if !lastWasHyphen {
                out.append("-")
                lastWasHyphen = true
            }
        }
        let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? "untitled-site" : trimmed
    }
}
