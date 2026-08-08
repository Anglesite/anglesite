import SwiftUI
import AnglesiteCore

/// Publish-blocked modal: guide the user through creating a GitHub personal access token, verify
/// it against GitHub, store it in the Keychain, and let the parked publish proceed. Surfaced by
/// `PublishModel` when `RepoBootstrap` reports `.needsAuth` — i.e. no token is in the Keychain yet.
///
/// Modeled directly on `CloudflareTokenPromptView`. GitHub has no token-template pre-fill (unlike
/// Cloudflare's `AnglesiteTokenTemplate`), so there's a single numbered step rather than three.
///
/// The view only onboards the token. Long-term management (replacing, clearing) happens in
/// Settings → Advanced → Credentials, which shares the same Keychain slot (`SecretAccounts.gitHubToken`),
/// so a token saved from either entry point is immediately usable here and there.
struct GitHubTokenPromptView: View {
    let model: PublishModel
    let onCancel: () -> Void

    @State private var token: String = ""
    @FocusState private var fieldFocused: Bool

    /// True once a verification is in flight (`.checking`) and during the brief success flash
    /// (`.connected`) — i.e. whenever the field and submit button should be locked so the user
    /// can't edit or re-submit mid-verify.
    private var isInputLocked: Bool {
        switch model.tokenVerification {
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
                Text("Connect to GitHub")
                    .font(.headline)
                Text("Publishing needs a one-time personal access token. It takes about a minute.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 10) {
                step(1) {
                    Link(destination: URL(string: "https://github.com/settings/tokens?type=beta")!) {
                        Label("Open GitHub personal access tokens", systemImage: "arrow.up.forward.app")
                    }
                }
                step(2) {
                    Text("Select **All repositories**, then grant **Contents: Read and write**, **Administration: Read and write** (Administration is what lets a new repo be created), **Repository security advisories: Read**, and **Dependabot alerts: Read** (both let Anglesite show open reports for this repo) — then copy the token and paste it below.")
                }
            }
            .font(.callout)
            .fixedSize(horizontal: false, vertical: true)

            SecureField("Personal access token", text: $token, prompt: Text("paste token"))
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
                Button("Connect & publish") {
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
        switch model.tokenVerification {
        case .idle:
            EmptyView()
        case .checking:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Checking token…").foregroundStyle(.secondary)
            }
            .font(.footnote)
        case .connected(let accountLogin):
            Label(
                accountLogin.map { "Connected to \($0)" } ?? "Token verified",
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
        Task { await model.verifyAndSaveToken(token) }
    }
}

#Preview {
    GitHubTokenPromptView(model: PublishModel(), onCancel: {})
}
