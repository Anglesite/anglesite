import Testing
import Foundation
@testable import AnglesiteCore

struct UntitledSitePropagationTests {
    private func makeSiteDirectory(siteConfig: String, wranglerToml: String? = #"name = "untitled""#) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try! siteConfig.write(to: dir.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        if let wranglerToml {
            try! wranglerToml.write(to: dir.appendingPathComponent("wrangler.toml"), atomically: true, encoding: .utf8)
        }
        return dir
    }

    @Test("Propagates SITE_NAME, CF_PROJECT_NAME, and wrangler.toml name for a virgin untitled site")
    func propagatesForVirginUntitledSite() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nTAGLINE=hi\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
        #expect(SiteConfigFile.value(forKey: "TAGLINE", in: config) == "hi", "unrelated keys must survive")
        let toml = try String(contentsOf: dir.appendingPathComponent("wrangler.toml"), encoding: .utf8)
        #expect(toml.contains(#"name = "acme-bakery""#))
    }

    @Test("Matches the 'Untitled N' pattern the chooser generates for repeat untitled sites")
    func propagatesForNumberedUntitledSite() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled 3\nCF_PROJECT_NAME=untitled-3\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "My Blog", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "My Blog")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "my-blog")
    }

    @Test("Propagates a second pre-publish rename too, as long as CF_PROJECT_NAME still matches the previous name's derived slug")
    func propagatesSecondPrePublishRename() throws {
        // Simulates: scaffold as "Untitled" -> rename to "My Blog" (first propagation already
        // applied) -> rename again to "Dave's Blog", still before any deploy.
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=My Blog\nCF_PROJECT_NAME=my-blog\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Dave's Blog", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Dave's Blog")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "dave-s-blog")
    }

    @Test("No-ops when CF_WORKER_DEPLOYED is already set")
    func noOpWhenDeployed() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nCF_WORKER_DEPLOYED=true\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "untitled")
    }

    @Test("No-ops when CF_WORKER_PROVISIONED is already set")
    func noOpWhenProvisioned() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\nCF_WORKER_PROVISIONED=true\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
    }

    @Test("No-ops when CF_PROJECT_NAME was hand-customized away from the derived slug")
    func noOpWhenProjectNameCustomized() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=custom-project-name\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "custom-project-name")
    }

    @Test("No-ops gracefully when .site-config is missing")
    func noOpWhenSiteConfigMissing() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // Must not throw or crash.
        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)
    }

    @Test("Still updates .site-config when wrangler.toml is missing")
    func updatesSiteConfigWhenWranglerMissing() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\n", wranglerToml: nil)

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
    }

    @Test("Sanitizes an embedded newline in the new display name to its first line, without injecting extra .site-config keys")
    func sanitizesEmbeddedNewline() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "Acme Bakery\nEVIL_KEY=1", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Acme Bakery")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "acme-bakery")
        #expect(SiteConfigFile.value(forKey: "EVIL_KEY", in: config) == nil, "an embedded newline must not inject a new .site-config key")
    }

    @Test("No-ops when the sanitized display name is blank")
    func noOpWhenSanitizedNameIsBlank() throws {
        let dir = makeSiteDirectory(siteConfig: "SITE_NAME=Untitled\nCF_PROJECT_NAME=untitled\n")

        UntitledSitePropagation.propagateIfUntitled(newDisplayName: "\n  \n", siteDirectory: dir)

        let config = try String(contentsOf: dir.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(SiteConfigFile.value(forKey: "SITE_NAME", in: config) == "Untitled")
        #expect(SiteConfigFile.value(forKey: "CF_PROJECT_NAME", in: config) == "untitled")
    }
}
