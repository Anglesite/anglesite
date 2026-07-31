import Foundation

/// The site-settings representation of the BCP 47 language tag `BaseLayout.astro` uses for
/// `<html lang>` (#956, WCAG 2.2 SC 3.1.1 "Language of Page").
///
/// Owns exactly one `.site-config` key — `LANG`. Unset (or blank) reads back as `"en"`, matching
/// the template's own `resolveLang` fallback in `scripts/config.ts`, so a site scaffolded before
/// this key existed still renders a valid (if incorrect-for-non-English-content) language.
public enum SiteLanguageAsset {
    /// The `.site-config` key this type owns.
    public static let configKey = "LANG"

    /// The editable value the Website Settings ▸ Website tab binds to.
    public struct Settings: Sendable, Equatable {
        /// A BCP 47 language tag, e.g. `"en"`, `"fr-CA"`, `"es"`. Never empty — construction and
        /// `parseSettings` both apply the `"en"` fallback.
        public var lang: String

        /// Defaults to `"en"`, matching a site with nothing configured.
        public init(lang: String = "en") {
            self.lang = lang.trimmingCharacters(in: .whitespaces).isEmpty ? "en" : lang
        }
    }

    /// Reads `LANG` out of a raw `.site-config` string, falling back to `"en"` when unset or
    /// blank — mirrors the template's `resolveLang` in `scripts/config.ts` so the app's settings
    /// UI and the built site never disagree about the effective language.
    public static func parseSettings(from config: String) -> Settings {
        Settings(lang: SiteConfigFile.value(forKey: configKey, in: config) ?? "en")
    }

    /// Upserts `LANG` into the site's `.site-config`. Skips the write when the result is
    /// byte-identical, so re-saving an untouched settings sheet never dirties the site's git
    /// working tree.
    public static func install(_ settings: Settings, siteDirectory: URL) throws {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([(configKey, settings.lang)], into: config)
        guard updated != config else { return }
        try updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// The host system's current language as a BCP 47 tag, e.g. `"en-US"` — the default a newly
    /// scaffolded site's `LANG` is stamped with (`SiteScaffolder`). Built from `languageCode` +
    /// `region` directly rather than `Locale.Language.minimalIdentifier`, which drops the region
    /// whenever it considers it redundant (e.g. "en_US" minimizes to just "en") — a real BCP 47
    /// tag, not the shortest unambiguous one, is what a screen reader or search engine expects in
    /// `<html lang>`. Falls back to `"en"` if the host locale has no language code at all
    /// (unexpected, but `Locale.Language.languageCode` is optional-returning API).
    public static func hostLanguageTag(locale: Locale = .current) -> String {
        let language = locale.language
        guard let code = language.languageCode?.identifier else { return "en" }
        guard let region = language.region?.identifier else { return code }
        return "\(code)-\(region)"
    }
}
