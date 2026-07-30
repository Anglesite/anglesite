import Foundation
import Observation
import AnglesiteCore

/// Thin, `Identifiable` model driving the scripts/-divergence sheet (design doc §Divergence UX).
/// Holds the queued divergences and forwards each row's decision — no diffing/hashing logic lives
/// here, that's all in `AnglesiteCore` (`TemplateScriptsSyncChecker`/`Applier`). Unlike
/// `DependencyUpdateModel` (one accept-or-skip decision for the whole list), this model tracks a
/// per-row decision and only signals completion once every row has been resolved.
///
/// `onResolve` reports success/failure rather than returning `Void`: a row is only removed (and
/// `onFinished` only fires) once its underlying write has actually succeeded. Silently removing a
/// row whose write failed would tell the owner their file was updated when it wasn't — the exact
/// silent-staleness failure mode #1053 exists to close, just one layer down.
@MainActor
@Observable
final class ScriptSyncModel: Identifiable {
    nonisolated let id = UUID()
    private(set) var pending: [TemplateScriptsDivergence]
    /// Relative paths of the most recent resolve attempt that failed, for the sheet to show an
    /// error indicator on. Cleared for a path as soon as a later attempt on it succeeds.
    private(set) var failedRelativePaths: Set<String> = []
    @ObservationIgnored private let onResolve: (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Bool
    @ObservationIgnored private let onFinished: () -> Void

    init(
        divergences: [TemplateScriptsDivergence],
        onResolve: @escaping (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Bool,
        onFinished: @escaping () -> Void
    ) {
        self.pending = divergences
        self.onResolve = onResolve
        self.onFinished = onFinished
    }

    func update(_ divergence: TemplateScriptsDivergence) {
        resolve(divergence, decision: .update)
    }

    func keepMine(_ divergence: TemplateScriptsDivergence) {
        resolve(divergence, decision: .keepMine)
    }

    private func resolve(_ divergence: TemplateScriptsDivergence, decision: TemplateScriptsSyncApplier.DivergenceDecision) {
        guard pending.contains(where: { $0.id == divergence.id }) else { return }
        guard onResolve(divergence, decision) else {
            failedRelativePaths.insert(divergence.relativePath)
            return
        }
        failedRelativePaths.remove(divergence.relativePath)
        remove(divergence)
    }

    private func remove(_ divergence: TemplateScriptsDivergence) {
        guard !pending.isEmpty else { return }
        pending.removeAll { $0.id == divergence.id }
        if pending.isEmpty { onFinished() }
    }
}

extension ScriptSyncModel {
    /// Sheet copy for one divergent file. Framed around consequences to the site, not git/diff
    /// terms (design doc's guiding principle) — a handful of app-owned files carry a specific
    /// consequence worth naming; everything else falls back to a generic-but-still-consequence-
    /// framed description rather than enumerating all ~40 possible files (YAGNI: most owners will
    /// only ever see zero or one of these at a time).
    struct RowCopy {
        let title: String
        let consequence: String
    }

    static func rowCopy(for relativePath: String) -> RowCopy {
        switch relativePath {
        case "scripts/pre-deploy-check.ts":
            return RowCopy(
                title: "Security Check",
                consequence: "This site's security check has been customized. An update is available "
                    + "with checks it doesn't include yet."
            )
        case "scripts/edge-artifacts.ts":
            return RowCopy(
                title: "AI-Crawler & Licensing Signals",
                consequence: "This site's AI-crawler and content-licensing signals have been customized. "
                    + "An update is available with support for newer settings."
            )
        default:
            return RowCopy(
                title: (relativePath as NSString).lastPathComponent,
                consequence: "This file has been customized. An update is available with changes it doesn't include yet."
            )
        }
    }
}
