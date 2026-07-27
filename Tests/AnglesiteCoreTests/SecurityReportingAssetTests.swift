import Foundation
import Testing
@testable import AnglesiteCore

@Suite("SecurityReportingAsset (#843)")
struct SecurityReportingAssetTests {
    private static let repo = RemoteRepo(
        url: URL(string: "https://github.com/acme/site")!, owner: "acme", name: "site")

    @Test("parses a comma-separated contact list into newline-separated UI text")
    func parseSettings() {
        let settings = SecurityReportingAsset.parseSettings(
            from: "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=https://example.com/report,s@example.com\n")
        #expect(settings == .init(contacts: "https://example.com/report\ns@example.com", mode: .generated))
    }

    @Test("an unset mode falls back to the template's inference rule")
    func parseSettingsInfersMode() {
        #expect(SecurityReportingAsset.parseSettings(from: "SECURITY_CONTACT=s@example.com\n").mode == .generated)
        #expect(SecurityReportingAsset.parseSettings(from: "").mode == .disabled)
        #expect(SecurityReportingAsset.parseSettings(from: "SECURITY_TXT_MODE=bogus\n").mode == .disabled)
    }

    @Test("normalizes shape only — trims, drops blanks, dedupes, keeps order and invalid entries")
    func normalizedContacts() {
        #expect(SecurityReportingAsset.normalizedContacts(" a@example.com \n\n b@example.com \n a@example.com ")
            == ["a@example.com", "b@example.com"])
        // Validity is the template's job: an http:// entry survives here and is reported by the build.
        #expect(SecurityReportingAsset.normalizedContacts("http://nope.example") == ["http://nope.example"])
        // A comma is a .site-config list separator, not a UI one — an entry may contain one.
        #expect(SecurityReportingAsset.normalizedContacts("https://example.com/r?ref=a,b")
            == ["https://example.com/r?ref=a,b"])
    }

    @Test("a comma inside one contact round-trips through the stored escape")
    func commaEscapeRoundTrip() {
        let entries = ["https://example.com/r?ref=a,b", "s@example.com"]
        let stored = SecurityReportingAsset.encodeStored(entries)
        #expect(stored == "https://example.com/r?ref=a%2Cb,s@example.com")
        #expect(SecurityReportingAsset.decodeStored(stored) == entries)
    }

    @Test("decodeStored leaves ordinary percent sequences alone")
    func decodeStoredIsNotAGeneralPercentDecode() {
        // A general percent-decode would corrupt this to "https://example.com/a b".
        #expect(SecurityReportingAsset.decodeStored("https://example.com/a%20b")
            == ["https://example.com/a%20b"])
    }

    @Test("a pre-escape single value round-trips byte-identically")
    func legacyValueRoundTrips() {
        #expect(SecurityReportingAsset.decodeStored("security@example.com") == ["security@example.com"])
        #expect(SecurityReportingAsset.encodeStored(["security@example.com"]) == "security@example.com")
    }

    @Test("derives the repo's private advisory form")
    func advisoryURL() {
        #expect(SecurityReportingAsset.advisoryURL(for: Self.repo)
            == URL(string: "https://github.com/acme/site/security/advisories/new"))
    }

    @Test("detects whether the advisory form is already a contact")
    func usesAdvisoryForm() {
        #expect(SecurityReportingAsset.usesAdvisoryForm(
            "https://github.com/acme/site/security/advisories/new\ns@example.com", repo: Self.repo))
        #expect(!SecurityReportingAsset.usesAdvisoryForm("s@example.com", repo: Self.repo))
        #expect(!SecurityReportingAsset.usesAdvisoryForm("", repo: Self.repo))
    }

    @Test("prepends the advisory form, preserving order and never duplicating it")
    func prependingAdvisoryForm() {
        #expect(SecurityReportingAsset.prependingAdvisoryForm("s@example.com\nt@example.com", repo: Self.repo)
            == "https://github.com/acme/site/security/advisories/new\ns@example.com\nt@example.com")
        #expect(SecurityReportingAsset.prependingAdvisoryForm("", repo: Self.repo)
            == "https://github.com/acme/site/security/advisories/new")
        let already = "https://github.com/acme/site/security/advisories/new\ns@example.com"
        #expect(SecurityReportingAsset.prependingAdvisoryForm(already, repo: Self.repo) == already)
    }

    @Test("install writes normalized settings while preserving unrelated config")
    func install() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try "SITE_NAME=Acme\n".write(to: root.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        try SecurityReportingAsset.install(
            .init(contacts: " https://example.com/report \n\n s@example.com ", mode: .generated), siteDirectory: root)

        let config = try String(contentsOf: root.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("SITE_NAME=Acme"))
        #expect(config.contains("SECURITY_TXT_MODE=generated"))
        #expect(config.contains("SECURITY_CONTACT=https://example.com/report,s@example.com"))
    }

    @Test("install leaves the file untouched when nothing changed")
    func installIsIdempotent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let configURL = root.appendingPathComponent(".site-config")
        try "SECURITY_TXT_MODE=generated\nSECURITY_CONTACT=s@example.com\n".write(to: configURL, atomically: true, encoding: .utf8)
        let before = try FileManager.default.attributesOfItem(atPath: configURL.path)[.modificationDate] as? Date

        try SecurityReportingAsset.install(.init(contacts: "s@example.com", mode: .generated), siteDirectory: root)

        let after = try FileManager.default.attributesOfItem(atPath: configURL.path)[.modificationDate] as? Date
        #expect(before == after)
    }
}
