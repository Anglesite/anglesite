import SwiftUI
import AnglesiteCore

/// First-deploy modal: sign in to Cloudflare via OAuth, then let the parked deploy proceed.
/// Surfaced by `DeployModel` when neither the env var, an OAuth credential, nor a legacy pasted
/// token is usable at the moment the user clicks Deploy. Replaces `CloudflareTokenPromptView`
/// (#1204) — no dashboard link, no paste field; one button drives the whole flow.
struct CloudflareOAuthSignInView: View {
    let model: DeployModel
    let onCancel: () -> Void

    private var isBusy: Bool {
        switch model.tokenVerification {
        case .checking, .connected: return true
        case .idle, .failed: return false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Connect to Cloudflare")
                    .font(.headline)
                Text("Deploying needs a one-time sign-in to your Cloudflare account.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            status
                .frame(minHeight: 16, alignment: .leading)

            HStack {
                Spacer()
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)
                .disabled(isBusy)
                Button("Sign in with Cloudflare") {
                    Task { await model.signInWithCloudflare() }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(isBusy)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    @ViewBuilder
    private var status: some View {
        switch model.tokenVerification {
        case .idle:
            EmptyView()
        case .checking:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Signing in…").foregroundStyle(.secondary)
            }
            .font(.footnote)
        case .connected(let accountName):
            Label(
                accountName.map { "Connected to \($0)" } ?? "Signed in",
                systemImage: "checkmark.circle.fill"
            )
            .font(.footnote)
            .foregroundStyle(.green)
        case .failed(let message):
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#Preview {
    CloudflareOAuthSignInView(model: DeployModel(), onCancel: {})
}
