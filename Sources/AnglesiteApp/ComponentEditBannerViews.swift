import SwiftUI

/// The two dismissible write-status banners shared by the unified inspector's component panes
/// (#714 slice 3) — extracted from the retired `ComponentEditorInspectorPane` so the Metadata and
/// Style tabs can each surface them beside the controls that trigger writes.
///
/// "This component changed outside Anglesite" — the edit that triggered a stale-write refusal was
/// never applied; `ComponentEditorModel.applyComponentStyleEdit` already reloaded the latest
/// version, so this just informs the user why their change didn't stick.
struct ComponentConflictBanner: View {
    @Bindable var model: ComponentEditorModel

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(.orange)
            Text("This component changed outside Anglesite — your edit wasn't applied, reloaded the latest version.")
                .font(.caption)
            Spacer()
            Button {
                model.conflict = false
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Dismiss")
        }
        .padding(8)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// Transient, non-fatal banner for a write op that failed for a reason other than staleness
/// (invalid value, drifted `ruleSpan`, transient MCP error). Scoped to the inspector panes so a
/// routine write failure never takes over the whole editor (see `ComponentEditorModel.writeError`).
struct ComponentWriteErrorBanner: View {
    @Bindable var model: ComponentEditorModel
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
            Text(message).font(.caption)
            Spacer()
            Button {
                model.writeError = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Dismiss")
        }
        .padding(8)
        .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }
}
