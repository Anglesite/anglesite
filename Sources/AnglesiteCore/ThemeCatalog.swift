import Foundation

/// One built-in visual theme, decoded from `Resources/Template/scripts/themes.json`.
public struct Theme: Sendable, Identifiable, Equatable {
    /// Theme id, e.g. "warm" — the stable key persisted in settings and matched by
    /// `ThemeCatalog.theme(id:)`.
    public let id: String
    /// The JSON record's `displayName` — what the gallery shows.
    public let name: String
    /// The JSON record's `description` — one-line gallery copy, also reused as the brand
    /// summary when the theme is applied.
    public let blurb: String
    /// `[color-primary, color-accent]` for the gallery's color-chip preview (fewer entries if a
    /// theme omits one).
    public let swatch: [String]
    /// The record's `vars`: custom-property name (no leading `--`) → value, exactly what
    /// `ThemeApplier` rewrites into `global.css`.
    public let cssVars: [String: String]

    /// Attribution for a ported pack's original theme (spec §1); `nil` for built-ins.
    public struct Credit: Sendable, Equatable, Decodable {
        public let name: String
        public let url: String
        public let license: String
        public init(name: String, url: String, license: String) {
            self.name = name; self.url = url; self.license = license
        }
    }

    /// Chooser category (`business|personal|blog|portfolio|organization`); `nil` = Blank
    /// (the base chassis in different palettes — all 8 built-ins).
    public let category: String?
    /// Pack directory name under the template's `packs/`; `nil` = plain CSS-var theme.
    public let pack: String?
    /// Path (relative to the template root) of the committed thumbnail; pack entries only.
    public let thumbnail: String?
    /// Original-theme attribution; pack entries only.
    public let credit: Credit?

    /// Memberwise creation — normally themes come from ``ThemeCatalog/parse(themesJSON:)``, but
    /// tests build them directly.
    public init(id: String, name: String, blurb: String, swatch: [String], cssVars: [String: String],
                category: String? = nil, pack: String? = nil, thumbnail: String? = nil, credit: Credit? = nil) {
        self.id = id; self.name = name; self.blurb = blurb; self.swatch = swatch; self.cssVars = cssVars
        self.category = category; self.pack = pack; self.thumbnail = thumbnail; self.credit = credit
    }
}

/// The 8 built-in themes plus the wizard's default-by-site-type mapping.
public struct ThemeCatalog: Sendable {
    /// All themes in the shared JSON's order — order matters: the first entry is the fallback
    /// default (see ``defaultThemeID(for:)``).
    public let themes: [Theme]
    /// Wraps an already-decoded theme list; production loads via ``load(templateURL:)``.
    public init(themes: [Theme]) { self.themes = themes }

    /// The theme with the given id, or `nil` — lookup by id rather than index so persisted theme
    /// choices survive catalog reordering.
    public func theme(id: String) -> Theme? { themes.first { $0.id == id } }

    /// App-side default theme per broad site type. Falls back to the first available theme
    /// if the preferred id isn't present (keeps the drift guard meaningful).
    public func defaultThemeID(for type: SiteType) -> String {
        let preferred: [SiteType: String] = [
            .business: "classic", .personal: "elegant", .blog: "warm",
            .portfolio: "bold", .organization: "community", .blank: "classic",
        ]
        let want = preferred[type] ?? "classic"
        if theme(id: want) != nil { return want }
        return themes.first?.id ?? want
    }

    /// Load the bundled template's theme catalog. `templateURL` is the template root
    /// (`TemplateRuntime.resolve().url`); the data lives at scripts/themes.json — the same
    /// file the template's `scripts/themes.ts` imports, so both sides share one source of truth.
    public static func load(templateURL: URL) throws -> ThemeCatalog {
        let url = templateURL.appendingPathComponent("scripts/themes.json")
        return ThemeCatalog(themes: try parse(themesJSON: Data(contentsOf: url)))
    }

    /// The shared catalog is an ordered JSON array of theme records; decoding preserves
    /// the array order (the first entry is the fallback default theme).
    public static func parse(themesJSON data: Data) throws -> [Theme] {
        struct Record: Decodable {
            let id: String
            let displayName: String
            let description: String
            let bestFor: [String]
            let vars: [String: String]
            let category: String?
            let pack: String?
            let thumbnail: String?
            let credit: Theme.Credit?
        }
        return try JSONDecoder().decode([Record].self, from: data).map { record in
            Theme(
                id: record.id,
                name: record.displayName,
                blurb: record.description,
                swatch: ["color-primary", "color-accent"].compactMap { record.vars[$0] },
                cssVars: record.vars,
                category: record.category,
                pack: record.pack,
                thumbnail: record.thumbnail,
                credit: record.credit
            )
        }
    }
}
