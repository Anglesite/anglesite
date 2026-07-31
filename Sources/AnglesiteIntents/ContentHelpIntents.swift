import AppIntents
import AnglesiteCore
import Foundation

/// Siri/Shortcuts front-door for the copy audit (#465). Reuses the same chunker/auditor as the
/// GUI and chat; the intent summarizes and points at the app for applying rewrites.
///
/// Not registered in AnglesiteShortcuts: only one phrase slot remains under the 10-phrase cap
/// and it's reserved for higher-traffic intents; ReviewCopyIntent stays discoverable via the
/// Shortcuts app and via `SiteEntityQuery` resolution.
public struct ReviewCopyIntent: AppIntent {
    /// Action name in the Shortcuts library. Says "Site Copy", not just "Copy", to avoid
    /// reading as a clipboard/duplicate action out of context.
    public static let title: LocalizedStringResource = "Review Site Copy"
    /// Shortcuts-editor blurb; names the audit dimensions so users know what "review" covers.
    public static let description = IntentDescription(
        "Review a site's written copy for clarity, tone, and calls to action.")

    /// The site to audit, resolved by ``SiteEntityQuery`` so "review copy on my portfolio"
    /// matches by name.
    @Parameter(title: "Site") public var site: SiteEntity

    /// Required by the AppIntents runtime; parameters are populated after init.
    public init() {}
    /// Convenience for programmatic invocation with the site already resolved (tests, chaining
    /// from another intent's `SiteEntity` result).
    public init(site: SiteEntity) {
        self.init()
        self.site = site
    }

    /// One-line Shortcuts-editor rendering: "Review copy on <site>".
    public static var parameterSummary: some ParameterSummary {
        Summary("Review copy on \(\.$site)")
    }

    /// Runs the audit and speaks/shows the summary. All outcome branching lives in the private
    /// `run()` so the internal `performForTesting()` can share it — `IntentDialog` exposes no
    /// way to read its text back out of a real `perform()` result.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: try await run()))
    }

    private func run() async throws -> String {
        // `SiteEntity.directory` is the `.anglesite` PACKAGE root (see its init from
        // `SiteStore.Site`), not the `Source/` git repo the auditor needs to read — derive the
        // actual source directory via `AnglesitePackage` here rather than changing the entity's
        // established (and elsewhere-relied-on) semantics.
        guard let packageURL = site.directory else {
            return IntegrationDialogs.failed(reason: "site folder unavailable", siteName: site.displayName)
        }
        let sourceDirectory = AnglesitePackage(url: packageURL).sourceURL
        guard let auditor = CopyEditAuditorFactory.makeDefault() else {
            return ContentHelpDialogs.assistantUnavailable(feature: "Copy review")
        }
        let chunks = SiteContentChunker.chunks(sourceDirectory: sourceDirectory)
        let preamble = BrandVoiceGuidance.preamble(
            conventions: nil, businessType: SiteBusinessType.read(sourceDirectory: sourceDirectory))
        let report = await auditor.audit(
            chunks: chunks, preamble: preamble, siteID: site.id, siteDirectory: sourceDirectory)
        if let unavailableMessage = report.unavailableMessage {
            return unavailableMessage
        }
        return ContentHelpDialogs.copyReview(findingCount: report.findings.count, pageCount: report.auditedCount, skippedCount: report.skippedRoutes.count, siteName: site.displayName)
    }
}

// MARK: - Test-only helpers

extension ReviewCopyIntent {
    /// Drives `perform`'s dialog logic directly, bypassing the AppIntents runtime (`IntentDialog`
    /// exposes no way to read its text back out, so tests can't inspect `perform()`'s return
    /// value directly — mirrors `ListDNSRecordsIntent.performForTesting()`). Safe for the
    /// site-folder-unavailable guard; reaching further calls the real `CopyEditAuditorFactory`
    /// (no test-only override exists for it).
    func performForTesting() async throws -> String {
        try await run()
    }
}

/// Siri/Shortcuts front-door for the social media planner (#465). Reuses the same planner as the
/// chat tool and GUI sheet; writes `docs/social-calendar.md` into the site repo, so it confirms
/// before saving like `AddBookingIntent`.
///
/// Not registered in AnglesiteShortcuts: same phrase-budget reasoning as `ReviewCopyIntent` —
/// stays discoverable via the Shortcuts app and via `SiteEntityQuery` resolution.
public struct PlanSocialMediaIntent: AppIntent {
    /// Action name in the Shortcuts library.
    public static let title: LocalizedStringResource = "Plan Social Media"
    /// Shortcuts-editor blurb; "plan and content calendar" signals the persisted-markdown
    /// deliverable, not just a spoken reply.
    public static let description = IntentDescription(
        "Generate a social media plan and content calendar for a site.")

    /// The site to plan for, resolved by ``SiteEntityQuery``.
    @Parameter(title: "Site") public var site: SiteEntity
    /// Planning horizon. Defaults to 4; `run()` clamps it to 1…8 rather than erroring, so a
    /// Shortcut passing a wild value still gets a usable plan.
    @Parameter(title: "Weeks", default: 4) public var weeks: Int

    /// Required by the AppIntents runtime; parameters are populated after init.
    public init() {}

    /// One-line Shortcuts-editor rendering, with `weeks` demoted to the disclosure group so the
    /// summary stays a single sentence.
    public static var parameterSummary: some ParameterSummary {
        Summary("Plan social media for \(\.$site)") {
            \.$weeks
        }
    }

    /// Generates the plan, confirms with the user (this intent writes
    /// `docs/social-calendar.md` into the site repo), then saves and reports. Branching lives
    /// in the private `run()` shared with the internal `performForTesting()` — see
    /// ``ReviewCopyIntent/perform()``.
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: try await run()))
    }

    private func run() async throws -> String {
        // Same `SiteEntity.directory` ground truth as `ReviewCopyIntent`: it's the package root,
        // not `Source/` — derive the source directory via `AnglesitePackage`.
        guard let packageURL = site.directory else {
            return IntegrationDialogs.failed(reason: "site folder unavailable", siteName: site.displayName)
        }
        let sourceDirectory = AnglesitePackage(url: packageURL).sourceURL
        guard let planner = SocialMediaPlannerFactory.makeDefault() else {
            return ContentHelpDialogs.assistantUnavailable(feature: "Social planning")
        }
        let businessType = SiteBusinessType.read(sourceDirectory: sourceDirectory)
        let siteName = SiteConfigValues.siteName(sourceDirectory: sourceDirectory) ?? site.displayName
        let clamped = min(max(weeks, 1), 8)
        guard let plan = await planner.plan(
            siteName: siteName, businessType: businessType,
            preamble: BrandVoiceGuidance.preamble(conventions: nil, businessType: businessType),
            weeks: clamped, startDate: Date(), siteID: site.id, siteDirectory: sourceDirectory) else {
            return ContentHelpDialogs.assistantUnavailable(feature: "Social planning")
        }
        // Writing a docs file into the site repo: confirm like AddBookingIntent confirms writes.
        try await requestConfirmation(dialog: "Save a \(plan.weeks.count)-week social plan to \(site.displayName)'s docs/social-calendar.md?")
        let markdown = SocialCalendarMarkdown.render(plan: plan, siteName: siteName)
        try SocialCalendarMarkdown.write(markdown: markdown, sourceDirectory: sourceDirectory)
        return ContentHelpDialogs.socialPlanSaved(weeks: plan.weeks.count, siteName: site.displayName)
    }
}

// MARK: - Test-only helpers

extension PlanSocialMediaIntent {
    /// Drives `perform`'s dialog logic directly, bypassing the AppIntents runtime — see
    /// `ReviewCopyIntent.performForTesting()`. Safe for the site-folder-unavailable guard;
    /// reaching further calls the real `SocialMediaPlannerFactory` and, on success, a real
    /// `requestConfirmation` (no test-only override exists for either).
    func performForTesting() async throws -> String {
        try await run()
    }
}

/// Siri/Shortcuts front-door for post repurposing (#465). Reuses the same repurposer as the chat
/// tool and GUI sheet; returns the drafted variants as its value and a spoken summary as the
/// dialog, mirroring `ReviewCopyIntent`/`PlanSocialMediaIntent`.
///
/// Not registered in AnglesiteShortcuts: same phrase-budget reasoning as `ReviewCopyIntent`/
/// `PlanSocialMediaIntent` — stays discoverable via the Shortcuts app and via `SiteEntityQuery`
/// resolution.
public struct RepurposePostIntent: AppIntent {
    /// Action name in the Shortcuts library.
    public static let title: LocalizedStringResource = "Repurpose Post"
    /// Shortcuts-editor blurb; "platform-sized" flags that variants come pre-fitted to each
    /// platform's length limits.
    public static let description = IntentDescription(
        "Draft platform-sized social posts from one of a site's blog posts.")

    /// The site owning the post, resolved by ``SiteEntityQuery``.
    @Parameter(title: "Site") public var site: SiteEntity
    /// The post to repurpose, identified by slug and loaded straight from the repo via
    /// `PostSource` (not resolved through ``PostEntityQuery``, whose graph is only populated
    /// while the site is open in a window). An unknown slug fails with a spoken error naming it.
    @Parameter(title: "Post Slug", description: "The post's slug, e.g. 'coast-trip'.")
    public var slug: String

    /// Required by the AppIntents runtime; parameters are populated after init.
    public init() {}

    /// One-line Shortcuts-editor rendering: "Repurpose <slug> from <site>".
    public static var parameterSummary: some ParameterSummary {
        Summary("Repurpose \(\.$slug) from \(\.$site)")
    }

    /// Drafts the variants and returns them twice: the full text block as the intent's *value*
    /// (pipeable into a share/clipboard action in a Shortcut) and a short summary as the spoken
    /// *dialog*. Branching lives in the private `run()` shared with the internal
    /// `performForTesting()` — see ``ReviewCopyIntent/perform()``.
    public func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let (value, dialog) = try await run()
        return .result(value: value, dialog: IntentDialog(stringLiteral: dialog))
    }

    private func run() async throws -> (value: String, dialog: String) {
        // Same `SiteEntity.directory` ground truth as `ReviewCopyIntent`/`PlanSocialMediaIntent`:
        // it's the package root, not `Source/` — derive the source directory via `AnglesitePackage`.
        guard let packageURL = site.directory else {
            return ("", IntegrationDialogs.failed(reason: "site folder unavailable", siteName: site.displayName))
        }
        let sourceDirectory = AnglesitePackage(url: packageURL).sourceURL
        guard let repurposer = PostRepurposerFactory.makeDefault() else {
            return ("", ContentHelpDialogs.assistantUnavailable(feature: "Repurposing"))
        }
        guard let post = PostSource.load(slug: slug, sourceDirectory: sourceDirectory) else {
            return ("", IntegrationDialogs.failed(reason: "no post named \(slug)", siteName: site.displayName))
        }
        // Domain resolution mirrors `RepurposePostTool`/`RepurposeModel`: the app writes `DOMAIN`
        // (not `SITE_DOMAIN`) into `.site-config`, so this reads it via `WebsiteAnalyticsAsset.bestHost`.
        let config = (try? String(contentsOf: sourceDirectory.appendingPathComponent(".site-config"), encoding: .utf8)) ?? ""
        let domain = WebsiteAnalyticsAsset.bestHost(from: config, fallback: "")
        let businessType = SiteBusinessType.read(sourceDirectory: sourceDirectory)
        let variants = await repurposer.variants(
            post: post,
            postURL: PostSource.postURL(
                domain: domain.isEmpty ? "example.com" : domain, collection: post.collection, slug: post.slug),
            specs: RepurposePlatformSpecs.all,
            preamble: BrandVoiceGuidance.preamble(conventions: nil, businessType: businessType),
            siteID: site.id, siteDirectory: sourceDirectory)
        let failed = variants.filter { $0.text == nil }.count
        let block = RepurposeReply.text(postTitle: post.title, variants: variants)
        let summary = ContentHelpDialogs.repurposeSummary(
            postTitle: post.title, platformCount: variants.count - failed, failedCount: failed)
        let dialog = domain.isEmpty ? "\(RepurposeReply.missingDomainWarning) \(summary)" : summary
        return (block, dialog)
    }
}

// MARK: - Test-only helpers

extension RepurposePostIntent {
    /// Drives `perform`'s dialog logic directly, bypassing the AppIntents runtime — see
    /// `ReviewCopyIntent.performForTesting()`. Safe for the site-folder-unavailable guard;
    /// reaching further calls the real `PostRepurposerFactory` (no test-only override exists
    /// for it).
    func performForTesting() async throws -> (value: String, dialog: String) {
        try await run()
    }
}
