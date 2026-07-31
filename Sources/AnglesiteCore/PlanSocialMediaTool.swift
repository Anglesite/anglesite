import Foundation

/// Pure chat replies for the social planner tool, non-gated for CI tests.
public enum PlanSocialMediaReply {
    /// `weeks` is the requested/clamped week count the caller asked for — not
    /// `plan.weeks.count`, since a week whose generation failed is silently dropped from
    /// `plan.weeks`, and the model must resupply the count the user actually confirmed
    /// (not however many weeks happened to succeed in the preview) on the `apply: true` call.
    public static func preview(plan: SocialMediaPlan, weeks: Int) -> String {
        var lines: [String] = ["Here's the social media plan I'd save:"]
        lines.append("Platforms: " + plan.platforms.map { "\($0.platform) (\($0.postsPerWeek)×/week)" }.joined(separator: ", "))
        lines.append("Pillars: " + plan.pillars.map(\.name).joined(separator: ", "))
        lines.append("\(plan.weeks.count) week\(plan.weeks.count == 1 ? "" : "s") of calendar entries.")
        lines.append("Confirm to save it to docs/social-calendar.md, or tell me what to change. When the user confirms, call this tool again with apply: true and weeks: \(weeks). (The plan is regenerated on save, so details may vary slightly from this preview.)")
        return lines.joined(separator: "\n")
    }

    /// Confirmation reply after `docs/social-calendar.md` is written. Restates that Anglesite
    /// never posts on the owner's behalf — the calendar is a copy-out artifact, not an
    /// integration — so the model can't oversell what just happened.
    public static func saved(weeks: Int) -> String {
        "Saved the \(weeks)-week plan to docs/social-calendar.md. Anglesite never posts for you — copy entries out as you go."
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Chat front-door for the social plan (#465). Confirm-before-write: the first call previews;
/// `apply: true` regenerates and writes `docs/social-calendar.md` (the file is app-generated,
/// so a regenerate-on-apply keeps the tool stateless across turns).
public struct PlanSocialMediaTool: Tool, Sendable {
    /// Stable tool identifier, exposed statically so registration and tests can reference it
    /// without constructing a tool instance.
    public static let toolName = "planSocialMedia"
    /// The name the model calls this tool by (`Tool` requirement).
    public let name = PlanSocialMediaTool.toolName
    /// Model-facing tool description (`Tool` requirement). Spells out the preview-then-confirm
    /// contract so the model doesn't promise an immediate save on the first call.
    public let description = "Create a social media plan: recommended platforms, profile bios, content pillars, and a weekly content calendar saved to docs/social-calendar.md. Returns a preview to confirm before saving."

    /// Model-supplied arguments. Both fields are optional so a bare `planSocialMedia` call
    /// (the common first turn) is valid and takes the preview defaults.
    @Generable
    public struct Arguments {
        /// Requested calendar length in weeks; clamped to 1…8 with a default of 4 in `call`,
        /// so an out-of-range model value degrades instead of erroring.
        @Guide(description: "How many weeks of calendar to plan (default 4, max 8).")
        public var weeks: Int?
        /// The confirm-before-write flag: absent/`false` previews, `true` regenerates and
        /// saves. The `@Guide` wording is deliberately emphatic — it's the only thing standing
        /// between the model and an unconfirmed write.
        @Guide(description: "Set to true ONLY after the user has confirmed they want the plan saved.")
        public var apply: Bool?
    }

    private let planner: any SocialMediaPlanning
    private let conventionsStore: ProjectConventionsStore?
    private let siteID: String
    private let siteDirectory: URL
    /// Injected clock so the calendar's start is testable/deterministic where needed.
    private let now: @Sendable () -> Date

    /// Creates the tool for one site's chat session.
    ///
    /// - Parameters:
    ///   - planner: The plan generator (on-device model in production, a stub in tests).
    ///   - conventionsStore: Source of the learned brand-voice conventions folded into the
    ///     generation preamble; `nil` when the site has no conventions yet.
    ///   - siteID: Stable site identity forwarded to the planner.
    ///   - siteDirectory: The site's `Source/` root — read for business type and site name,
    ///     and the destination for `docs/social-calendar.md` on apply.
    ///   - now: Injected clock so the calendar's start date is deterministic in tests.
    public init(planner: any SocialMediaPlanning, conventionsStore: ProjectConventionsStore?,
                siteID: String, siteDirectory: URL, now: @escaping @Sendable () -> Date = { Date() }) {
        self.planner = planner
        self.conventionsStore = conventionsStore
        self.siteID = siteID
        self.siteDirectory = siteDirectory
        self.now = now
    }

    /// Runs one turn: regenerates the plan, then either previews it or (on `apply: true`)
    /// writes `docs/social-calendar.md`. Failures are reported in-band as chat text — planner
    /// unavailability and a failed save both return a message rather than throwing, because a
    /// thrown error surfaces to the user as a generic model failure instead of something
    /// actionable.
    public func call(arguments: Arguments) async throws -> String {
        let weeks = min(max(arguments.weeks ?? 4, 1), 8)
        let conventions = await conventionsStore?.load()
        let businessType = SiteBusinessType.read(sourceDirectory: siteDirectory)
        let preamble = BrandVoiceGuidance.preamble(conventions: conventions, businessType: businessType)
        let siteName = SiteConfigValues.siteName(sourceDirectory: siteDirectory) ?? "this site"
        guard let plan = await planner.plan(
            siteName: siteName, businessType: businessType, preamble: preamble,
            weeks: weeks, startDate: now(), siteID: siteID, siteDirectory: siteDirectory) else {
            return ContentHelpDialogs.assistantUnavailable(feature: "Social planning")
        }
        if arguments.apply == true {
            let markdown = SocialCalendarMarkdown.render(plan: plan, siteName: siteName)
            do {
                try SocialCalendarMarkdown.write(markdown: markdown, sourceDirectory: siteDirectory)
                return PlanSocialMediaReply.saved(weeks: plan.weeks.count)
            } catch {
                return "I generated the plan but couldn't save it: \(error.localizedDescription)"
            }
        }
        return PlanSocialMediaReply.preview(plan: plan, weeks: weeks)
    }
}
#endif
