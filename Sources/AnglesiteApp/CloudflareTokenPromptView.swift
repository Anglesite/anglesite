import SwiftUI
import AnglesiteCore

/// Progress of verifying a pasted Cloudflare token, consumed by `CloudflareTokenPromptView`'s
/// status line and button-enabled logic. A token is only persisted once verification reaches
/// `.connected`; a `.failed` state keeps the sheet open and leaves storage untouched. Shared
/// between every Cloudflare token-prompt flow (`DeployModel`, `BuyDomainModel`) rather than
/// nested in one model, since the view itself is shared.
enum CloudflareTokenVerification: Equatable {
    case idle
    case checking
    case connected(accountName: String?)
    case failed(message: String)
}

/// First-deploy modal: guide the user through creating a Cloudflare API token, verify it against
/// Cloudflare, store it in the Keychain, and let the parked deploy proceed. Surfaced by
/// `DeployModel` when both the env var and the Keychain are empty at the moment the user clicks
/// Deploy.
///
/// The hard part for newcomers isn't pasting — it's knowing *which* token to make. So step 1 links
/// to a pre-filled Cloudflare token form that creates a custom token named "Anglesite" covering
/// deploy + harden + the integration wizards (`AnglesiteTokenTemplate`), and the numbered steps
/// describe that pre-fill by hand in case the (undocumented) pre-fill ever stops working. The token
/// isn't trusted on faith: `DeployModel.verifyAndSaveToken` runs `wrangler whoami` before
/// persisting, so a bad token is caught here instead of failing later inside the deploy.
///
/// The view is intentionally narrow — it only onboards the token. Long-term management (replacing,
/// clearing) happens in Settings → Advanced → Credentials, which shares the same `KeychainStore`
/// slot, so a token saved from either entry point is immediately usable by `wrangler deploy`.
struct CloudflareTokenPromptView: View {
    let tokenVerification: CloudflareTokenVerification
    let onSubmit: (String) async -> Void
    let onCancel: () -> Void

    @State private var token: String = ""
    @FocusState private var fieldFocused: Bool

    /// True once a verification is in flight (`.checking`) and during the brief success flash
    /// (`.connected`) — i.e. whenever the field and submit button should be locked so the user
    /// can't edit or re-submit mid-verify.
    private var isInputLocked: Bool {
        switch tokenVerification {
        case .checking, .connected: return true
        case .idle, .failed: return false
        }
    }

    private var canSubmit: Bool {
        !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isInputLocked
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Connect to Cloudflare")
                    .font(.headline)
                Text("Deploying needs a one-time API token. It takes about a minute.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 10) {
                step(1) {
                    Link(destination: AnglesiteTokenTemplate.createTokenURL) {
                        Label("Open Cloudflare API tokens", systemImage: "arrow.up.forward.app")
                    }
                }
                step(2) {
                    Text("A custom token named “Anglesite” should be pre-filled with all permissions Anglesite uses. If it isn’t, add at least the “Edit Cloudflare Workers” template’s permissions so deploying works — Anglesite will ask again when a feature needs more access. Click **Continue to summary**.")
                }
                step(3) {
                    Text("Click **Create Token**, then copy it and paste it below.")
                }
            }
            .font(.callout)
            .fixedSize(horizontal: false, vertical: true)

            SecureField("API token", text: $token, prompt: Text("paste token"))
                .textFieldStyle(.roundedBorder)
                .focused($fieldFocused)
                .disabled(isInputLocked)
                .onSubmit { submit() }

            status
                .frame(minHeight: 16, alignment: .leading)

            HStack {
                Spacer()
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)
                Button("Connect & deploy") {
                    submit()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(!canSubmit)
            }
        }
        .padding(20)
        .frame(width: 460)
        .task { fieldFocused = true }
    }

    /// A numbered step: a right-aligned plain digit followed by its content.
    @ViewBuilder
    private func step(_ index: Int, @ViewBuilder content: () -> some View) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(index)")
                .font(.callout.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 16, alignment: .trailing)
            content()
        }
    }

    @ViewBuilder
    private var status: some View {
        switch tokenVerification {
        case .idle:
            EmptyView()
        case .checking:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Checking token…").foregroundStyle(.secondary)
            }
            .font(.footnote)
        case .connected(let accountName):
            Label(
                accountName.map { "Connected to \($0)" } ?? "Token verified",
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

    private func submit() {
        guard canSubmit else { return }
        Task { await onSubmit(token) }
    }
}

#Preview {
    CloudflareTokenPromptView(tokenVerification: .idle, onSubmit: { _ in }, onCancel: {})
}
