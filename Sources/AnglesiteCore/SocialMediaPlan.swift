import Foundation

/// One content pillar — a recurring theme the calendar's posts rotate through. The pillar names
/// are the join key between plan sections: ``SocialCalendarEntry/pillar`` refers back to
/// ``name``, which is why the week-generation prompt insists on using the names exactly.
public struct SocialPillar: Sendable, Equatable {
    /// Short pillar label (e.g. "Behind the scenes"), referenced verbatim by calendar entries.
    public let name: String
    /// One-sentence description of what the pillar covers, used to brief week generation.
    public let detail: String
    /// Memberwise initializer — the FM-generated pillar is converted to this plain value at the
    /// planner boundary so the plan model stays toolchain-ungated.
    public init(name: String, detail: String) {
        self.name = name
        self.detail = detail
    }
}

/// One planned post in the calendar. All-string fields by design: the model generates the plan
/// (spec §5.2), and deterministic Swift renders it without interpreting day names or platform
/// labels beyond display.
public struct SocialCalendarEntry: Sendable, Equatable {
    /// Weekday label for the post (model-generated text, not a parsed date).
    public let day: String
    /// Which platform the post targets — one of the plan's recommended platform names.
    public let platform: String
    /// The ``SocialPillar/name`` this post belongs to.
    public let pillar: String
    /// The post idea itself — the one model-authored creative field per entry.
    public let idea: String
    /// Memberwise initializer, mirroring ``SocialPillar``'s boundary role.
    public init(day: String, platform: String, pillar: String, idea: String) {
        self.day = day
        self.platform = platform
        self.pillar = pillar
        self.idea = idea
    }
}

/// One week of the calendar. The date comes from deterministic Swift (``SocialWeekDates``), never
/// from the model — only `entries` is generated content.
public struct SocialCalendarWeek: Sendable, Equatable {
    /// The week's first day, computed by ``SocialWeekDates/startDates(from:count:)``.
    public let startDate: Date
    /// The week's planned posts. A failed generation drops the whole week rather than shipping a
    /// partial one (see ``SocialMediaPlanning``'s degradation policy).
    public let entries: [SocialCalendarEntry]
    /// Memberwise initializer, mirroring ``SocialPillar``'s boundary role.
    public init(startDate: Date, entries: [SocialCalendarEntry]) {
        self.startDate = startDate
        self.entries = entries
    }
}

/// A generated social plan: FM writes the content, deterministic Swift owns the structure and
/// the file format (spec §5.2). `bios` is keyed by platform name; a missing key means that
/// bio couldn't be generated within its limit.
public struct SocialMediaPlan: Sendable, Equatable {
    /// The owner-declared business type the plan was generated for; `nil` when unknown, which
    /// falls back to the generic platform recommendation.
    public let businessType: String?
    /// The recommended platforms (deterministic, from ``SocialPlatformCatalog``) the bios and
    /// calendar entries are keyed against.
    public let platforms: [SocialPlatformProfile]
    /// Generated profile bios keyed by platform name — see the type doc for the missing-key
    /// contract.
    public let bios: [String: String]
    /// The generated content pillars; never empty in a non-`nil` plan (pillar failure aborts the
    /// whole plan — see ``SocialMediaPlanning``).
    public let pillars: [SocialPillar]
    /// The generated calendar weeks; may hold fewer weeks than requested when individual weeks
    /// failed and were dropped.
    public let weeks: [SocialCalendarWeek]

    /// Memberwise initializer — assembled by the planner, or directly by tests and renderers.
    public init(businessType: String?, platforms: [SocialPlatformProfile], bios: [String: String],
                pillars: [SocialPillar], weeks: [SocialCalendarWeek]) {
        self.businessType = businessType
        self.platforms = platforms
        self.bios = bios
        self.pillars = pillars
        self.weeks = weeks
    }
}
