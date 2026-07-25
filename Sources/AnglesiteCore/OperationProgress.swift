import Foundation

/// A structured progress milestone emitted by a command actor at a phase boundary.
///
/// Command actors are the single source of truth for progress (per #238): they call a
/// `ProgressHandler` at each named milestone. The app's `@Observable` models, the App Intents
/// `ProgressReportingIntent` adapter, and tests all consume the same stream. `fraction` is
/// populated only where a real denominator exists (e.g. audit runner *i of n*); otherwise it is
/// `nil` (indeterminate) — never a fabricated percentage.
public struct OperationProgress: Sendable, Equatable {
    public enum Kind: String, Sendable, Equatable {
        case deploy, backup, audit, createContent
    }

    public let kind: Kind
    /// Stable milestone id, e.g. `"building"`. Compared in tests; not shown to users.
    public let phase: String
    /// Human/Siri-readable label, e.g. `"Building site…"`.
    public let label: String
    /// Optional 0...1 completion when determinable; `nil` = indeterminate.
    public let fraction: Double?

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

public extension OperationProgress {
    static let deployPreflight = OperationProgress(kind: .deploy, phase: "preflightScan", label: "Running pre-deploy checks…")
    static let deployBuilding = OperationProgress(kind: .deploy, phase: "building", label: "Building site…")
    static let deployDeploying = OperationProgress(kind: .deploy, phase: "deploying", label: "Deploying to production…")
    static let deployFinalizing = OperationProgress(kind: .deploy, phase: "finalizing", label: "Finishing up…")
    static let deployWebmentions = OperationProgress(kind: .deploy, phase: "webmentions", label: "Sending webmentions…")
    static let deploySyndicating = OperationProgress(kind: .deploy, phase: "syndicating", label: "Syndicating posts…")
    static let deployNotifyingSubscribers = OperationProgress(kind: .deploy, phase: "websubPing", label: "Notifying feed subscribers…")
    static let deployBackfillingActivityPub = OperationProgress(
        kind: .deploy, phase: "activityPubBackfill", label: "Backfilling ActivityPub outbox…"
    )

    static let backupStaging = OperationProgress(kind: .backup, phase: "staging", label: "Staging changes…")
    static let backupCommitting = OperationProgress(kind: .backup, phase: "committing", label: "Committing…")
    static let backupPushing = OperationProgress(kind: .backup, phase: "pushing", label: "Pushing backup…")

    static let auditBuilding = OperationProgress(kind: .audit, phase: "building", label: "Building site…")
    static func auditRunning(category: String, index: Int, of total: Int) -> OperationProgress {
        // Denominator is `total + 1`, not `total`, on purpose: the running phase must never report
        // 1.0 while runners are still executing. Reserving the last slice keeps headroom for the
        // terminal `auditFinalizing` step (summarizing findings) to own completion, so the bar
        // doesn't read "done" before the audit actually is.
        let fraction = total > 0 ? Double(index + 1) / Double(total + 1) : nil
        return OperationProgress(kind: .audit, phase: "running", label: "Checking \(category)…", fraction: fraction)
    }
    static let auditFinalizing = OperationProgress(kind: .audit, phase: "finalizing", label: "Summarizing findings…")

    static let createResolvingRuntime = OperationProgress(kind: .createContent, phase: "resolvingRuntime", label: "Starting the Anglesite plugin…")
    static let createCallingPlugin = OperationProgress(kind: .createContent, phase: "callingPlugin", label: "Creating content…")
    static let createFinalizing = OperationProgress(kind: .createContent, phase: "finalizing", label: "Finishing up…")

}
