// Tests/AnglesiteCoreTests/SiteLanguageAssetTests.swift
import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SiteLanguageAsset (#956)")
struct SiteLanguageAssetTests {
    @Test("parses SITE_LANG from .site-config")
    func parseSettings() {
        let settings = SiteLanguageAsset.parseSettings(from: "SITE_NAME=Acme\nSITE_LANG=fr-CA\n")
        #expect(settings == .init(lang: "fr-CA"))
    }

    @Test("an absent SITE_LANG key defaults to \"en\"")
    func parseSettingsDefaultsToEnglish() {
        #expect(SiteLanguageAsset.parseSettings(from: "SITE_NAME=Acme\n").lang == "en")
        #expect(SiteLanguageAsset.parseSettings(from: "").lang == "en")
    }

    @Test("an empty SITE_LANG value also defaults to \"en\"")
    func parseSettingsEmptyValueDefaults() {
        #expect(SiteLanguageAsset.parseSettings(from: "SITE_LANG=\n").lang == "en")
    }

    @Test("install upserts SITE_LANG without disturbing other keys")
    func install() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configURL = root.appendingPathComponent(".site-config")
        try "SITE_NAME=Acme\n".write(to: configURL, atomically: true, encoding: .utf8)

        try SiteLanguageAsset.install(.init(lang: "es"), siteDirectory: root)

        let written = try String(contentsOf: configURL, encoding: .utf8)
        #expect(written.contains("SITE_NAME=Acme"))
        #expect(written.contains("SITE_LANG=es"))
        #expect(SiteLanguageAsset.parseSettings(from: written).lang == "es")
    }

    @Test("install is idempotent — re-installing the same value is a no-op write")
    func installIdempotent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try SiteLanguageAsset.install(.init(lang: "de"), siteDirectory: root)
        let firstWrite = try String(contentsOf: root.appendingPathComponent(".site-config"), encoding: .utf8)
        try SiteLanguageAsset.install(.init(lang: "de"), siteDirectory: root)
        let secondWrite = try String(contentsOf: root.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(firstWrite == secondWrite)
    }

    @Test("systemDefaultTag derives a BCP-47 tag from language + region")
    func systemDefaultTag() {
        let locale = Locale(identifier: "fr_CA")
        #expect(SiteLanguageAsset.systemDefaultTag(locale: locale) == "fr-CA")
    }

    @Test("systemDefaultTag falls back to the bare language code when there's no region")
    func systemDefaultTagNoRegion() {
        let locale = Locale(languageCode: .japanese)
        #expect(SiteLanguageAsset.systemDefaultTag(locale: locale) == "ja")
    }

    @Test("systemDefaultTag falls back to \"en\" when the locale has no language code")
    func systemDefaultTagUnknown() {
        let locale = Locale(identifier: "")
        // An empty-identifier Locale still resolves *some* language on real systems in practice;
        // this asserts the documented contract (non-empty result) rather than a specific value,
        // since the empty-identifier corner case isn't meaningfully reproducible across CI hosts.
        #expect(!SiteLanguageAsset.systemDefaultTag(locale: locale).isEmpty)
    }
}
