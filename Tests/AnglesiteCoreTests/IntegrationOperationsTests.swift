// Tests/AnglesiteCoreTests/IntegrationOperationsTests.swift
import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct IntegrationOperationsTests {
    func makeTemplate() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tmpl-\(UUID().uuidString)")
        // Task 3 moved integration components to the on-demand staging area integrations/components/.
        for p in ["integrations/components/Comments.astro"] {
            let url = root.appendingPathComponent(p)
            try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try! "C".write(to: url, atomically: true, encoding: .utf8)
        }
        return root
    }

    func makeSource(withBlogLayout: Bool) -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("src-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: root.appendingPathComponent("src/layouts"), withIntermediateDirectories: true)
        if withBlogLayout {
            // Layout carries both anchors: the frontmatter import anchor (line-style) and the
            // body render anchor (html-style). Giscus does a dual inject: imports first, then
            // the <Comments /> render tag.
            try! "---\n// anglesite:imports\n---\n<article><slot/><!-- anglesite:comments --></article>\n"
                .write(to: root.appendingPathComponent("src/layouts/BlogPost.astro"), atomically: true, encoding: .utf8)
        }
        return root
    }

    @Test func descriptorsExposesCatalog() {
        let ops = IntegrationOperations(sourceDirectory: { _ in nil }, templateDirectory: { nil })
        #expect(ops.descriptors().count == IntegrationCatalog.all.count)
    }

    @Test func planThenApplySucceedsForGiscus() async {
        let src = makeSource(withBlogLayout: true)
        let tmpl = makeTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["repo": "o/r", "repoId": "R", "category": "General", "categoryId": "C", "mapping": "pathname"]
        guard case .success(let plan) = await ops.plan(integrationID: .giscus, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "giscus"))
        let layout = try! String(contentsOf: src.appendingPathComponent("src/layouts/BlogPost.astro"), encoding: .utf8)
        #expect(layout.contains("<Comments"))
    }

    @Test func planFailsWhenSiteNotFound() async {
        let ops = IntegrationOperations(sourceDirectory: { _ in nil }, templateDirectory: { self.makeTemplate() })
        let r = await ops.plan(integrationID: .giscus, answers: [:], siteID: "missing")
        #expect(r == .failure(.siteNotFound))
    }

    func makeBookingTemplate() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tmpl-booking-\(UUID().uuidString)")
        for p in ["integrations/components/BookingWidget.astro", "integrations/pages/book.astro"] {
            let url = root.appendingPathComponent(p)
            try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try! "W".write(to: url, atomically: true, encoding: .utf8)
        }
        return root
    }

    func makeBookingSource() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("src-booking-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: root.appendingPathComponent("src/layouts"), withIntermediateDirectories: true)
        try! "---\n// anglesite:imports\n---\n<body><slot/><!-- anglesite:body-end --></body>\n"
            .write(to: root.appendingPathComponent("src/layouts/BaseLayout.astro"), atomically: true, encoding: .utf8)
        return root
    }

    @Test func planThenApplySucceedsForBookingFloating() async {
        let src = makeBookingSource()
        let tmpl = makeBookingTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["provider": "cal", "username": "jane", "style": "floating"]
        guard case .success(let plan) = await ops.plan(integrationID: .booking, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "booking"))
        let layout = try! String(contentsOf: src.appendingPathComponent("src/layouts/BaseLayout.astro"), encoding: .utf8)
        #expect(layout.contains("// anglesite:booking-imports:start"))
        #expect(layout.contains("<!-- anglesite:booking-body-end:start -->"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/BookingWidget.astro").path))
        #expect(!FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/book.astro").path))
    }

    @Test func planThenApplySucceedsForBookingInline() async {
        let src = makeBookingSource()
        let tmpl = makeBookingTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["provider": "cal", "username": "jane", "style": "inline"]
        guard case .success(let plan) = await ops.plan(integrationID: .booking, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "booking"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/book.astro").path))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/BookingWidget.astro").path))
    }

    func makeContactTemplate() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tmpl-contact-\(UUID().uuidString)")
        for p in ["integrations/components/ContactForm.astro", "integrations/pages/contact.astro"] {
            let url = root.appendingPathComponent(p)
            try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try! "F".write(to: url, atomically: true, encoding: .utf8)
        }
        return root
    }

    @Test func planThenApplySucceedsForContactFormspree() async {
        let src = makeBookingSource()
        let tmpl = makeContactTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["provider": "formspree", "formEndpoint": "https://formspree.io/f/xyz"]
        guard case .success(let plan) = await ops.plan(integrationID: .contact, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "contact"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/contact.astro").path))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/ContactForm.astro").path))
    }

    @Test func planThenApplySucceedsForContactMailto() async {
        let src = makeBookingSource()
        let tmpl = makeContactTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["provider": "mailto", "email": "hello@example.com"]
        guard case .success(let plan) = await ops.plan(integrationID: .contact, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "contact"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/contact.astro").path))
    }

    @Test func contactMissingProviderFails() async {
        let ops = IntegrationOperations(sourceDirectory: { _ in self.makeBookingSource() }, templateDirectory: { self.makeContactTemplate() })
        let r = await ops.plan(integrationID: .contact, answers: [:], siteID: "s1")
        #expect(r == .failure(.providerRequired))
    }

    func makeNewsletterTemplate() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tmpl-newsletter-\(UUID().uuidString)")
        for p in ["integrations/components/NewsletterForm.astro", "integrations/pages/subscribe.astro",
                  "integrations/pages/subscribe/thanks.astro", "integrations/worker/subscribe-worker.js",
                  "integrations/worker/subscribe-wrangler.toml", "integrations/docs/newsletter-setup.md"] {
            let url = root.appendingPathComponent(p)
            try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try! "N".write(to: url, atomically: true, encoding: .utf8)
        }
        return root
    }

    @Test func planThenApplySucceedsForNewsletter() async {
        let src = makeBookingSource()
        let tmpl = makeNewsletterTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["provider": "buttondown", "workerUrl": "https://newsletter-subscribe.jane.workers.dev"]
        guard case .success(let plan) = await ops.plan(integrationID: .newsletter, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "newsletter"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/subscribe.astro").path))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/subscribe/thanks.astro").path))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/NewsletterForm.astro").path))
    }

    /// The Worker's host is per-site, so it must land in `.site-config`'s SCRIPT_ALLOW via the
    /// workerUrl field, not a static provider domain (see #462 batch-2 CSP field-derivation).
    @Test func newsletterAddsWorkerHostToCSPConfig() async {
        let src = makeBookingSource()
        let tmpl = makeNewsletterTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["provider": "mailchimp", "workerUrl": "https://newsletter-subscribe.jane.workers.dev/subscribe"]
        guard case .success(let plan) = await ops.plan(integrationID: .newsletter, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        _ = await ops.apply(plan, siteID: "s1")
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("newsletter-subscribe.jane.workers.dev"))
    }

    @Test func newsletterMissingWorkerUrlFails() async {
        let ops = IntegrationOperations(sourceDirectory: { _ in self.makeBookingSource() }, templateDirectory: { self.makeNewsletterTemplate() })
        let r = await ops.plan(integrationID: .newsletter, answers: ["provider": "buttondown"], siteID: "s1")
        #expect(r == .failure(.missingRequiredField(key: "workerUrl")))
    }

    struct FakeGreenHostChecker: GreenHostChecking {
        let result: Result<GreenHostCheckResult, GreenHostCheckError>
        func check(hostname: String) async -> Result<GreenHostCheckResult, GreenHostCheckError> { result }
    }

    func makeGreenHostCheckTemplate() -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tmpl-green-\(UUID().uuidString)")
        let url = root.appendingPathComponent("integrations/components/GreenHostBadge.astro")
        try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try! "BADGE".write(to: url, atomically: true, encoding: .utf8)
        return root
    }

    /// A deployed site (`.site-config` carries `SITE_URL`) with a green host: the badge is
    /// scaffolded, GREEN_HOST_VERIFIED=true is written, and no "not green" warning is added.
    @Test func planThenApplySucceedsForGreenHostCheckWhenGreen() async {
        let src = makeBookingSource()
        try! "SITE_URL=https://example.workers.dev\n".write(
            to: src.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let tmpl = makeGreenHostCheckTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl },
                                        greenHostChecker: FakeGreenHostChecker(result: .success(.green)))
        guard case .success(let plan) = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        #expect(plan.warnings.isEmpty)
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "greenHostCheck"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/GreenHostBadge.astro").path))
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("GREEN_HOST_VERIFIED=true"))
        #expect(config.contains("GREEN_HOST_NAME=example.workers.dev"))
    }

    /// A not-green result still succeeds (it's a valid, informative outcome, not a plan failure)
    /// but writes GREEN_HOST_VERIFIED=false and surfaces an explanatory warning — issue #684 point 3.
    @Test func planSucceedsWithWarningForGreenHostCheckWhenNotGreen() async {
        let src = makeBookingSource()
        try! "SITE_URL=https://example.workers.dev\n".write(
            to: src.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let tmpl = makeGreenHostCheckTemplate()
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl },
                                        greenHostChecker: FakeGreenHostChecker(result: .success(.notGreen)))
        guard case .success(let plan) = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        #expect(!plan.warnings.isEmpty)
        #expect(plan.warnings.first?.message.contains("example.workers.dev") == true)
        _ = await ops.apply(plan, siteID: "s1")
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("GREEN_HOST_VERIFIED=false"))
    }

    /// A network failure during the check must surface as a distinct, retryable plan error — not
    /// be silently treated as "not green" (issue #684's explicit requirement 5).
    @Test func planFailsDistinctlyOnGreenHostCheckNetworkFailure() async {
        let src = makeBookingSource()
        try! "SITE_URL=https://example.workers.dev\n".write(
            to: src.appendingPathComponent(".site-config"), atomically: true, encoding: .utf8)
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { self.makeGreenHostCheckTemplate() },
                                        greenHostChecker: FakeGreenHostChecker(result: .failure(.network)))
        let r = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1")
        guard case .failure(.externalCheckFailed) = r else {
            Issue.record("expected .externalCheckFailed, got \(r)"); return
        }
    }

    /// No deploy host known yet (no SITE_URL/DOMAIN in `.site-config`) is a distinct precondition
    /// failure, not a network failure — there's nothing to query yet.
    @Test func planFailsWhenNoDeployHostKnownForGreenHostCheck() async {
        let ops = IntegrationOperations(sourceDirectory: { _ in self.makeBookingSource() },
                                        templateDirectory: { self.makeGreenHostCheckTemplate() },
                                        greenHostChecker: FakeGreenHostChecker(result: .success(.green)))
        let r = await ops.plan(integrationID: .greenHostCheck, answers: [:], siteID: "s1")
        #expect(r == .failure(.deployRequired))
    }

    @Test func planThenApplySucceedsForCO2BadgeFooterPlacement() async {
        let src = makeBookingSource()
        let tmpl = makeTemplate()
        try! FileManager.default.createDirectory(
            at: tmpl.appendingPathComponent("integrations/components"), withIntermediateDirectories: true)
        try! "BADGE".write(to: tmpl.appendingPathComponent("integrations/components/CO2Badge.astro"),
                           atomically: true, encoding: .utf8)
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["style": "footer"]
        guard case .success(let plan) = await ops.plan(integrationID: .co2Badge, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "co2Badge"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/components/CO2Badge.astro").path))
        #expect(!FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/carbon-footprint.astro").path))
        let layout = try! String(contentsOf: src.appendingPathComponent("src/layouts/BaseLayout.astro"), encoding: .utf8)
        #expect(layout.contains("<CO2Badge"))
        #expect(layout.contains("import CO2Badge from"))
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CO2_BADGE_STYLE=footer"))
    }

    @Test func planThenApplySucceedsForCO2BadgeDedicatedPage() async {
        let src = makeBookingSource()
        let tmpl = makeTemplate()
        try! FileManager.default.createDirectory(
            at: tmpl.appendingPathComponent("integrations/components"), withIntermediateDirectories: true)
        try! "BADGE".write(to: tmpl.appendingPathComponent("integrations/components/CO2Badge.astro"),
                           atomically: true, encoding: .utf8)
        try! FileManager.default.createDirectory(
            at: tmpl.appendingPathComponent("integrations/pages"), withIntermediateDirectories: true)
        try! "PAGE".write(to: tmpl.appendingPathComponent("integrations/pages/carbon-footprint.astro"),
                          atomically: true, encoding: .utf8)
        let ops = IntegrationOperations(sourceDirectory: { _ in src }, templateDirectory: { tmpl })
        let answers: Answers = ["style": "page"]
        guard case .success(let plan) = await ops.plan(integrationID: .co2Badge, answers: answers, siteID: "s1") else {
            Issue.record("plan failed"); return
        }
        let terminal = await ops.apply(plan, siteID: "s1")
        #expect(terminal == .done(integrationID: "co2Badge"))
        #expect(FileManager.default.fileExists(atPath: src.appendingPathComponent("src/pages/carbon-footprint.astro").path))
        let layout = try! String(contentsOf: src.appendingPathComponent("src/layouts/BaseLayout.astro"), encoding: .utf8)
        #expect(!layout.contains("<CO2Badge"))
        #expect(!layout.contains("import CO2Badge from"))
        let config = try! String(contentsOf: src.appendingPathComponent(".site-config"), encoding: .utf8)
        #expect(config.contains("CO2_BADGE_STYLE=page"))
    }
}
