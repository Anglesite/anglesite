import SwiftUI

/// Determinate dev-server startup indicator: a title line, the phase progress strip, a linear
/// progress bar driven by `StartupProgressModel.fraction`, and the current curated phase message
/// beneath it. Replaces the indeterminate spinner the preview pane used to show while `astro dev`
/// booted.
struct StartupProgressView: View {
    let title: String
    let model: StartupProgressModel
    /// When set, a "Show Logs" button appears beneath the status message so the curious can
    /// watch the raw subprocess output while they wait (#560).
    var onShowLogs: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
            PhaseProgressStrip(filledCount: model.phase.panelFillCount)
            ProgressView(value: model.fraction)
                .progressViewStyle(.linear)
                .frame(maxWidth: 320)
            // Fixed height so the layout doesn't jump as messages change; empty between phases.
            Text(model.message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(height: 18)
                .animation(.easeInOut(duration: 0.2), value: model.message)
            if let onShowLogs {
                Button("Show Logs", action: onShowLogs)
                    .buttonStyle(.link)
                    .font(.callout)
                    .accessibilityHint("Opens the live log of the running dev server and dependency installation.")
            }
        }
        .frame(maxWidth: 360)
        .animation(.easeInOut(duration: 0.2), value: model.fraction)
    }
}
