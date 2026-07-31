import Foundation

/// Structured output of an `AuditCommand` run.
///
/// `findings` is the concatenated, runner-order list of issues. `runnersExecuted`
/// records which `Finding.Category` runners produced a result (empty findings still
/// counts as "executed"); `runnersSkipped` records the ones that threw, so the UI
/// can surface "the perf runner couldn't run because Lighthouse isn't installed"
/// without turning the whole audit into a failure.
public struct AuditReport: Sendable, Equatable {
    /// One issue reported by one runner, in the common shape all categories share — the report
    /// UI renders every category through the same row, so runners normalize into this rather
    /// than each exposing its own result type.
    public struct Finding: Sendable, Equatable, Hashable, Identifiable {
        /// The audit dimension a finding (and its runner — see `AuditRunner.category`) belongs
        /// to. Raw string values double as the `audit:<siteID>:<category>` log-source segment.
        public enum Category: String, Sendable, Equatable, Codable, CaseIterable {
            /// Produced by `SecurityTxtAuditRunner` (#843) today.
            case security
            /// Produced by `A11yAuditRunner` (the template's `a11y-audit.ts` script).
            case accessibility
            /// Reserved: no shipped runner yet (#86 follow-up); declared now so the UI's
            /// category handling doesn't churn when one lands.
            case performance
            /// Reserved: no shipped runner yet (#86 follow-up), same as `performance`.
            case seo
        }

        /// How urgently a finding needs the owner's attention. The UI keys its pass/fail badge
        /// off `critical` alone — warnings and info don't fail an audit.
        public enum Severity: String, Sendable, Equatable, Codable, Comparable, CaseIterable {
            /// Must-fix: the kind of finding that turns the audit badge red.
            case critical
            /// Should-fix; doesn't block a "passing" audit.
            case warning
            /// Advisory only.
            case info

            /// Critical first → reverse-sorted natural order is fine for UI lists.
            public static func < (lhs: Severity, rhs: Severity) -> Bool {
                let order: [Severity: Int] = [.critical: 0, .warning: 1, .info: 2]
                return (order[lhs] ?? 99) < (order[rhs] ?? 99)
            }
        }

        /// Which audit dimension this belongs to — always the producing runner's category.
        public let category: Category
        /// See ``Severity``; drives sort order and the report's pass/fail badge.
        public let severity: Severity
        /// Short label (e.g. an audit rule ID like `"alt-text"`). Free-form but
        /// expected to be compact enough to render as a header.
        public let title: String
        /// One-line description of the issue ("Image on /about/ has no alt").
        public let detail: String
        /// Optional fix suggestion. Some runners produce these directly; others don't.
        public let remediation: String?
        /// Optional location pointer — page URL, file path, or selector. Free-form
        /// because each runner names locations differently (a11y → page URL,
        /// pre-deploy security → file path, etc.).
        public let location: String?

        /// Memberwise. `remediation`/`location` take no default `nil` on purpose: a runner must
        /// say explicitly that it has nothing to offer, rather than omitting them by accident.
        public init(
            category: Category,
            severity: Severity,
            title: String,
            detail: String,
            remediation: String?,
            location: String?
        ) {
            self.category = category
            self.severity = severity
            self.title = title
            self.detail = detail
            self.remediation = remediation
            self.location = location
        }

        /// Content-derived identity (no stored UUID), so the *same* issue keeps the same `id`
        /// across audit re-runs — SwiftUI lists update in place instead of tearing down every
        /// row each time the audit runs. `severity` is deliberately excluded: a rule whose
        /// severity classification changes is still the same finding.
        public var id: String {
            "\(category.rawValue):\(title):\(detail):\(location ?? "")"
        }
    }

    /// A runner that ran but threw mid-way. The category identifies which check;
    /// the reason is the runner's localized error description.
    public struct SkippedRunner: Sendable, Equatable {
        /// Which check didn't complete — so the UI can say *what* wasn't verified, not just
        /// that something failed.
        public let category: Finding.Category
        /// The runner's error, stringified for display; skips are owner-facing, not retryable
        /// program state.
        public let reason: String

        /// Memberwise; public so tests and executor fakes can construct skips directly.
        public init(category: Finding.Category, reason: String) {
            self.category = category
            self.reason = reason
        }
    }

    /// All runners' issues, concatenated in runner-declaration order (not sorted here — display
    /// ordering is the UI's decision).
    public let findings: [Finding]
    /// Categories whose runner completed, even with zero findings — the distinction that lets
    /// "clean" mean "checked and clean" rather than "never checked".
    public let runnersExecuted: [Finding.Category]
    /// Categories whose runner threw; see ``SkippedRunner``.
    public let runnersSkipped: [SkippedRunner]

    /// Memberwise; assembled by `AuditCommand.audit(siteID:siteDirectory:onProgress:)` in
    /// production, directly by tests.
    public init(
        findings: [Finding],
        runnersExecuted: [Finding.Category],
        runnersSkipped: [SkippedRunner]
    ) {
        self.findings = findings
        self.runnersExecuted = runnersExecuted
        self.runnersSkipped = runnersSkipped
    }
}

public extension AuditReport {
    /// A deterministic one-line overview of the findings — never throws, stable for a given report.
    /// e.g. "1 accessibility issue, 3 SEO issues. The performance check couldn't run."
    var summary: String {
        if findings.isEmpty && runnersSkipped.isEmpty {
            return "No issues found."
        }
        let clauses: [String] = Finding.Category.allCases.compactMap { category in
            let count = findings.filter { $0.category == category }.count
            guard count > 0 else { return nil }
            return "\(count) \(Self.displayName(category)) issue\(count == 1 ? "" : "s")"
        }
        var sentence = clauses.isEmpty ? "No issues found in the checks that ran" : clauses.joined(separator: ", ")
        sentence += "."
        if !runnersSkipped.isEmpty {
            sentence += " " + Self.skippedClause(runnersSkipped.map { Self.displayName($0.category) })
        }
        return sentence
    }

    // Explicit switch (not `rawValue`) so a new `Finding.Category` case is a compile error
    // here rather than a silently-wrong display string at runtime.
    private static func displayName(_ category: Finding.Category) -> String {
        switch category {
        case .seo: return "SEO"
        case .security: return "security"
        case .accessibility: return "accessibility"
        case .performance: return "performance"
        }
    }

    private static func skippedClause(_ names: [String]) -> String {
        let joined: String
        switch names.count {
        case 1:
            joined = names[0]
        case 2:
            joined = names[0] + " and " + names[1]
        default:
            // Serial (Oxford) comma before the final "and": "a, b, and c".
            joined = names.dropLast().joined(separator: ", ") + ", and " + (names.last ?? "")
        }
        let verb = names.count == 1 ? "check couldn't" : "checks couldn't"
        return "The \(joined) \(verb) run."
    }
}
