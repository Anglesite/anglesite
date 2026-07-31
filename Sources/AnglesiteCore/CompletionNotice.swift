import Foundation

/// A user-facing completion notification for a long-running site operation (Deploy, Backup,
/// Audit) — pure content, independent of UserNotifications, so the wording rules run under
/// `swift test` rather than only in a hosted app test (which CI can't run; see
/// `LiveRegionAnnouncer` for the same boundary). The app-target `CompletionNotifier` renders
/// one of these into a `UNNotificationRequest` (#526).
public struct CompletionNotice: Equatable, Sendable {
    /// Outcome headline ("Deploy Succeeded", "Backup Failed") — the operation and its result,
    /// never the site name, which goes in ``subtitle`` so banners for different sites stay
    /// distinguishable at a glance.
    public let title: String
    /// The site's display name — kept out of ``title`` so the headline stays a fixed,
    /// scannable phrase per outcome.
    public let subtitle: String
    /// The detail line: what happened, where, and (for failures) the reason the user needs in
    /// order to act.
    public let body: String
    /// Site to focus when the notification is clicked — the notifier routes it through
    /// `WindowRouter` so the matching site window is opened/focused.
    public let siteID: String
    /// Stable per-site-per-operation request identifier: a newer outcome for the same operation
    /// on the same site *replaces* the older banner in Notification Center instead of stacking.
    public let identifier: String
    /// True for failed/blocked outcomes — lets the notifier pick a more insistent presentation
    /// (sound) for the outcomes the user actually has to act on.
    public let isFailure: Bool

    /// Memberwise initializer — public for tests; app code should get notices from
    /// ``CompletionNoticeBuilder`` so the wording and identifier conventions stay in one place.
    public init(title: String, subtitle: String, body: String, siteID: String, identifier: String, isFailure: Bool) {
        self.title = title
        self.subtitle = subtitle
        self.body = body
        self.siteID = siteID
        self.identifier = identifier
        self.isFailure = isFailure
    }
}

/// Builds `CompletionNotice`s from operation outcomes. Each operation gets an outcome substrate
/// enum mirroring the app-target model's terminal phases (which `AnglesiteCore` sits below and
/// cannot reference) — only the fields that affect wording are modelled.
public enum CompletionNoticeBuilder {

    // MARK: Deploy

    /// Terminal deploy phases, mirrored from the app-target deploy model (see the type-level
    /// doc for why the mirror exists). Distinguishes ``blocked(failureCount:)`` from plain
    /// failure because a blocked deploy is the security gate doing its job, not an error.
    public enum DeployOutcome: Equatable, Sendable {
        /// Deploy published successfully; `url` is the live site and `duration` the wall time,
        /// rendered via ``CompletionNoticeBuilder/formatDuration(_:)``.
        case succeeded(url: String, duration: TimeInterval)
        /// Deploy errored; `reason` is shown verbatim as the notification body.
        case failed(reason: String)
        /// Pre-deploy security scan blocked the deploy; `failureCount` is the number of
        /// must-fix findings.
        case blocked(failureCount: Int)
    }

    /// Builds the deploy notice. All three outcomes share one identifier (`deploy.<siteID>`) so
    /// a retry's result replaces the earlier banner instead of stacking next to it.
    public static func deploy(siteName: String, siteID: String, outcome: DeployOutcome) -> CompletionNotice {
        let identifier = "deploy.\(siteID)"
        switch outcome {
        case .succeeded(let url, let duration):
            return CompletionNotice(
                title: "Deploy Succeeded",
                subtitle: siteName,
                body: "Published to \(url) in \(formatDuration(duration)).",
                siteID: siteID, identifier: identifier, isFailure: false
            )
        case .failed(let reason):
            return CompletionNotice(
                title: "Deploy Failed",
                subtitle: siteName,
                body: reason,
                siteID: siteID, identifier: identifier, isFailure: true
            )
        case .blocked(let failureCount):
            let noun = failureCount == 1 ? "issue" : "issues"
            return CompletionNotice(
                title: "Deploy Blocked",
                subtitle: siteName,
                body: "Pre-deploy check found \(failureCount) \(noun) that must be fixed before deploying.",
                siteID: siteID, identifier: identifier, isFailure: true
            )
        }
    }

    // MARK: Backup

    /// Terminal backup phases. `noChanges` is its own case — a clean tree is a *successful*
    /// backup that just has nothing to push, and wording it as such avoids the owner reading
    /// "no changes" as a failure.
    public enum BackupOutcome: Equatable, Sendable {
        /// A commit was pushed; the notice shows the short SHA and `remote/branch` so the owner
        /// can find it from any git host's UI.
        case succeeded(commitSHA: String, branch: String, remote: String)
        /// The working tree was already clean — success, with nothing to push.
        case noChanges
        /// Backup errored; `reason` is shown verbatim as the notification body.
        case failed(reason: String)
    }

    /// Builds the backup notice, under the stable identifier `backup.<siteID>` so a newer
    /// outcome replaces the older banner (see ``CompletionNotice/identifier``).
    public static func backup(siteName: String, siteID: String, outcome: BackupOutcome) -> CompletionNotice {
        let identifier = "backup.\(siteID)"
        switch outcome {
        case .succeeded(let sha, let branch, let remote):
            return CompletionNotice(
                title: "Backup Complete",
                subtitle: siteName,
                body: "Pushed commit \(String(sha.prefix(7))) to \(remote)/\(branch).",
                siteID: siteID, identifier: identifier, isFailure: false
            )
        case .noChanges:
            return CompletionNotice(
                title: "Backup Complete",
                subtitle: siteName,
                body: "No changes to back up.",
                siteID: siteID, identifier: identifier, isFailure: false
            )
        case .failed(let reason):
            return CompletionNotice(
                title: "Backup Failed",
                subtitle: siteName,
                body: reason,
                siteID: siteID, identifier: identifier, isFailure: true
            )
        }
    }

    // MARK: Audit

    /// Terminal audit phases. An audit that *found issues* still `succeeded` — findings are the
    /// audit's product, not its failure; `failed` means the audit itself couldn't run.
    public enum AuditOutcome: Equatable, Sendable {
        /// The audit ran to completion; counts per severity bucket drive the summary line
        /// (empty buckets are omitted from the wording).
        case succeeded(criticalCount: Int, warningCount: Int, infoCount: Int)
        /// The audit itself errored before producing findings; `reason` is shown verbatim.
        case failed(reason: String)
    }

    /// Builds the audit notice, under the stable identifier `audit.<siteID>` so a newer outcome
    /// replaces the older banner (see ``CompletionNotice/identifier``).
    public static func audit(siteName: String, siteID: String, outcome: AuditOutcome) -> CompletionNotice {
        let identifier = "audit.\(siteID)"
        switch outcome {
        case .succeeded(let critical, let warning, let info):
            return CompletionNotice(
                title: "Audit Complete",
                subtitle: siteName,
                body: auditSummary(critical: critical, warning: warning, info: info),
                siteID: siteID, identifier: identifier, isFailure: false
            )
        case .failed(let reason):
            return CompletionNotice(
                title: "Audit Failed",
                subtitle: siteName,
                body: reason,
                siteID: siteID, identifier: identifier, isFailure: true
            )
        }
    }

    /// "No issues found." / "Found 2 critical, 1 warning." — empty severity buckets are omitted,
    /// and "info" is invariant (reads as a category, not a countable noun).
    private static func auditSummary(critical: Int, warning: Int, info: Int) -> String {
        var parts: [String] = []
        if critical > 0 { parts.append("\(critical) critical") }
        if warning > 0 { parts.append("\(warning) \(warning == 1 ? "warning" : "warnings")") }
        if info > 0 { parts.append("\(info) info") }
        guard !parts.isEmpty else { return "No issues found." }
        return "Found \(parts.joined(separator: ", "))."
    }

    // MARK: Duration

    /// "12s" under a minute; "1m 05s" above. Whole seconds — sub-second precision is noise in a
    /// notification about an operation that takes tens of seconds.
    public static func formatDuration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        guard total >= 60 else { return "\(total)s" }
        return "\(total / 60)m \(String(format: "%02d", total % 60))s"
    }
}

/// Maps deploy milestones onto Dock-tile progress (#526). The deploy pipeline has fixed
/// milestones (build/feed generation → preflight scan → wrangler → social delivery), so the Dock
/// bar can be *determinate per phase* even though each phase's internal progress is unknown —
/// the fraction is "how far through the pipeline", not a fabricated percentage of wall time.
/// Unknown phases return `nil` → the Dock overlay renders indeterminate.
public enum DeployDockProgress {
    /// Maps a deploy phase's raw name to its pipeline-position fraction, or `nil` for a phase
    /// this table doesn't know (→ indeterminate Dock bar). Keyed by string rather than an enum
    /// so the app-target deploy model's phase type doesn't have to be mirrored down here —
    /// an unrecognized phase degrades gracefully instead of failing to compile.
    public static func fraction(forPhase phase: String) -> Double? {
        switch phase {
        // Fractions are step-start positions, weighted toward the two long steps
        // (npm run build, wrangler deploy) so the bar doesn't sit at ~0 for most of the run.
        case "building": return 0.10
        case "preflightScan": return 0.45
        case "deploying": return 0.55
        case "finalizing": return 0.90
        case "webmentions": return 0.94
        case "syndicating": return 0.97
        default: return nil
        }
    }
}
