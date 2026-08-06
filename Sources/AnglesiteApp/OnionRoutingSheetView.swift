import SwiftUI
import AnglesiteCore

/// Onion Routing zone settings model. Presents a single toggle for `opportunistic_onion`,
/// reads the current status from Cloudflare, and applies changes with the user's API token.
/// Follows the same domain-input / phase pattern as `HardenModel`/`DomainModel` — the site's
/// package display name is not a domain, so the zone is resolved from user-entered input rather
/// than assumed from the site.
@MainActor
@Observable
final class OnionRoutingModel {
    enum Phase: Equatable {
        case idle
        case loading(domain: String)
        case configured(domain: String, enabled: Bool)
        case saving(domain: String)
        case error(message: String)
    }

    private(set) var phase: Phase = .idle
    var sheetPresented: Bool = false
    var domainInput: String = ""

    private let reader: any CloudflareReading
    private let writer: any CloudflareWriting
    private let keychain: KeychainStore
    private var inFlight: Task<Void, Never>?

    init(
        reader: any CloudflareReading = HTTPCloudflareClient(),
        writer: any CloudflareWriting = HTTPCloudflareClient(),
        keychain: KeychainStore = KeychainStore()
    ) {
        self.reader = reader
        self.writer = writer
        self.keychain = keychain
    }

    var isRunning: Bool {
        switch phase {
        case .loading, .saving: return true
        default: return false
        }
    }

    func openSheet() {
        guard !isRunning else { return }
        phase = .idle
        domainInput = ""
        sheetPresented = true
    }

    func dismissSheet() {
        inFlight?.cancel()
        inFlight = nil
        sheetPresented = false
    }

    /// Matches `HardenModel.retryFromFailed()` — returns to the domain-input step without
    /// clearing what the user already typed.
    func retryFromError() {
        guard !isRunning else { return }
        phase = .idle
    }

    func load() {
        let domain = domainInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !domain.isEmpty, !isRunning else { return }
        phase = .loading(domain: domain)
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.loadOnionRouting(domain: domain)
        }
    }

    func toggle() {
        guard case .configured(let domain, let enabled) = phase else { return }
        guard !isRunning else { return }

        phase = .saving(domain: domain)
        inFlight?.cancel()
        inFlight = Task { @MainActor [weak self] in
            await self?.saveOnionRouting(domain: domain, enabled: !enabled)
        }
    }

    // MARK: - Private

    private func apiToken() async -> String? {
        try? await CloudflareAPICredentials.resolve(secretStore: keychain)
    }

    private func loadOnionRouting(domain: String) async {
        guard let token = await apiToken() else {
            phase = .error(message: "No Cloudflare API token found. Add one in Settings → Credentials.")
            return
        }

        do {
            guard let zoneID = try await reader.resolveZoneID(domain: domain, apiToken: token) else {
                phase = .error(message: "Zone not found for \"\(domain)\". Check the domain and ensure your API token has Zone Read permission.")
                return
            }

            let zoneState = try await reader.zoneState(zoneID: zoneID, domain: domain, apiToken: token)
            phase = .configured(domain: domain, enabled: zoneState.onionRouting)
        } catch let error as CloudflareError {
            phase = .error(message: cloudflareErrorMessage(error))
        } catch {
            phase = .error(message: "Failed to load zone settings: \(error.localizedDescription)")
        }
    }

    private func saveOnionRouting(domain: String, enabled: Bool) async {
        guard let token = await apiToken() else {
            phase = .error(message: "No Cloudflare API token found.")
            return
        }

        do {
            guard let zoneID = try await reader.resolveZoneID(domain: domain, apiToken: token) else {
                phase = .error(message: "Zone not found for \"\(domain)\". Check the domain and ensure your API token has Zone Read permission.")
                return
            }

            try await writer.enableOnionRouting(zoneID: zoneID, enabled: enabled, apiToken: token)
            phase = .configured(domain: domain, enabled: enabled)
        } catch let error as CloudflareError {
            phase = .error(message: cloudflareErrorMessage(error))
        } catch {
            phase = .error(message: "Failed to save zone settings: \(error.localizedDescription)")
        }
    }

    private func cloudflareErrorMessage(_ error: CloudflareError) -> String {
        switch error {
        case .unauthorized:
            return "API token is unauthorized. Check that it has Zone Settings Edit permission."
        case .http(let status):
            return "Cloudflare API returned HTTP \(status)."
        case .api(let message):
            return "Cloudflare API error: \(message)"
        case .malformedResponse:
            return "Unexpected response from Cloudflare API."
        }
    }
}

// MARK: - UI

struct OnionRoutingSheetView: View {
    @Bindable var model: OnionRoutingModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: 520, idealWidth: 580, minHeight: 300, idealHeight: 340)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            statusIcon
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle).font(.headline)
                if let subtitle = headerSubtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch model.phase {
        case .idle:
            Image(systemName: "network").font(.title3)
        case .loading, .saving:
            ProgressView().controlSize(.small)
        case .configured:
            Image(systemName: "checkmark.network").font(.title3)
                .foregroundStyle(.blue)
        case .error:
            Image(systemName: "exclamationmark.network").font(.title3)
                .foregroundStyle(.red)
        }
    }

    private var headerTitle: String {
        switch model.phase {
        case .idle:
            return "Onion Routing"
        case .loading(let domain):
            return "Reading zone settings for \(domain)…"
        case .configured(let domain, _):
            return domain
        case .saving(let domain):
            return "Updating \(domain)…"
        case .error:
            return "Error"
        }
    }

    private var headerSubtitle: String? {
        switch model.phase {
        case .configured(_, let enabled):
            return enabled
                ? "Onion Routing is enabled"
                : "Onion Routing is disabled"
        default:
            return nil
        }
    }

    // MARK: - Content

    private var content: some View {
        Group {
            switch model.phase {
            case .idle:
                domainInputView
            case .loading(let domain):
                loadingView(domain: domain)
            case .configured(_, let enabled):
                toggleView(enabled: enabled)
            case .saving(let domain):
                savingView(domain: domain)
            case .error(let message):
                errorView(message: message)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var domainInputView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "network").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("Onion Routing")
                .font(.headline)
            Text("Cloudflare's Onion Routing lets Tor Browser users reach your site over the Tor network without exiting through a third-party relay. No changes to your site or URLs.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
            TextField("example.com", text: $model.domainInput)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 300)
                .onSubmit { model.load() }
            Spacer()
        }
        .padding(16)
    }

    private func toggleView(enabled: Bool) -> some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "network").font(.system(size: 40)).foregroundStyle(.primary)
            Text("Lets Tor Browser users reach your site over the Tor network without exiting through a third-party relay. No changes to your site or URLs.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
            Toggle(isOn: Binding(
                get: { enabled },
                set: { _ in model.toggle() }
            )) {
                Text("Enable Onion Routing")
                    .font(.subheadline)
            }
            .toggleStyle(.switch)
            .disabled(model.isRunning)
            Spacer()
        }
        .padding(16)
    }

    private func loadingView(domain: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            ProgressView().controlSize(.large)
            Text("Reading \(domain) zone settings from Cloudflare…")
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(16)
    }

    private func savingView(domain: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            ProgressView().controlSize(.large)
            Text("Updating \(domain) zone settings in Cloudflare…")
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(16)
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "exclamationmark.network").font(.system(size: 40)).foregroundStyle(.red)
            Text("Failed to load zone settings")
                .font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
            Spacer()
        }
        .padding(16)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            switch model.phase {
            case .idle:
                Button("Load") {
                    model.load()
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.domainInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            case .loading:
                EmptyView()
            case .configured(_, let enabled):
                Button(enabled ? "Disable" : "Enable") {
                    model.toggle()
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isRunning)
            case .saving:
                EmptyView()
            case .error:
                Button("Try Again") {
                    model.retryFromError()
                }
                .buttonStyle(.borderedProminent)
            }

            Spacer()

            Button("Close") {
                model.dismissSheet()
            }
            .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
