import SwiftUI
import AppKit
import AnglesiteCore

struct SettingsView: View {
    var body: some View {
        TabView {
            // General leads (#529): everyday toggles shouldn't hide behind an "Advanced" label.
            GeneralSettingsView()
                .tabItem { Label("General", systemImage: "gearshape") }
            SiriReadinessSettingsView()
                .tabItem { Label("Siri AI", systemImage: "sparkles") }
            AgentsSettingsView()
                .tabItem { Label("Agents", systemImage: "network") }
            AdvancedSettingsView()
                .tabItem { Label("Advanced", systemImage: "gearshape.2") }
        }
        .frame(width: 540, height: 360)
    }
}

/// Everyday preferences: editing assists and accessibility (#529).
private struct GeneralSettingsView: View {
    @AppStorage(AppSettings.Key.autoGenerateAltText) private var autoGenerateAltText: Bool = true
    @AppStorage(AppSettings.Key.autoGeneratePageCopy) private var autoGeneratePageCopy: Bool = true
    @AppStorage(AppSettings.Key.announcesLiveUpdates) private var announcesLiveUpdates: Bool = true
    @AppStorage(AppSettings.Key.notifiesOnCompletion) private var notifiesOnCompletion: Bool = true
    @AppStorage(AppSettings.Key.playsDialupSoundEffect) private var playsDialupSoundEffect: Bool = false

    var body: some View {
        Form {
            Section("Editing") {
                Toggle("Auto-generate alt text for dropped images", isOn: $autoGenerateAltText)
                Text("When you drop an image onto the preview, Anglesite uses Apple's on-device vision model to write descriptive alt text and applies it automatically. Runs locally; requires Apple Intelligence to be enabled. Purely decorative images get empty alt text and role=\"presentation\".")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Toggle("Auto-suggest descriptions for new pages and posts", isOn: $autoGeneratePageCopy)
                Text("When you create a page or post, Anglesite uses Apple's on-device model to suggest a short SEO description. Runs locally; requires Apple Intelligence to be enabled. Falls back to a title-derived description when off or unavailable.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Notifications") {
                Toggle("Notify when site operations finish", isOn: $notifiesOnCompletion)
                Text("Posts a notification when a Deploy, Backup, or Audit finishes while Anglesite is in the background — success or failure. Clicking the notification brings the site's window to the front. Delivery starts quietly; promote or silence Anglesite in System Settings › Notifications.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Sound") {
                Toggle("Play dial-up sound while loading", isOn: $playsDialupSoundEffect)
                Text("Plays a nostalgic dial-up modem sound while the dev server starts up or a deploy is running. Purely decorative — off by default.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Accessibility") {
                Toggle("Announce live updates to VoiceOver", isOn: $announcesLiveUpdates)
                Text("Speaks streaming chat responses (start, and the reply when it finishes) and deploy progress (start, errors, and the final result) as VoiceOver announcements. Turn off if you prefer to read these surfaces by navigating to them yourself.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

/// Configure ACP (Agent Client Protocol) agent connections and pick the active chat backend —
/// Apple Intelligence (on-device) or one of the registered agents (#602).
private struct AgentsSettingsView: View {
    @AppStorage(AppSettings.Key.activeAssistantBackend) private var activeAssistantBackend: String = "foundationModels"
    @State private var agents: [ACPAgentConnection] = []
    @State private var editingAgent: ACPAgentConnection?
    @State private var isPresentingEditor = false
    @State private var loadError: String?

    private let store = ACPAgentStore()

    var body: some View {
        Form {
            Section("Active Model") {
                Picker("Model", selection: $activeAssistantBackend) {
                    Text("Apple Intelligence (On-Device)").tag("foundationModels")
                    ForEach(agents) { agent in
                        Text(agent.name).tag("acp:\(agent.id.uuidString)")
                    }
                }
                .labelsHidden()
            }

            Section("ACP Agents") {
                if agents.isEmpty {
                    Text("No agents configured.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(agents) { agent in
                    LabeledContent(agent.name) {
                        HStack(spacing: 8) {
                            Text(transportSummary(agent.transport))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Button("Edit…") {
                                editingAgent = agent
                                isPresentingEditor = true
                            }
                            Button("Remove") { remove(agent) }
                        }
                    }
                }
                Button("Add Agent…") {
                    editingAgent = nil
                    isPresentingEditor = true
                }
                if let loadError {
                    Text(loadError).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        .task { reload() }
        .sheet(isPresented: $isPresentingEditor) {
            ACPAgentEditorSheet(existing: editingAgent) { saved in
                do {
                    if editingAgent != nil {
                        try store.update(saved)
                    } else {
                        try store.add(saved)
                    }
                    reload()
                } catch {
                    loadError = "couldn't save: \(error.localizedDescription)"
                }
                isPresentingEditor = false
            } onCancel: {
                isPresentingEditor = false
            }
        }
    }

    private func reload() {
        do {
            agents = try store.load()
            loadError = nil
        } catch {
            loadError = "couldn't load agents: \(error.localizedDescription)"
        }
    }

    private func remove(_ agent: ACPAgentConnection) {
        do {
            try store.remove(id: agent.id)
            // Best-effort: clears a `.remote` agent's bearer token so removing the connection
            // doesn't leave it orphaned in the Keychain forever (no-op for `.stdio` agents, which
            // never write one — `SecretStore.delete` of a missing entry is defined as a no-op).
            // A Keychain failure here doesn't block the removal itself, which already succeeded.
            try? KeychainStore().clearACPAgentToken(id: agent.id)
            // Selecting Foundation Models back if the removed agent was active avoids leaving
            // `activeAssistantBackend` pointing at a now-nonexistent agent — `AssistantBackendResolver`
            // would already fall back gracefully, but resetting the picker keeps the UI honest.
            if activeAssistantBackend == "acp:\(agent.id.uuidString)" {
                activeAssistantBackend = "foundationModels"
            }
            reload()
        } catch {
            loadError = "couldn't remove agent: \(error.localizedDescription)"
        }
    }

    private func transportSummary(_ transport: ACPAgentConnection.Transport) -> String {
        switch transport {
        case .stdio(let command, _): return "Local · \(command)"
        case .remote(let url): return "Remote · \(url.absoluteString)"
        }
    }
}

/// Add/edit sheet for one `ACPAgentConnection`. `onSave` receives the fully-formed connection;
/// the remote credential (if any) is written directly to the Keychain here (not threaded back
/// through `onSave`) since it never belongs in the non-secret `ACPAgentStore` record.
private struct ACPAgentEditorSheet: View {
    enum TransportKind: String, CaseIterable { case local = "Local", remote = "Remote" }

    let existing: ACPAgentConnection?
    let onSave: (ACPAgentConnection) -> Void
    let onCancel: () -> Void

    @State private var name: String
    @State private var kind: TransportKind
    @State private var command: String
    @State private var argumentsText: String
    @State private var urlText: String
    // A fresh, STABLE id for a new agent — seeded once via `init` below, not a computed
    // `existing?.id ?? UUID()`. That looks equivalent but is a real bug: `UUID()` in the fallback
    // branch would mint a NEW random id every time the property is read, so the Keychain write
    // (`KeychainTokenRow`'s `write` closure, evaluated at Save time) and the
    // `ACPAgentConnection(id:...)` constructed a few lines later in `save()` would end up with two
    // DIFFERENT ids — silently orphaning the just-saved token.
    @State private var agentID: UUID

    /// Seeds every `@State` property synchronously from `existing` before the first render —
    /// deliberately NOT an `.onAppear { populate() }` pattern, because `KeychainTokenRow`'s own
    /// `.task { await refreshStatus() }` (which reads `agentID` to look up the stored token) has
    /// no guaranteed ordering against a parent's `.onAppear`. Seeding in `init` means `agentID` is
    /// already correct on the very first render, so there is no race to reason about.
    init(existing: ACPAgentConnection?, onSave: @escaping (ACPAgentConnection) -> Void, onCancel: @escaping () -> Void) {
        self.existing = existing
        self.onSave = onSave
        self.onCancel = onCancel

        var kind: TransportKind = .local
        var command = ""
        var argumentsText = ""
        var urlText = ""
        switch existing?.transport {
        case .stdio(let cmd, let arguments):
            kind = .local
            command = cmd
            argumentsText = arguments.joined(separator: " ")
        case .remote(let url):
            kind = .remote
            urlText = url.absoluteString
        case nil:
            break
        }

        _agentID = State(initialValue: existing?.id ?? UUID())
        _name = State(initialValue: existing?.name ?? "")
        _kind = State(initialValue: kind)
        _command = State(initialValue: command)
        _argumentsText = State(initialValue: argumentsText)
        _urlText = State(initialValue: urlText)
    }

    var body: some View {
        Form {
            TextField("Name", text: $name)
            Picker("Transport", selection: $kind) {
                ForEach(TransportKind.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            if kind == .local {
                TextField("Command", text: $command, prompt: Text("claude-code-acp"))
                TextField("Arguments (space-separated)", text: $argumentsText)
            } else {
                TextField("URL", text: $urlText, prompt: Text("https://agent.example.com/acp"))
                KeychainTokenRow(
                    title: "Bearer token",
                    read: { try KeychainStore().readACPAgentToken(id: agentID) },
                    write: { try KeychainStore().writeACPAgentToken($0, id: agentID) },
                    clear: { try KeychainStore().clearACPAgentToken(id: agentID) }
                )
            }

            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
                Button("Save") { save() }
                    .disabled(!isValid)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 420)
    }

    private var isValid: Bool {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        switch kind {
        case .local: return !command.trimmingCharacters(in: .whitespaces).isEmpty
        case .remote: return URL(string: urlText) != nil
        }
    }

    private func save() {
        let transport: ACPAgentConnection.Transport
        switch kind {
        case .local:
            let args = argumentsText.split(separator: " ").map(String.init)
            transport = .stdio(command: command, arguments: args)
        case .remote:
            guard let url = URL(string: urlText) else { return }
            transport = .remote(url: url)
        }
        onSave(ACPAgentConnection(id: agentID, name: name, transport: transport))
    }
}

/// Development overrides, credentials, and diagnostics — the sharp tools (#529).
private struct AdvancedSettingsView: View {
    @AppStorage(AppSettings.Key.sitesRootOverride) private var sitesRootOverride: String = ""
    @AppStorage(AppSettings.Key.debugPaneEnabled) private var debugPaneEnabled: Bool = false
    @AppStorage(AppSettings.Key.lanRuntimeHost) private var lanRuntimeHost: String = ""
    @AppStorage(AppSettings.Key.lanRuntimePreviewPort) private var lanRuntimePreviewPort: String = ""
    @AppStorage(AppSettings.Key.lanRuntimeMCPPort) private var lanRuntimeMCPPort: String = ""

    /// Same visibility rule as the Debug pane (`DebugPaneVisibility`): always present in Debug
    /// builds; in Release only after the diagnostics opt-in. The LAN runtime is dev/test
    /// infrastructure (#589/#601), not a user-facing feature.
    private var showsLANRuntimeSection: Bool {
        #if DEBUG
        return true
        #else
        return debugPaneEnabled
        #endif
    }

    var body: some View {
        Form {
            Section("Sites root") {
                FolderPickerRow(
                    label: "Sites root override",
                    placeholder: "~/Sites/",
                    path: $sitesRootOverride,
                    promptTitle: "Choose sites root directory"
                )
                Text("By default, Anglesite saves new and imported site packages under `~/Sites/`. Override this for development or testing.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Credentials") {
                CloudflareTokenRow()
                Text("Stored in the macOS Keychain under `io.dwk.anglesite`. The token is passed to `wrangler deploy` as `CLOUDFLARE_API_TOKEN` and never written to logs. An exported `CLOUDFLARE_API_TOKEN` in the shell that launched Anglesite takes precedence over this entry.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                KeychainTokenRow(
                    title: "GitHub personal access token",
                    read: { try KeychainStore().readGitHubToken() },
                    write: { try KeychainStore().writeGitHubToken($0) },
                    clear: {
                        try KeychainStore().clearGitHubToken()
                        AppSettings.shared.gitHubAccount = nil
                    },
                    verify: { token in
                        switch await GitHubAPITokenVerifier().verify(token: token) {
                        case .success(let account):
                            AppSettings.shared.gitHubAccount = account
                            return .success(.init(label: account.login, detail: account.name, avatarURL: account.avatarURL))
                        case .failure(let error):
                            return .failure(error.userMessage)
                        }
                    },
                    cachedIdentity: {
                        AppSettings.shared.gitHubAccount.map { .init(label: $0.login, detail: $0.name, avatarURL: $0.avatarURL) }
                    }
                )
                Text("Used to push backups and publish sites to GitHub over HTTPS (the sandboxed app can't run `git` or `gh`, so it pushes in-process with this token). Create a fine-grained token scoped to All repositories with Contents: Read and write and Administration: Read and write access (Administration is needed to create a new repo when publishing) at github.com/settings/tokens. Stored in the macOS Keychain under `io.dwk.anglesite` and never written to logs.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if showsLANRuntimeSection {
                Section("LAN site runtime") {
                    LabeledContent("Runtime host") {
                        TextField("", text: $lanRuntimeHost, prompt: Text("mac-studio.local"))
                            .textFieldStyle(.roundedBorder)
                            .frame(minWidth: 240)
                            .accessibilityLabel("LAN runtime host")
                    }
                    LabeledContent("Preview port") {
                        TextField("", text: $lanRuntimePreviewPort,
                                  prompt: Text("\(LANRuntimeConfiguration.defaultPreviewPort)"))
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 100)
                            .accessibilityLabel("LAN runtime preview port")
                    }
                    LabeledContent("MCP port") {
                        TextField("", text: $lanRuntimeMCPPort,
                                  prompt: Text("\(LANRuntimeConfiguration.defaultMCPPort)"))
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 100)
                            .accessibilityLabel("LAN runtime MCP port")
                    }
                    Text("Dev/test only: when this Mac can't boot the local container runtime (e.g. inside a VM without nested virtualization), Anglesite connects preview and editing to a dev server already running on the named host over the trusted local network. Leave the host blank to disable. Takes effect the next time a site window opens.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Diagnostics") {
                Toggle("Show Debug Pane menu item", isOn: $debugPaneEnabled)
                #if DEBUG
                Text("Debug builds always show the Debug Pane (View → Show Debug Pane, ⌥⌘D) regardless of this setting.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                #else
                Text("Adds View → Show Debug Pane (⌥⌘D), a live tail of every subprocess. Takes effect on the next launch. You can also hold ⌥ while launching Anglesite to reveal it once.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                #endif
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

/// Cloudflare API token row — the Keychain-token row bound to the Cloudflare slot. Verifies
/// against Cloudflare before persisting (same "verify then persist" shape `TokenOnboarding`
/// uses at deploy time) so the row can surface the connected account, not just "token stored".
private struct CloudflareTokenRow: View {
    var body: some View {
        KeychainTokenRow(
            title: "Cloudflare API token",
            read: { try KeychainStore().readCloudflareToken() },
            write: { try KeychainStore().writeCloudflareToken($0) },
            clear: {
                try KeychainStore().clearCloudflareToken()
                AppSettings.shared.cloudflareAccount = nil
            },
            verify: { token in
                // siteDirectory is vestigial on this protocol — verification is a pure API call.
                switch await CloudflareAPITokenVerifier().verify(token: token, siteDirectory: FileManager.default.homeDirectoryForCurrentUser) {
                case .success(let account):
                    AppSettings.shared.cloudflareAccount = account
                    return .success(.init(label: account.name ?? "Verified", detail: account.email, avatarURL: nil))
                case .failure(let error):
                    return .failure(error.userMessage)
                }
            },
            cachedIdentity: {
                AppSettings.shared.cloudflareAccount.map { .init(label: $0.name ?? "Verified", detail: $0.email, avatarURL: nil) }
            }
        )
    }
}

/// Generic Keychain-backed token row (Cloudflare, GitHub). Reads the current state from the
/// Keychain on appear; saves a new value on commit; clears the slot on "Clear". The field stays
/// a `SecureField` so the token doesn't appear in a screen share, but the actual secret bytes
/// only round-trip when the user edits the field — appearing only redacts.
///
/// When `verify` is supplied, `Save` checks the token against the provider's API first and, on
/// success, surfaces the connected account — "Signed in as octocat" with an avatar for GitHub,
/// a checkmark + account name for Cloudflare — instead of a bare "Saved." This mirrors Xcode's
/// Accounts pane, which shows who you're signed in as rather than just "credential stored".
/// `verify` defaults to `nil` — a future token slot with nothing to verify against just omits it
/// and keeps the plain "Saved."/"Token stored" behavior.
private struct KeychainTokenRow: View {
    /// The identity to display after a token verifies. `detail` is a secondary line (e.g. a
    /// GitHub display name, a Cloudflare account email) shown only when it differs from `label`.
    struct Identity: Equatable {
        let label: String
        let detail: String?
        let avatarURL: URL?
    }

    enum VerifyOutcome {
        case success(Identity)
        case failure(String)
    }

    let title: String
    let read: () throws -> String?
    let write: (String) throws -> Void
    let clear: () throws -> Void
    /// A plain `String` failure message, not `Error` — the verify closures wrap already-classified
    /// provider errors (`GitHubTokenVerifyError.userMessage`, `TokenVerifyError.userMessage`) that
    /// have nothing left to inspect, so there's no reason to make the row re-wrap a real `Error`.
    var verify: ((String) async -> VerifyOutcome)? = nil
    /// Reads back a previously verified identity (e.g. `AppSettings.shared.gitHubAccount`) so a
    /// stored token still shows "Signed in as …" on the next launch without re-verifying eagerly.
    var cachedIdentity: () -> Identity? = { nil }

    @State private var token: String = ""
    @State private var status: Status = .unknown
    @State private var savedMessage: String?
    @State private var isBusy = false

    private enum Status: Equatable {
        case unknown
        case present
        case connected(Identity)
        case absent
        case error(String)
    }

    var body: some View {
        LabeledContent(title) {
            VStack(alignment: .trailing, spacing: 6) {
                if case .connected(let identity) = status {
                    connectedLabel(identity)
                }
                HStack(spacing: 8) {
                    SecureField("paste token", text: $token, prompt: Text(promptText))
                        .textFieldStyle(.roundedBorder)
                        .frame(minWidth: 240)
                        .disabled(isBusy)
                        .accessibilityLabel(title)
                        .accessibilityValue(statusDescription)
                    Button("Save") { Task { await save() } }
                        .disabled(token.isEmpty || isBusy)
                    Button("Clear") { doClear() }
                        .disabled(!isStored || isBusy)
                }
                if isBusy {
                    ProgressView().controlSize(.small)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                } else if let savedMessage {
                    Text(savedMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if case .error(let message) = status {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .task { await refreshStatus() }
    }

    private var isStored: Bool {
        switch status {
        case .present, .connected: return true
        case .unknown, .absent, .error: return false
        }
    }

    @ViewBuilder
    private func connectedLabel(_ identity: Identity) -> some View {
        HStack(spacing: 6) {
            if let avatarURL = identity.avatarURL {
                AsyncImage(url: avatarURL) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Circle().fill(Color.secondary.opacity(0.2))
                    }
                }
                .frame(width: 18, height: 18)
                .clipShape(Circle())
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("Signed in as \(identity.label)")
                    .font(.caption)
                if let detail = identity.detail, detail != identity.label {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var promptText: String {
        switch status {
        case .present, .connected: return "•••••••• (stored)"
        case .absent:  return "paste token"
        case .unknown: return ""
        case .error:   return "paste token"
        }
    }

    /// Spoken status for VoiceOver — the redacted `SecureField` prompt isn't announced clearly.
    private var statusDescription: String {
        switch status {
        case .present:                  return "Token stored"
        case .connected(let identity):  return "Signed in as \(identity.label)"
        case .absent:                   return "No token stored"
        case .unknown:                  return "Checking…"
        case .error(let message):       return "Error: \(message)"
        }
    }

    private func refreshStatus() async {
        let stored: String?
        do {
            stored = try read()
        } catch {
            status = .error("couldn't read keychain: \(error)")
            return
        }
        guard let stored else {
            status = .absent
            return
        }
        if let cached = cachedIdentity() {
            status = .connected(cached)
            return
        }
        status = .present
        guard let verify else { return }
        // A token exists but nothing's cached yet — saved before this feature shipped, or via an
        // env-var override some callers use. Best-effort silent backfill: a failure here just
        // leaves the generic "stored" wording rather than surfacing a scary error for an ambient
        // background check the user didn't ask for.
        isBusy = true
        if case .success(let identity) = await verify(stored) {
            status = .connected(identity)
        }
        isBusy = false
    }

    private func save() async {
        let candidate = token
        guard let verify else {
            do {
                try write(candidate)
                token = ""
                status = .present
                savedMessage = "Saved."
            } catch {
                status = .error("couldn't save: \(error)")
                savedMessage = nil
            }
            return
        }
        isBusy = true
        let outcome = await verify(candidate)
        isBusy = false
        switch outcome {
        case .success(let identity):
            do {
                try write(candidate)
                token = ""
                status = .connected(identity)
                savedMessage = nil
            } catch {
                status = .error("couldn't save: \(error)")
            }
        case .failure(let message):
            status = .error(message)
            savedMessage = nil
        }
    }

    private func doClear() {
        do {
            try clear()
            token = ""
            status = .absent
            savedMessage = "Cleared."
        } catch {
            status = .error("couldn't clear: \(error)")
            savedMessage = nil
        }
    }
}

private struct FolderPickerRow: View {
    let label: String
    let placeholder: String
    @Binding var path: String
    let promptTitle: String

    var body: some View {
        LabeledContent(label) {
            HStack(spacing: 8) {
                Text(displayValue)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(path.isEmpty ? .secondary : .primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // The path is middle-truncated for layout; expose the full value to VoiceOver.
                    .accessibilityLabel(label)
                    .accessibilityValue(path.isEmpty ? "Default — \(placeholder)" : path)
                Button("Choose…") { chooseFolder() }
                    .accessibilityLabel("Choose \(label)")
                Button("Clear") { path = "" }
                    .disabled(path.isEmpty)
                    .accessibilityLabel("Clear \(label)")
            }
        }
    }

    private var displayValue: String {
        path.isEmpty ? placeholder : path
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.title = promptTitle
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        if !path.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true)
        }
        if panel.runModal() == .OK, let url = panel.url {
            path = url.path
        }
    }
}

#Preview {
    SettingsView()
}
