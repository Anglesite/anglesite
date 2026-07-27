import SwiftUI
import AnglesiteCore

/// Sheet shown when a deploy needs to provision a Cloudflare Queue for a queue-backed social
/// feature — inbound Webmention's async verification (#359) or the WebSub hub's delivery
/// fan-out (#361). Queues require the Workers **Paid** plan, so the app asks for an explicit
/// one-time acknowledgment before ever calling `wrangler queues create`. Mirrors
/// `WorkerNameConflictSheetView`'s park-and-retry shape.
struct WebmentionPaidPlanConfirmationSheetView: View {
    let model: DeployModel
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Inbound Webmention and WebSub require the Workers Paid plan")
                    .font(.headline)
                Text("Receiving webmentions and pushing feed updates to subscribers both work asynchronously using Cloudflare Queues, which aren't available on the Workers Free plan. Continuing will create the Queues these features need on your connected Cloudflare account.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Spacer()
                Button("Cancel") { onCancel() }
                    .keyboardShortcut(.cancelAction)
                Button("Enable & retry") {
                    Task { await model.acknowledgeWebmentionPaidPlanAndRetry() }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}

#Preview {
    WebmentionPaidPlanConfirmationSheetView(model: DeployModel(), onCancel: {})
}
