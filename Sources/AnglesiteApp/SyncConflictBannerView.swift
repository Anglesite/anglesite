import SwiftUI
import AnglesiteCore

/// Non-blocking "this site was edited on two Macs" banner (#881, design doc §3's "Conflict UX"
/// paragraph). Docked at the top of the detail pane — never a sheet or alert, so it never
/// interrupts editing (#881 acceptance criteria: "conflict banner never blocks editing"). A single
/// "Resolve…" action opens `SyncConflictResolutionSheetView`.
struct SyncConflictBannerView: View {
    let fileCount: Int
    let onResolve: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.icloud.fill")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            Text(message)
                .font(.callout)
            Spacer(minLength: 12)
            Button("Resolve…", action: onResolve)
                .controlSize(.small)
                .buttonStyle(.borderedProminent)
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            .accessibilityLabel("Dismiss")
            .help("Hide this banner — the site stays fully editable; reopen it from the sync status icon")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.orange.opacity(0.12), in: Rectangle())
        .overlay(alignment: .bottom) { Divider() }
    }

    private var message: String {
        "This site was edited on two Macs — \(fileCount) file\(fileCount == 1 ? "" : "s") need attention."
    }
}
