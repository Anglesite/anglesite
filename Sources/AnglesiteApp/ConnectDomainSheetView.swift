import SwiftUI
import AppKit
import Foundation

/// The "Connect a Domain" sheet (#1180) — buy/transfer/later, reachable from the first-publish
/// nudge in `DeployDrawerView` and permanently from `Website ▸ Connect a Domain…`.
struct ConnectDomainSheetView: View {
    @Bindable var model: ConnectDomainModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            footer
        }
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "globe")
                .font(.title)
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Connect a Domain").font(.title3).fontWeight(.semibold)
                Text("Replace the workers.dev address with your own.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .choosing:
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    NSWorkspace.shared.open(ConnectDomainModel.cloudflareDomainsURL)
                    model.chooseBuy()
                } label: {
                    Label("Buy a domain", systemImage: "cart")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)

                Button {
                    model.beginTransfer()
                } label: {
                    Label("I already own a domain", systemImage: "checkmark.seal")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
            }

        case .enteringHostname:
            VStack(alignment: .leading, spacing: 8) {
                TextField("example.com", text: $model.hostnameInput)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { model.submitTransfer() }
                Text("Keep it at your current registrar — you'll add it to Cloudflare and point its nameservers there. We'll connect it automatically on your next Publish once that's done.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Connect") { model.submitTransfer() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.hostnameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

        case .connected(let hostname):
            VStack(alignment: .leading, spacing: 8) {
                Label("We'll connect \(hostname) on your next Publish.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                registrarInfoView
            }
        }
    }

    @ViewBuilder
    private var registrarInfoView: some View {
        switch model.registrarInfo {
        case .idle, .unavailable:
            EmptyView()
        case .loading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Looking up registrar info…")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        case .available(let info):
            VStack(alignment: .leading, spacing: 2) {
                if let registrar = info.registrar {
                    Text("Registrar: \(registrar)")
                }
                if let expiresAt = info.expiresAt {
                    Text("Expires \(Self.formattedExpiration(expiresAt))")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    /// Formats a raw RDAP ISO 8601 `eventDate` for display; falls back to the raw string if it
    /// doesn't parse (an RDAP server returning something non-standard shouldn't blank the field).
    private static func formattedExpiration(_ raw: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    @ViewBuilder
    private var footer: some View {
        HStack {
            if case .connected = model.phase {
                Spacer()
                Button("Done") { model.dismissSheet() }
                    .keyboardShortcut(.defaultAction)
            } else {
                Button("Not now") { model.notNow() }
                Spacer()
            }
        }
        .padding(16)
    }
}
