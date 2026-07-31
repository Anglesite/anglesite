import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SiteLanguageAsset (#956)")
struct SiteLanguageAssetTests {
    @Test("parses LANG out of .site-config")
    func parseSettings() {
        let settings = SiteLanguageAsset.parseSettings(from: "SITE_NAME=Acme\nLANG=fr-CA\n")
        #expect(settings == .init(lang: "fr-CA"))
    }

    @Test("an unset LANG falls back to en")
    func parseSettingsFallsBackToEnglish() {
        #expect(SiteLanguageAsset.parseSettings(from: "").lang == "en")
        #expect(SiteLanguageAsset.parseSettings(from: "SITE_NAME=Acme\n").lang == "en")
    }

    @Test("Settings.init rejects a blank tag in favor of the en fallback")
    func settingsInitRejectsBlank() {
        #expect(SiteLanguageAsset.Settings(lang: "").lang == "en")
        #expect(SiteLanguageAsset.Settings(lang: "   ").lang == "en")
    }

    @Test("install writes LANG and skips a no-op rewrite")
    func install() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try SiteLanguageAsset.install(.init(lang: "es"), siteDirectory: dir)
        let configURL = dir.appendingPathComponent(".site-config")
        let written = try String(contentsOf: configURL, encoding: .utf8)
        #expect(written.contains("LANG=es"))

        // Re-installing the same value must not touch the file's modification date — the write
        // is skipped outright when the upserted content is byte-identical.
        let before = try FileManager.default.attributesOfItem(atPath: configURL.path)[.modificationDate] as? Date
        try SiteLanguageAsset.install(.init(lang: "es"), siteDirectory: dir)
        let after = try FileManager.default.attributesOfItem(atPath: configURL.path)[.modificationDate] as? Date
        #expect(before == after)
    }

    @Test("hostLanguageTag reads a BCP 47 tag off the given locale")
    func hostLanguageTag() {
        #expect(SiteLanguageAsset.hostLanguageTag(locale: Locale(identifier: "fr_CA")) == "fr-CA")
        #expect(SiteLanguageAsset.hostLanguageTag(locale: Locale(identifier: "en_US")) == "en-US")
    }
}
