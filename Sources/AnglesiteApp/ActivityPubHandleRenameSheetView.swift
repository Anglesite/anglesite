import SwiftUI
import AnglesiteCore

/// Sheet shown when a deploy would change a federated ActivityPub actor's WebFinger handle
/// (#1239, design doc §"Owner-chosen username") — asked in consequences to the owner's
/// followers, per the house rule, rather than silently renaming. Mirrors
/// `WebmentionPaidPlanConfirmationSheetView`'s park-and-retry shape, but offers two ways forward
/// instead of one: keep the handle that's already discoverable, or confirm the switch.
struct ActivityPubHandleRenameSheetView: View {
    let model: DeployModel
    let change: (from: String, to: String)
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Changing your Fediverse handle")
                    .font(.headline)
                Text("This is how people find and follow you across social networks. People already follow you as @\(change.from) — switching to @\(change.to) disconnects them; they'd need to find and follow you again under the new handle.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                Button("Cancel") { onCancel() }
                    .keyboardShortcut(.cancelAction)
                Button("Keep @\(change.from)") {
                    Task { await model.keepCurrentActivityPubHandleAndRetry() }
                }
                Button("Switch to @\(change.to)") {
                    Task { await model.useNewActivityPubHandleAndRetry() }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}

#Preview {
    ActivityPubHandleRenameSheetView(model: DeployModel(), change: (from: "site", to: "example.com"), onCancel: {})
}
