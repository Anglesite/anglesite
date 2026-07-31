import Foundation

/// Impact ranking for a copy finding. Raw values are the sort keys — `high` is 0 so a plain
/// ascending sort lists the most impactful findings first (see ``CopyEditReportBuilder``).
public enum CopyFindingSeverity: Int, Sendable, Equatable, Comparable, CaseIterable {
    /// Most impactful; sorts first.
    case high = 0
    /// Middling impact.
    case medium = 1
    /// Least impactful — also the fallback for an unrecognized model label, per
    /// ``CopyFindingSeverity/init(label:)``.
    case low = 2

    /// Model output is a free string under `@Guide` — parse defensively, unknown → `.low`.
    public init(label: String) {
        switch label.lowercased() {
        case "high": self = .high
        case "medium": self = .medium
        default: self = .low
        }
    }

    /// Raw-value order: `high < medium < low` — "less" means *more* severe, chosen so ascending
    /// sorts put high-severity findings first without a custom comparator at every sort site.
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Non-gated twin of `GeneratedCopyFinding` so aggregation is CI-testable (the `@Generable`
/// type only exists on the Xcode-27 toolchain).
public struct CopyFindingDraft: Sendable, Equatable {
    /// Checklist category, as the model emitted it (free string).
    public let category: String
    /// Free-string severity label; parsed defensively by ``CopyFindingSeverity/init(label:)``.
    public let severity: String
    /// The model's verbatim quote from the page. Load-bearing: a draft whose excerpt doesn't
    /// occur exactly in the chunk text is treated as hallucinated and dropped by
    /// ``CopyEditReportBuilder``.
    public let excerpt: String
    /// One-sentence plain-language statement of the problem.
    public let issue: String
    /// The proposed replacement text, in the site's voice.
    public let suggestedRewrite: String

    /// Creates a draft; everything is kept as raw strings here — parsing and verification happen
    /// at aggregation time, where they can be CI-tested.
    public init(category: String, severity: String, excerpt: String, issue: String, suggestedRewrite: String) {
        self.category = category
        self.severity = severity
        self.excerpt = excerpt
        self.issue = issue
        self.suggestedRewrite = suggestedRewrite
    }
}

/// One verified finding in the final report: a ``CopyFindingDraft`` that survived the
/// verbatim-excerpt check, joined to its page's route/title/file and given a stable id.
public struct CopyFinding: Sendable, Equatable, Identifiable {
    /// Stable identity, `filePath#index` over the page's verified findings — deterministic for
    /// a given report, so selection survives list refreshes.
    public let id: String
    /// The page's URL route (what the user recognizes the page by).
    public let route: String
    /// The page title, if the chunk carried one.
    public let title: String?
    /// The page's source file — the write target when ``suggestedRewrite`` is applied.
    public let filePath: String
    /// Checklist category, carried through from the draft.
    public let category: String
    /// Parsed severity; drives the report's severity-major sort.
    public let severity: CopyFindingSeverity
    /// The verbatim quote — already verified to occur in the page text, so
    /// `CopyRewriteApplier.apply` can locate it.
    public let excerpt: String
    /// One-sentence plain-language statement of the problem.
    public let issue: String
    /// The proposed replacement text, in the site's voice.
    public let suggestedRewrite: String

    /// Creates a finding. Normally only ``CopyEditReportBuilder`` does — it owns the id scheme
    /// and the excerpt verification this type's fields assume.
    public init(id: String, route: String, title: String?, filePath: String, category: String,
                severity: CopyFindingSeverity, excerpt: String, issue: String, suggestedRewrite: String) {
        self.id = id
        self.route = route
        self.title = title
        self.filePath = filePath
        self.category = category
        self.severity = severity
        self.excerpt = excerpt
        self.issue = issue
        self.suggestedRewrite = suggestedRewrite
    }
}

/// Whole-site audit result. Per spec §5.1 a failed chunk degrades to `skippedRoutes` — the
/// report never aborts and never hides a gap.
public struct CopyEditReport: Sendable, Equatable {
    /// Verified findings, sorted severity-major then by route.
    public let findings: [CopyFinding]
    /// How many pages were actually reviewed (with or without findings) — shown alongside
    /// ``skippedRoutes`` so "no findings" is distinguishable from "nothing was audited".
    public let auditedCount: Int
    /// Routes whose chunk failed to audit, named individually so the gap is visible.
    public let skippedRoutes: [String]
    /// Non-nil when the audit couldn't run at all (e.g. Apple Intelligence off at runtime) —
    /// carries the user-facing explanation. Front-doors show this instead of a skip list.
    public let unavailableMessage: String?

    /// Creates a report. Prefer ``CopyEditReportBuilder/report(results:unavailableMessage:)``,
    /// which derives the counts, skip list, and sort from raw per-chunk results.
    public init(findings: [CopyFinding], auditedCount: Int, skippedRoutes: [String], unavailableMessage: String? = nil) {
        self.findings = findings
        self.auditedCount = auditedCount
        self.skippedRoutes = skippedRoutes
        self.unavailableMessage = unavailableMessage
    }
}

/// Aggregates per-chunk generation results into a ``CopyEditReport``: verifies excerpts, mints
/// stable ids, and applies the severity-major sort. Pure and non-gated so the aggregation is
/// CI-testable without FoundationModels.
public enum CopyEditReportBuilder {
    /// Builds the report. A `nil` `drafts` entry means that chunk failed and becomes a skipped
    /// route; drafts whose excerpt isn't a verbatim substring of the chunk text are dropped as
    /// hallucinated (see the inline note for the reasoning and the accepted edge case).
    public static func report(results: [(chunk: ContentChunk, drafts: [CopyFindingDraft]?)],
                              unavailableMessage: String? = nil) -> CopyEditReport {
        var findings: [CopyFinding] = []
        var skipped: [String] = []
        var audited = 0
        for (chunk, drafts) in results {
            guard let drafts else {
                skipped.append(chunk.route)
                continue
            }
            audited += 1
            // The prompt demands verbatim excerpts from the page, so any excerpt that doesn't
            // actually occur in the chunk's text is hallucinated — most often the model echoing
            // its own guided-generation schema instructions back as a "finding". Drop those before
            // indexing; a dropped finding is noise, not signal. Accepted edge case: a genuine
            // finding about text beyond the 2,000-char chunk cap is dropped too, since the cap
            // already excluded that text from review.
            let verified = drafts.filter { !$0.excerpt.isEmpty && chunk.text.contains($0.excerpt) }
            for (index, d) in verified.enumerated() {
                findings.append(CopyFinding(
                    id: "\(chunk.filePath)#\(index)",
                    route: chunk.route,
                    title: chunk.title,
                    filePath: chunk.filePath,
                    category: d.category,
                    severity: CopyFindingSeverity(label: d.severity),
                    excerpt: d.excerpt,
                    issue: d.issue,
                    suggestedRewrite: d.suggestedRewrite
                ))
            }
        }
        findings.sort { ($0.severity, $0.route) < ($1.severity, $1.route) }
        return CopyEditReport(findings: findings, auditedCount: audited, skippedRoutes: skipped,
                              unavailableMessage: unavailableMessage)
    }
}
