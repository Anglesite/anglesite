import Foundation

/// Maps a deploy's current milestone to how many of the three phase-progress-strip panels
/// (see docs/superpowers/specs/2026-07-28-phase-progress-panels-design.md) should read as
/// filled.
///
/// Deliberately NOT built on `DeployDockProgress.fraction(forPhase:)`
/// (`Sources/AnglesiteCore/CompletionNotice.swift`): that table has no entry for
/// `websubPing`/`activityPubBackfill` (returns `nil`, meant for "don't move the Dock tile"
/// semantics), which would regress this panel count from 2 back to 1 on those two late-stage
/// milestones. This is a small, self-contained switch over the known milestone-phase strings
/// instead, with an unrecognized phase defaulting forward to 2 rather than back to 1 — a milestone
/// this function doesn't recognize by name is still assumed to be past "deploying," since new
/// milestones only ever get added after that step in practice.
public enum DeployPanelProgress {
    /// `succeeded` takes priority — a finished deploy always shows all three panels filled,
    /// regardless of the last milestone phase seen.
    public static func filledCount(currentMilestonePhase phase: String?, succeeded: Bool) -> Int {
        if succeeded { return 3 }
        switch phase {
        case nil: return 0
        case OperationProgress.deployPreflight.phase, OperationProgress.deployBuilding.phase: return 1
        default: return 2
        }
    }
}
