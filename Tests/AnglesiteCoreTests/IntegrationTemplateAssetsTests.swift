// Tests/AnglesiteCoreTests/IntegrationTemplateAssetsTests.swift
// Hermetic test — no app bundle or TemplateRuntime needed.
// Resolves the template via AnglesiteTestSupport.templateRoot() (a #filePath
// walk-up to the repo root; see that helper for the PR #283 classic-URL-API note).
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite struct IntegrationTemplateAssetsTests {

    @Test func configHelperExists() throws {
        #expect(FileManager.default.fileExists(atPath: try templateRoot().appendingPathComponent("scripts/config.ts").path))
    }

    @Test func onDemandAssetsAreStagedNotInSrc() throws {
        let root = try templateRoot()
        // staged (copied on-demand):
        for p in ["integrations/components/BookingWidget.astro", "integrations/components/DonationButton.astro",
                  "integrations/components/Comments.astro", "integrations/components/ContactForm.astro",
                  "integrations/components/NewsletterForm.astro", "integrations/components/ConsentBanner.astro",
                  "integrations/components/InstallPrompt.astro",
                  "integrations/components/TrackingScript.astro", "integrations/components/ShareButtons.astro",
                  "integrations/components/PodcastPlayer.astro",
                  "integrations/components/Nav.astro",
                  "integrations/components/BuyButton.astro", "integrations/components/LemonSqueezyButton.astro",
                  "integrations/components/PaddleCheckout.astro", "integrations/components/SnipcartButton.astro",
                  "integrations/components/ShopifyBuyButton.astro",
                  "integrations/pages/book.astro", "integrations/pages/donate.astro", "integrations/pages/contact.astro",
                  "integrations/pages/subscribe.astro", "integrations/pages/subscribe/thanks.astro",
                  "integrations/pages/manifest.webmanifest.ts", "integrations/pages/offline.astro",
                  "integrations/pages/podcast.astro",
                  "integrations/pages/buy.astro", "integrations/pages/shop.astro", "integrations/pages/pricing.astro",
                  "integrations/pages/store.astro", "integrations/pages/products.astro",
                  "integrations/pages/members.astro", "integrations/components/MemberCard.astro",
                  "integrations/public/sw.js", "integrations/public/carbon.txt",
                  "integrations/worker/subscribe-worker.js", "integrations/worker/subscribe-wrangler.toml",
                  "integrations/docs/newsletter-setup.md", "integrations/docs/pwa-setup.md",
                  "integrations/docs/inbox-setup.md"] {
            #expect(FileManager.default.fileExists(atPath: root.appendingPathComponent(p).path), "missing staged \(p)")
        }
        // NOT base-scaffolded: every staged asset must be absent from src/ (covers all five —
        // both components previously omitted, DonationButton and Comments, are now checked).
        for p in ["src/components/BookingWidget.astro", "src/components/DonationButton.astro",
                  "src/components/Comments.astro", "src/components/ContactForm.astro",
                  "src/components/NewsletterForm.astro", "src/components/ConsentBanner.astro",
                  "src/components/InstallPrompt.astro",
                  "src/components/TrackingScript.astro", "src/components/ShareButtons.astro",
                  "src/components/PodcastPlayer.astro",
                  "src/components/Nav.astro",
                  "src/components/BuyButton.astro", "src/components/LemonSqueezyButton.astro",
                  "src/components/PaddleCheckout.astro", "src/components/SnipcartButton.astro",
                  "src/components/ShopifyBuyButton.astro",
                  "src/pages/book.astro", "src/pages/donate.astro", "src/pages/contact.astro",
                  "src/pages/subscribe.astro", "src/pages/subscribe/thanks.astro",
                  "src/pages/manifest.webmanifest.ts", "src/pages/offline.astro", "public/sw.js",
                  "src/pages/podcast.astro",
                  "src/pages/buy.astro", "src/pages/shop.astro", "src/pages/pricing.astro",
                  "src/pages/store.astro", "src/pages/products.astro",
                  "src/pages/members.astro", "src/components/MemberCard.astro",
                  "public/carbon.txt", "worker/subscribe-worker.js", "worker/subscribe-wrangler.toml",
                  "docs/newsletter-setup.md", "docs/pwa-setup.md", "docs/inbox-setup.md"] {
            #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(p).path), "should be staged, not in src: \(p)")
        }
    }

    @Test func carbonTxtRendersFromShippedTemplate() throws {
        let source = FileManager.default.temporaryDirectory
            .appendingPathComponent("CarbonTxtTemplateAssetsTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: source) }

        let descriptor = IntegrationCatalog.descriptor(for: .carbonTxt)
        let cases: [([String: String], String)] = [
            (
                ["provenanceURL": "https://www.cloudflare.com/sustainability/"],
                """
                version = "0.5"

                # Hosting provider: Cloudflare
                [org]
                disclosures = [
                  { doc_type = "web-page", url = "https://www.cloudflare.com/sustainability/", title = "Cloudflare sustainability source" },
                ]

                [upstream]
                services = [
                  { domain = "cloudflare.com", service_type = "shared-hosting" },
                ]
                """
            ),
            (
                [
                    "provenanceURL": "https://www.cloudflare.com/sustainability/",
                    "disclosureURL": "https://example.com/sustainability",
                ],
                """
                version = "0.5"

                # Hosting provider: Cloudflare
                [org]
                disclosures = [
                  { doc_type = "web-page", url = "https://www.cloudflare.com/sustainability/", title = "Cloudflare sustainability source" },
                  { doc_type = "web-page", url = "https://example.com/sustainability", title = "Organisation sustainability disclosure" },
                ]

                [upstream]
                services = [
                  { domain = "cloudflare.com", service_type = "shared-hosting" },
                ]
                """
            ),
        ]

        for (answers, expected) in cases {
            let plan = try IntegrationPlanner.plan(
                descriptor: descriptor,
                answers: answers,
                sourceDirectory: source,
                templateDirectory: try templateRoot()
            ).get()
            guard case .createFile(let path, let contents) = plan.steps.first else {
                Issue.record("expected carbon.txt create step")
                return
            }
            #expect(path == "public/carbon.txt")
            // Exact complete TOML output catches syntax, delimiter, and optional-section drift in
            // the shipped asset rather than only exercising a miniature fixture.
            #expect(contents == expected + "\n")
        }
    }

    @Test func layoutsHaveImportAndBodyAnchors() throws {
        let root = try templateRoot()
        let base = try String(contentsOf: root.appendingPathComponent("src/layouts/BaseLayout.astro"), encoding: .utf8)
        #expect(base.contains("// anglesite:imports"))
        #expect(base.contains("<!-- anglesite:nav -->"))
        #expect(base.contains("<!-- anglesite:body-end -->"))
        #expect(base.contains("<!-- anglesite:head-end -->"))
        let blog = try String(contentsOf: root.appendingPathComponent("src/layouts/BlogPost.astro"), encoding: .utf8)
        #expect(blog.contains("// anglesite:imports"))
        #expect(blog.contains("<!-- anglesite:share -->"))
        #expect(blog.contains("<!-- anglesite:comments -->"))
    }

    @Test func homepageHasImportAndHeroAnchors() throws {
        let root = try templateRoot()
        let index = try String(contentsOf: root.appendingPathComponent("src/pages/index.astro"), encoding: .utf8)
        #expect(index.contains("// anglesite:imports"))
        #expect(index.contains("<!-- anglesite:hero-cta -->"))
    }

    @Test func onDemandPagesUseReadConfigNotImportMetaEnv() throws {
        let root = try templateRoot()
        for p in ["integrations/pages/book.astro", "integrations/pages/donate.astro", "integrations/pages/contact.astro",
                  "integrations/pages/subscribe.astro", "integrations/pages/offline.astro",
                  "integrations/pages/manifest.webmanifest.ts"] {
            let s = try String(contentsOf: root.appendingPathComponent(p), encoding: .utf8)
            #expect(s.contains("readConfig("), "\(p) should use readConfig")
            #expect(!s.contains("import.meta.env"), "\(p) must not use import.meta.env")
        }
    }

    @Test func scaffoldExcludesIntegrationsDir() throws {
        let s = try String(contentsOf: try templateRoot().appendingPathComponent("scripts/scaffold.sh"), encoding: .utf8)
        #expect(s.contains("--exclude='integrations/'"))
    }

    // Collect all .writeConfig ConfigEntry keys from a descriptor's operations.
    private func writtenConfigKeys(for descriptor: IntegrationDescriptor) -> Set<String> {
        var keys = Set<String>()
        for op in descriptor.operations {
            if case .writeConfig(let entries, _) = op {
                for entry in entries { keys.insert(entry.key) }
            }
        }
        return keys
    }

    // Extract all readConfig("KEY") tokens from an Astro file.
    private func readConfigKeysReferenced(in source: String) -> Set<String> {
        var keys = Set<String>()
        // Match readConfig("SOME_KEY") or readConfig('SOME_KEY')
        let pattern = #"readConfig\(["']([A-Z][A-Z0-9_]*)["']\)"#
        let regex = try! NSRegularExpression(pattern: pattern)
        let range = NSRange(source.startIndex..., in: source)
        for match in regex.matches(in: source, range: range) {
            if let keyRange = Range(match.range(at: 1), in: source) {
                keys.insert(String(source[keyRange]))
            }
        }
        return keys
    }

    @Test func scaffoldDoesNotExcludeConfigTs() throws {
        let s = try String(contentsOf: try templateRoot().appendingPathComponent("scripts/scaffold.sh"), encoding: .utf8)
        // config.ts must ship to scaffolded sites — ensure it's not excluded.
        #expect(!s.contains("config.ts"), "scaffold.sh must not exclude config.ts")
        // The only excludes should be the known set.
        let allowedExcludes = ["scaffold.sh", "themes.ts", "themes.json", "packs/", "check-pack.ts", "build-packs.sh", "*.test.ts", "node_modules", ".DS_Store", "integrations"]
        let excludeLines = s.components(separatedBy: "\n").filter { $0.contains("--exclude=") }
        for line in excludeLines {
            #expect(allowedExcludes.contains { line.contains($0) }, "unexpected exclude in scaffold.sh: \(line)")
        }
    }

    @Test func astroConfigRegistersRedirectsIntegration() throws {
        let configURL = try templateRoot().appendingPathComponent("astro.config.ts")
        let source = try String(contentsOf: configURL, encoding: .utf8)
        #expect(source.contains("import redirects from \"./scripts/redirects.ts\""))
        #expect(source.contains("redirects()"))
    }

    /// Guard test: config keys referenced by each integration page must be a subset of the
    /// keys that its descriptor writes via .writeConfig operations.
    /// This catches mismatches like DONATIONS_LABEL (page) vs DONATIONS_BUTTON_TEXT (descriptor).
    @Test func pageEnvKeysAreWrittenByDescriptors() throws {
        let root = try templateRoot()

        // Booking: integrations/pages/book.astro
        let bookURL = root.appendingPathComponent("integrations/pages/book.astro")
        let bookSource = try String(contentsOf: bookURL, encoding: .utf8)
        let bookReferenced = readConfigKeysReferenced(in: bookSource)
        let bookWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .booking))
        let bookUnknown = bookReferenced.subtracting(bookWritten)
        #expect(bookUnknown.isEmpty,
            "book.astro references config keys not written by booking descriptor: \(bookUnknown.sorted())")

        // Donations: integrations/pages/donate.astro
        let donateURL = root.appendingPathComponent("integrations/pages/donate.astro")
        let donateSource = try String(contentsOf: donateURL, encoding: .utf8)
        let donateReferenced = readConfigKeysReferenced(in: donateSource)
        let donateWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .donations))
        let donateUnknown = donateReferenced.subtracting(donateWritten)
        #expect(donateUnknown.isEmpty,
            "donate.astro references config keys not written by donations descriptor: \(donateUnknown.sorted())")

        // Contact: integrations/pages/contact.astro
        let contactURL = root.appendingPathComponent("integrations/pages/contact.astro")
        let contactSource = try String(contentsOf: contactURL, encoding: .utf8)
        let contactReferenced = readConfigKeysReferenced(in: contactSource)
        let contactWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .contact))
        let contactUnknown = contactReferenced.subtracting(contactWritten)
        #expect(contactUnknown.isEmpty,
            "contact.astro references config keys not written by contact descriptor: \(contactUnknown.sorted())")

        // Newsletter: integrations/pages/subscribe.astro
        let subscribeURL = root.appendingPathComponent("integrations/pages/subscribe.astro")
        let subscribeSource = try String(contentsOf: subscribeURL, encoding: .utf8)
        let subscribeReferenced = readConfigKeysReferenced(in: subscribeSource)
        let subscribeWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .newsletter))
        let subscribeUnknown = subscribeReferenced.subtracting(subscribeWritten)
        #expect(subscribeUnknown.isEmpty,
            "subscribe.astro references config keys not written by newsletter descriptor: \(subscribeUnknown.sorted())")

        // PWA: integrations/pages/offline.astro and manifest.webmanifest.ts
        let pwaWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .pwa))
        for p in ["integrations/pages/offline.astro", "integrations/pages/manifest.webmanifest.ts"] {
            let source = try String(contentsOf: root.appendingPathComponent(p), encoding: .utf8)
            let referenced = readConfigKeysReferenced(in: source)
            let unknown = referenced.subtracting(pwaWritten)
            #expect(unknown.isEmpty, "\(p) references config keys not written by pwa descriptor: \(unknown.sorted())")
        }

        // Buy button: integrations/pages/buy.astro
        let buyURL = root.appendingPathComponent("integrations/pages/buy.astro")
        let buySource = try String(contentsOf: buyURL, encoding: .utf8)
        let buyReferenced = readConfigKeysReferenced(in: buySource)
        let buyWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .buyButton))
        let buyUnknown = buyReferenced.subtracting(buyWritten)
        #expect(buyUnknown.isEmpty,
            "buy.astro references config keys not written by buyButton descriptor: \(buyUnknown.sorted())")

        // Lemon Squeezy: integrations/pages/shop.astro
        let shopURL = root.appendingPathComponent("integrations/pages/shop.astro")
        let shopSource = try String(contentsOf: shopURL, encoding: .utf8)
        let shopReferenced = readConfigKeysReferenced(in: shopSource)
        let shopWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .lemonSqueezy))
        let shopUnknown = shopReferenced.subtracting(shopWritten)
        #expect(shopUnknown.isEmpty,
            "shop.astro references config keys not written by lemonSqueezy descriptor: \(shopUnknown.sorted())")

        // Paddle: integrations/pages/pricing.astro
        let pricingURL = root.appendingPathComponent("integrations/pages/pricing.astro")
        let pricingSource = try String(contentsOf: pricingURL, encoding: .utf8)
        let pricingReferenced = readConfigKeysReferenced(in: pricingSource)
        let pricingWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .paddle))
        let pricingUnknown = pricingReferenced.subtracting(pricingWritten)
        #expect(pricingUnknown.isEmpty,
            "pricing.astro references config keys not written by paddle descriptor: \(pricingUnknown.sorted())")

        // Shopify Buy Button: integrations/pages/products.astro
        let productsURL = root.appendingPathComponent("integrations/pages/products.astro")
        let productsSource = try String(contentsOf: productsURL, encoding: .utf8)
        let productsReferenced = readConfigKeysReferenced(in: productsSource)
        let productsWritten = writtenConfigKeys(for: IntegrationCatalog.descriptor(for: .shopifyBuyButton))
        let productsUnknown = productsReferenced.subtracting(productsWritten)
        #expect(productsUnknown.isEmpty,
            "products.astro references config keys not written by shopifyBuyButton descriptor: \(productsUnknown.sorted())")
    }
}
