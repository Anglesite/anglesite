import Foundation

/// A structured progress milestone emitted by a command actor at a phase boundary.
///
/// Command actors are the single source of truth for progress (per #238): they call a
/// `ProgressHandler` at each named milestone. The app's `@Observable` models, the App Intents
/// `ProgressReportingIntent` adapter, and tests all consume the same stream. `fraction` is
/// populated only where a real denominator exists (e.g. audit runner *i of n*); otherwise it is
/// `nil` (indeterminate) — never a fabricated percentage.
public struct OperationProgress: Sendable, Equatable {
    /// Which long-running operation a milestone belongs to. Lets one shared progress pipeline
    /// serve every command actor while consumers (UI, Siri) still branch per operation.
    public enum Kind: String, Sendable, Equatable {
        /// Deploy-to-production pipeline (preflight → build → deploy → post-deploy fan-out).
        case deploy
        /// Git backup (stage → commit → push).
        case backup
        /// Site audit run.
        case audit
        /// Content creation via the plugin path.
        case createContent
    }

    /// The operation this milestone belongs to.
    public let kind: Kind
    /// Stable milestone id, e.g. `"building"`. Compared in tests; not shown to users.
    public let phase: String
    /// Human/Siri-readable label, e.g. `"Building site…"`.
    public let label: String
    /// Optional 0...1 completion when determinable; `nil` = indeterminate.
    public let fraction: Double?

    /// Creates a milestone. Prefer the named constants in the `OperationProgress` extension —
    /// they keep phase ids stable across the emitters and the tests that compare them.
    public init(kind: Kind, phase: String, label: String, fraction: Double? = nil) {
        self.kind = kind
        self.phase = phase
        self.label = label
        self.fraction = fraction
    }
}

/// Synchronous progress sink threaded through the operation services into the command actors.
/// Synchronous (not an `AsyncStream`) so it needs no extra task/continuation plumbing and is
/// trivially captured by a fake in tests. Runs inside the emitting actor's isolation — bridge to
/// MainActor via a `Task` if a consumer touches SwiftUI state.
public typealias ProgressHandler = @Sendable (OperationProgress) -> Void

/// The canonical milestone vocabulary. Emitters and tests share these constants so a phase id
/// can never drift between the actor that reports it and the assertion that checks it.
public extension OperationProgress {
    /// Deploy: running the template's pre-deploy security scan.
    static let deployPreflight = OperationProgress(kind: .deploy, phase: "preflightScan", label: "Running pre-deploy checks…")
    /// Deploy: Astro production build.
    static let deployBuilding = OperationProgress(kind: .deploy, phase: "building", label: "Building site…")
    /// Deploy: uploading the built site to production.
    static let deployDeploying = OperationProgress(kind: .deploy, phase: "deploying", label: "Deploying to production…")
    /// Deploy: wrap-up after the upload succeeds.
    static let deployFinalizing = OperationProgress(kind: .deploy, phase: "finalizing", label: "Finishing up…")
    /// Post-deploy: sending outbound webmentions for newly-live content.
    static let deployWebmentions = OperationProgress(kind: .deploy, phase: "webmentions", label: "Sending webmentions…")
    /// Post-deploy: direct POSSE syndication pass (see ``POSSESyndicationCommand``).
    static let deploySyndicating = OperationProgress(kind: .deploy, phase: "syndicating", label: "Syndicating posts…")
    /// Post-deploy: WebSub ping so feed subscribers learn about the update promptly.
    static let deployNotifyingSubscribers = OperationProgress(kind: .deploy, phase: "websubPing", label: "Notifying feed subscribers…")
    /// Post-deploy: backfilling existing posts into the ActivityPub outbox (#926).
    static let deployBackfillingActivityPub = OperationProgress(
        kind: .deploy, phase: "activityPubBackfill", label: "Backfilling ActivityPub outbox…"
    )

    /// Backup: staging working-tree changes.
    static let backupStaging = OperationProgress(kind: .backup, phase: "staging", label: "Staging changes…")
    /// Backup: creating the commit.
    static let backupCommitting = OperationProgress(kind: .backup, phase: "committing", label: "Committing…")
    /// Backup: pushing to the remote.
    static let backupPushing = OperationProgress(kind: .backup, phase: "pushing", label: "Pushing backup…")

    /// Audit: building the site before runners inspect it.
    static let auditBuilding = OperationProgress(kind: .audit, phase: "building", label: "Building site…")
    /// Audit: runner `index` of `total` executing — the one milestone with a real ``fraction``,
    /// since the audit runner count gives an honest denominator.
    static func auditRunning(category: String, index: Int, of total: Int) -> OperationProgress {
        // Denominator is `total + 1`, not `total`, on purpose: the running phase must never report
        // 1.0 while runners are still executing. Reserving the last slice keeps headroom for the
        // terminal `auditFinalizing` step (summarizing findings) to own completion, so the bar
        // doesn't read "done" before the audit actually is.
        let fraction = total > 0 ? Double(index + 1) / Double(total + 1) : nil
        return OperationProgress(kind: .audit, phase: "running", label: "Checking \(category)…", fraction: fraction)
    }
    /// Audit: summarizing findings — owns the final progress slice ``auditRunning(category:index:of:)``
    /// deliberately reserves.
    static let auditFinalizing = OperationProgress(kind: .audit, phase: "finalizing", label: "Summarizing findings…")

    /// Create content: resolving/starting the plugin runtime.
    static let createResolvingRuntime = OperationProgress(kind: .createContent, phase: "resolvingRuntime", label: "Starting the Anglesite plugin…")
    /// Create content: the plugin call itself.
    static let createCallingPlugin = OperationProgress(kind: .createContent, phase: "callingPlugin", label: "Creating content…")
    /// Create content: wrap-up after the plugin returns.
    static let createFinalizing = OperationProgress(kind: .createContent, phase: "finalizing", label: "Finishing up…")

}
