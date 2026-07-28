import Foundation
import AnglesiteCore

/// Thin, `Identifiable` model driving the scripts/-divergence sheet (design doc §Divergence UX).
/// Holds the queued divergences and forwards each row's decision — no diffing/hashing logic lives
/// here, that's all in `AnglesiteCore` (`TemplateScriptsSyncChecker`/`Applier`). Unlike
/// `DependencyUpdateModel` (one accept-or-skip decision for the whole list), this model tracks a
/// per-row decision and only signals completion once every row has been resolved.
@MainActor
final class ScriptSyncModel: Identifiable {
    nonisolated let id = UUID()
    private(set) var pending: [TemplateScriptsDivergence]
    private let onResolve: (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Void
    private let onFinished: () -> Void

    init(
        divergences: [TemplateScriptsDivergence],
        onResolve: @escaping (TemplateScriptsDivergence, TemplateScriptsSyncApplier.DivergenceDecision) -> Void,
        onFinished: @escaping () -> Void
    ) {
        self.pending = divergences
        self.onResolve = onResolve
        self.onFinished = onFinished
    }

    func update(_ divergence: TemplateScriptsDivergence) {
        onResolve(divergence, .update)
        remove(divergence)
    }

    func keepMine(_ divergence: TemplateScriptsDivergence) {
        onResolve(divergence, .keepMine)
        remove(divergence)
    }

    private func remove(_ divergence: TemplateScriptsDivergence) {
        pending.removeAll { $0.id == divergence.id }
        if pending.isEmpty { onFinished() }
    }
}
