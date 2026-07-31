// Sources/AnglesiteCore/SiteLanguageAsset.swift
import Foundation

/// The site-wide default language, stored as `SITE_LANG` in `.site-config` (#956). This is
/// public site content (it must survive `git clone` and a plain `astro build` with Anglesite
/// never installed), so it lives in the git-tracked `.site-config`, not the app-owned
/// `Config/settings.plist` (`SiteConfigStore`) — see docs/superpowers/specs/2026-07-30-site-language-setting-design.md.
public enum SiteLanguageAsset {
    public struct Settings: Sendable, Equatable {
        /// A BCP-47 language tag (e.g. "en", "fr-CA"). Defaults to "en" when absent from
        /// `.site-config` — the same value the previously-hardcoded `<html lang="en">` produced.
        public var lang: String

        public init(lang: String = "en") {
            self.lang = lang
        }
    }

    public static func parseSettings(from config: String) -> Settings {
        let raw = SiteConfigFile.value(forKey: "SITE_LANG", in: config) ?? ""
        return Settings(lang: raw.isEmpty ? "en" : raw)
    }

    public static func install(_ settings: Settings, siteDirectory: URL) throws {
        let configURL = siteDirectory.appendingPathComponent(WebsiteAnalyticsAsset.configRelativePath)
        let config = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        let updated = SiteConfigFile.upsert([("SITE_LANG", settings.lang)], into: config)
        guard updated != config else { return }
        try updated.write(to: configURL, atomically: true, encoding: .utf8)
    }

    /// A BCP-47 tag derived from the host's locale (language + region when both are known),
    /// used only to seed a brand-new site's `SITE_LANG` at scaffold time (Task 3). Never called
    /// again after scaffold — the owner's explicit choice in Settings always wins.
    public static func systemDefaultTag(locale: Locale = .current) -> String {
        guard let languageCode = locale.language.languageCode?.identifier else { return "en" }
        if let region = locale.language.region?.identifier {
            return "\(languageCode)-\(region)"
        }
        return languageCode
    }
}
