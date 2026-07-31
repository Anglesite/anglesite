import Foundation
import Testing
@testable import AnglesiteCore

@Suite("WebsiteAnalyticsAsset")
struct WebsiteAnalyticsAssetTests {
    private let layout = """
    <html>
      <head>
        <title>Acme</title>
      </head>
    </html>
    """

    @Test("apply inserts configured analytics before the closing head tag")
    func applyInsertsAnalyticsBlock() {
        let settings = WebsiteAnalyticsAsset.Settings(
            cloudflareToken: "cf-token",
            customHeadTag: #"<script async src="https://www.googletagmanager.com/gtag/js?id=G-1234567890"></script>"#
        )

        let patched = WebsiteAnalyticsAsset.apply(settings, to: layout)

        #expect(patched.contains("static.cloudflareinsights.com/beacon.min.js"))
        #expect(patched.contains("www.googletagmanager.com/gtag/js?id=G-1234567890"))
        #expect(patched.range(of: "<!-- anglesite:analytics-start -->")!.lowerBound <
                patched.range(of: "</head>")!.lowerBound)
    }

    @Test("apply replaces an existing managed analytics block")
    func applyReplacesManagedBlock() {
        let first = WebsiteAnalyticsAsset.apply(
            WebsiteAnalyticsAsset.Settings(cloudflareToken: "old"),
            to: layout
        )

        let second = WebsiteAnalyticsAsset.apply(
            WebsiteAnalyticsAsset.Settings(customHeadTag: #"<script src="https://example.com/new.js"></script>"#),
            to: first
        )

        #expect(!second.contains("old"))
        #expect(second.contains("https://example.com/new.js"))
        #expect(second.components(separatedBy: "<!-- anglesite:analytics-start -->").count == 2)
    }

    @Test("empty settings remove the managed analytics block")
    func applyRemovesBlock() {
        let withAnalytics = WebsiteAnalyticsAsset.apply(
            WebsiteAnalyticsAsset.Settings(cloudflareToken: "cf-token"),
            to: layout
        )

        let removed = WebsiteAnalyticsAsset.apply(WebsiteAnalyticsAsset.Settings(), to: withAnalytics)

        #expect(!removed.contains("anglesite:analytics"))
    }

    @Test("parseSettings reads managed analytics values")
    func parseSettings() {
        let settings = WebsiteAnalyticsAsset.Settings(
            cloudflareToken: "cf-token",
            customHeadTag: #"<meta name="x" content="y">"#
        )
        let source = WebsiteAnalyticsAsset.apply(settings, to: layout)

        #expect(WebsiteAnalyticsAsset.parseSettings(from: source) == settings)
    }

    @Test("Cloudflare beacon token is JSON encoded and round trips")
    func cloudflareBeaconTokenIsJSONEncoded() {
        let token = #"cf'token\with"quotes&chars"#
        let settings = WebsiteAnalyticsAsset.Settings(cloudflareToken: token)

        let source = WebsiteAnalyticsAsset.apply(settings, to: layout)

        #expect(source.contains(#"data-cf-beacon='{"token":"cf&#39;token\\with\"quotes&amp;chars"}'"#))
        #expect(WebsiteAnalyticsAsset.parseSettings(from: source).cloudflareToken == token)
    }

    @Test("install writes layout and adds custom script CSP domains")
    func installPatchesLayoutAndConfig() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let siteDir = root.appendingPathComponent("Source")
        let layoutDir = siteDir.appendingPathComponent("src/layouts")
        try fm.createDirectory(at: layoutDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        try layout.write(to: layoutDir.appendingPathComponent("BaseLayout.astro"), atomically: true, encoding: .utf8)
        try "SITE_NAME=Acme\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        try WebsiteAnalyticsAsset.install(
            WebsiteAnalyticsAsset.Settings(customHeadTag: #"<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234"></script>"#),
            siteDirectory: siteDir,
            fileManager: fm
        )

        let patched = try String(contentsOf: layoutDir.appendingPathComponent("BaseLayout.astro"), encoding: .utf8)
        let config = try String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(patched.contains("G-ABCDEF1234"))
        #expect(config.contains("www.googletagmanager.com"))
    }

    // The template's baseline CSP no longer pre-allows the beacon's origins (#1013), so
    // enabling the Cloudflare provider must widen SCRIPT_ALLOW itself — and disabling it
    // must narrow the policy back, or the unused width lingers for every future build.
    @Test("install adds Cloudflare CSP domains on enable and removes them on disable")
    func installTogglesCloudflareCSPDomains() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let siteDir = root.appendingPathComponent("Source")
        let layoutDir = siteDir.appendingPathComponent("src/layouts")
        try fm.createDirectory(at: layoutDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        try layout.write(to: layoutDir.appendingPathComponent("BaseLayout.astro"), atomically: true, encoding: .utf8)
        try "SCRIPT_ALLOW=existing.com\n".write(to: siteDir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)

        try WebsiteAnalyticsAsset.install(
            WebsiteAnalyticsAsset.Settings(cloudflareToken: "cf-token"),
            siteDirectory: siteDir,
            fileManager: fm
        )
        let enabled = try String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(enabled.contains("SCRIPT_ALLOW=existing.com,static.cloudflareinsights.com,cloudflareinsights.com"))

        try WebsiteAnalyticsAsset.install(
            WebsiteAnalyticsAsset.Settings(),
            siteDirectory: siteDir,
            fileManager: fm
        )
        let disabled = try String(contentsOf: siteDir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(disabled.contains("SCRIPT_ALLOW=existing.com\n"))
        #expect(!disabled.contains("cloudflareinsights"))
    }

    @Test("install rejects incomplete custom analytics HTML without changing the layout")
    func installRejectsIncompleteCustomHTML() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let siteDir = root.appendingPathComponent("Source")
        let layoutDir = siteDir.appendingPathComponent("src/layouts")
        let layoutURL = layoutDir.appendingPathComponent("BaseLayout.astro")
        try fm.createDirectory(at: layoutDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        try layout.write(to: layoutURL, atomically: true, encoding: .utf8)

        #expect(throws: WebsiteAnalyticsAsset.InstallError.self) {
            try WebsiteAnalyticsAsset.install(
                WebsiteAnalyticsAsset.Settings(customHeadTag: "<script></"),
                siteDirectory: siteDir,
                fileManager: fm
            )
        }

        let unchanged = try String(contentsOf: layoutURL, encoding: .utf8)
        #expect(unchanged == layout)
    }

    @Test("custom analytics validation accepts complete snippets and rejects broken snippets")
    func customAnalyticsValidation() {
        #expect(WebsiteAnalyticsAsset.customHeadTagValidationMessage("") == nil)
        #expect(WebsiteAnalyticsAsset.customHeadTagValidationMessage(#"<meta name="test" content="ok">"#) == nil)
        #expect(WebsiteAnalyticsAsset.customHeadTagValidationMessage("<script>window.test = true;</script>") == nil)
        #expect(WebsiteAnalyticsAsset.customHeadTagValidationMessage("<script></") != nil)
        #expect(WebsiteAnalyticsAsset.customHeadTagValidationMessage("<!-- unfinished") != nil)
    }

    @Test("bestHost prefers configured domains")
    func bestHost() {
        #expect(WebsiteAnalyticsAsset.bestHost(from: "SITE_DOMAIN=example.com\n", fallback: "fallback.pages.dev") == "example.com")
        #expect(WebsiteAnalyticsAsset.bestHost(from: "DOMAIN=example.org\n", fallback: "fallback.pages.dev") == "example.org")
        #expect(WebsiteAnalyticsAsset.bestHost(from: "", fallback: "fallback.pages.dev") == "fallback.pages.dev")
    }

    @Test("customScriptDomains extracts external script hosts")
    func customScriptDomains() {
        let html = #"<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script><script src='https://cdn.example.com/a.js'></script>"#
        #expect(WebsiteAnalyticsAsset.customScriptDomains(from: html) == ["cdn.example.com", "www.googletagmanager.com"])
    }
}
