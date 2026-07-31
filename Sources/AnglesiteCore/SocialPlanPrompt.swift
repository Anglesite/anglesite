import Foundation

/// Pure prompt builders for the social planner (#465) — non-gated for CI tests. Week generation
/// is one call per week (chunk-first): each call carries only the platform cadence and pillar
/// facts, comfortably inside the on-device window.
public enum SocialPlanPrompt {
    /// Prompt for one platform's profile bio. States the platform's character limit as a hard
    /// limit up front — the planner still verifies the count and retries once, because the model
    /// can't be trusted to count characters (see the planner's no-silent-truncation policy).
    public static func bio(platform: SocialPlatformProfile, siteName: String,
                           businessType: String?, preamble: String?) -> String {
        joined(preamble, """
        Write a profile bio for \(siteName)\(businessDescription(businessType)) on \(platform.platform). \
        Hard limit: \(platform.bioCharLimit) characters — shorter is better. Platform note: \(platform.note). \
        Plain text only, no surrounding quotes.
        """)
    }

    /// Prompt for the 3–5 content pillars, encoding the 80/20 value-vs-promotion rule so the
    /// generated plan doesn't read as pure advertising.
    public static func pillars(siteName: String, businessType: String?, preamble: String?) -> String {
        joined(preamble, """
        Propose 3 to 5 social media content pillars for \(siteName)\(businessDescription(businessType)). \
        Follow the 80/20 rule: mostly value, story, and behind-the-scenes content; at most one \
        promotional pillar.
        """)
    }

    /// Prompt for one calendar week (`index` is zero-based; the prompt says "week N+1"). Carries
    /// the platform cadences and the already-generated pillars as facts, and requires pillar
    /// names verbatim so entries join back to ``SocialPillar/name``.
    public static func week(index: Int, platforms: [SocialPlatformProfile], pillars: [SocialPillar],
                            businessType: String?, preamble: String?) -> String {
        let platformFacts = platforms
            .map { "- \($0.platform): \($0.postsPerWeek) posts this week (\($0.note))" }
            .joined(separator: "\n")
        let pillarFacts = pillars.map { "- \($0.name): \($0.detail)" }.joined(separator: "\n")
        // Unlike `bio`/`pillars`, there's no preceding site name here for `businessDescription`'s
        // ", a bakery," clause to attach to — that reads as if the calendar itself were the
        // bakery. Use a "for a <type>" clause instead, which is grammatical with or without one.
        let businessClause = businessType.map { " for a \($0)" } ?? ""
        return joined(preamble, """
        Plan week \(index + 1) of a social media calendar\(businessClause). \
        Create one entry per post, spread across the week, rotating through the pillars so no \
        pillar repeats on consecutive days on the same platform.

        Platforms and cadence:
        \(platformFacts)

        Content pillars (use these names exactly):
        \(pillarFacts)
        """)
    }

    static func businessDescription(_ businessType: String?) -> String {
        guard let businessType, !businessType.isEmpty else { return "" }
        return ", a \(businessType),"
    }

    static func joined(_ preamble: String?, _ body: String) -> String {
        [preamble, body].compactMap { $0 }.joined(separator: "\n\n")
    }
}

/// Pure 7-day week-start math, gregorian/UTC — deterministic regardless of the user's calendar.
public enum SocialWeekDates {
    /// `count` week-start dates at exact 7-day (in seconds) intervals from `start` — no calendar
    /// or time-zone lookup, so DST shifts the wall-clock time rather than the interval, which is
    /// fine for labeling calendar weeks. Negative `count` yields `[]`.
    public static func startDates(from start: Date, count: Int) -> [Date] {
        (0..<max(0, count)).map { start.addingTimeInterval(TimeInterval($0) * 7 * 86_400) }
    }
}
