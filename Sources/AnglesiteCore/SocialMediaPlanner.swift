import Foundation

/// Social plan generation seam (#465). Pillars are the backbone: if they fail, the whole plan
/// is `nil` (callers show unavailable/retry). Bios and weeks degrade individually — a bio that
/// can't fit its platform limit after one retry is omitted (the renderer marks it), a failed
/// week is dropped.
public protocol SocialMediaPlanning: Sendable {
    /// Generates a full ``SocialMediaPlan``, or `nil` when the backbone (pillars) couldn't be
    /// generated — never throws, so callers only distinguish "plan" from "no plan".
    ///
    /// - Parameters:
    ///   - siteName: The site's display name, woven into every prompt.
    ///   - businessType: Owner-declared business type; also drives the deterministic platform
    ///     recommendation (``SocialPlatformCatalog``). `nil` falls back to the generic set.
    ///   - preamble: Optional brand-voice preamble prepended to each prompt; `nil` omits it.
    ///   - weeks: How many calendar weeks to request; fewer may come back (failed weeks drop).
    ///   - startDate: The first week's start; later weeks step deterministically from it.
    ///   - siteID: Populates the `AssistantContext` for the generation calls.
    ///   - siteDirectory: Likewise context-only — the planner reads no site files itself.
    func plan(siteName: String, businessType: String?, preamble: String?, weeks: Int,
              startDate: Date, siteID: String, siteDirectory: URL) async -> SocialMediaPlan?
}

/// Chooses the planner for the current toolchain — same pattern as `SiteGraphExplainerFactory`:
/// non-gated so callers can default their dependency without importing FoundationModels.
public enum SocialMediaPlannerFactory {
    /// `FoundationModelSocialMediaPlanner` on a FoundationModels-capable toolchain, `nil`
    /// otherwise — `nil` means "no backend exists on this build", so hide the feature.
    public static func makeDefault() -> (any SocialMediaPlanning)? {
        #if compiler(>=6.4) && canImport(FoundationModels)
        return FoundationModelSocialMediaPlanner()
        #else
        return nil
        #endif
    }
}

// Gated to the Xcode-27 toolchain (FoundationModels absent at runtime on CI, #128) and to
// canImport for genuine off-Darwin portability (cross-platform port design §5).
#if compiler(>=6.4) && canImport(FoundationModels)
import FoundationModels

/// Apple-Intelligence-backed planner: structured generation via the `.privateCloudCompute` tier
/// (creative multi-part output wants the larger model; PCC keeps it within the no-external-APIs
/// policy, #459). Structure stays deterministic — platforms, week dates, and assembly are Swift;
/// the model only fills content.
public struct FoundationModelSocialMediaPlanner: SocialMediaPlanning {
    /// Stateless — each `plan` call builds its own assistant, so there is nothing to configure.
    public init() {}

    /// Implements ``SocialMediaPlanning/plan(siteName:businessType:preamble:weeks:startDate:siteID:siteDirectory:)``:
    /// pillars first (abort to `nil` on failure), then per-platform bios and per-week calendar
    /// chunks, each degrading individually per the protocol's policy. Also `nil` when no
    /// assistant backend is available on this host.
    public func plan(siteName: String, businessType: String?, preamble: String?, weeks: Int,
                     startDate: Date, siteID: String, siteDirectory: URL) async -> SocialMediaPlan? {
        guard let assistant = ContentAssistantFactory.make(tier: .privateCloudCompute) else { return nil }
        let context = AssistantContext(siteID: siteID, siteDirectory: siteDirectory)
        let platforms = SocialPlatformCatalog.recommended(businessType: businessType)

        guard let generatedPillars = try? await assistant.generateStructured(
            prompt: SocialPlanPrompt.pillars(siteName: siteName, businessType: businessType, preamble: preamble),
            context: context, resultType: GeneratedSocialPillars.self
        ), !generatedPillars.pillars.isEmpty else { return nil }
        let pillars = generatedPillars.pillars.map { SocialPillar(name: $0.name, detail: $0.detail) }

        var bios: [String: String] = [:]
        for platform in platforms {
            if let bio = await generateBio(platform: platform, siteName: siteName,
                                           businessType: businessType, preamble: preamble,
                                           assistant: assistant, context: context) {
                bios[platform.platform] = bio
            }
        }

        var calendarWeeks: [SocialCalendarWeek] = []
        for (index, weekStart) in SocialWeekDates.startDates(from: startDate, count: weeks).enumerated() {
            guard let week = try? await assistant.generateStructured(
                prompt: SocialPlanPrompt.week(index: index, platforms: platforms, pillars: pillars,
                                              businessType: businessType, preamble: preamble),
                context: context, resultType: GeneratedSocialWeek.self
            ) else { continue }
            calendarWeeks.append(SocialCalendarWeek(
                startDate: weekStart,
                entries: week.entries.map {
                    SocialCalendarEntry(day: $0.day, platform: $0.platform, pillar: $0.pillar, idea: $0.idea)
                }))
        }

        return SocialMediaPlan(businessType: businessType, platforms: platforms,
                               bios: bios, pillars: pillars, weeks: calendarWeeks)
    }

    /// One retry with an explicit "too long" correction, then give up — the renderer marks the
    /// gap; never silently truncate generated copy (spec §5.3 policy, applied to bios too).
    private func generateBio(platform: SocialPlatformProfile, siteName: String, businessType: String?,
                             preamble: String?, assistant: any ContentAssistant,
                             context: AssistantContext) async -> String? {
        let prompt = SocialPlanPrompt.bio(platform: platform, siteName: siteName,
                                          businessType: businessType, preamble: preamble)
        guard let first = try? await assistant.generateStructured(
            prompt: prompt, context: context, resultType: GeneratedSocialBio.self) else { return nil }
        // An empty/whitespace-only bio is treated the same as an over-limit one: one retry,
        // then omit (never render an empty bio card).
        let firstEmpty = first.bio.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if !firstEmpty, first.bio.count <= platform.bioCharLimit { return first.bio }
        let retryPrompt = firstEmpty
            ? prompt + "\n\nYour previous attempt was empty. Write the bio's full text."
            : prompt + "\n\nYour previous attempt was \(first.bio.count) characters — too long. It must be under \(platform.bioCharLimit) characters."
        guard let second = try? await assistant.generateStructured(
            prompt: retryPrompt, context: context, resultType: GeneratedSocialBio.self),
              !second.bio.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              second.bio.count <= platform.bioCharLimit else { return nil }
        return second.bio
    }
}
#endif
