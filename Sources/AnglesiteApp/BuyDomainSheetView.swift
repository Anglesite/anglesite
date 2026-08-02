import SwiftUI
import AnglesiteCore

/// The "Buy a Domain" sheet (#1195): search, price, confirm, purchase. Reached from
/// `ConnectDomainSheetView`'s "Buy a domain" button.
struct BuyDomainSheetView: View {
    @Bindable var model: BuyDomainModel

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
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
        // Stacked on top of this already-open sheet (not a sibling `.sheet` on `SiteWindow`,
        // which can't reliably present two sheets from the same presentation context at once).
        .sheet(isPresented: $model.tokenPromptPresented) {
            CloudflareTokenPromptView(
                tokenVerification: model.tokenVerification,
                onSubmit: { await model.verifyAndSaveToken($0) },
                onCancel: { model.cancelTokenPrompt() }
            )
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.title)
                .foregroundStyle(.blue)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Buy a Domain").font(.title3).fontWeight(.semibold)
                Text("Search, price, and register a domain through Cloudflare.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .searching:
            VStack(alignment: .leading, spacing: 12) {
                searchField(buttonTitle: "Search")
                escapeHatch
            }

        case .loadingResults:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Searching…").foregroundStyle(.secondary)
            }

        case .results(_, let candidates):
            VStack(alignment: .leading, spacing: 12) {
                if candidates.isEmpty {
                    Text("No results. Try a different search.").foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(candidates) { candidateRow($0) }
                        }
                    }
                    .frame(maxHeight: 280)
                }
                searchField(buttonTitle: "Search Again")
                escapeHatch
            }

        case .confirming(let candidate):
            VStack(alignment: .leading, spacing: 12) {
                Text("Buy \(candidate.name) for \(candidate.priceDisplay ?? "an unknown price")?")
                    .font(.headline)
                Text("This charges the payment method on file for your connected Cloudflare account.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Cancel") { model.cancelConfirm() }
                    Spacer()
                    Button("Buy \(candidate.name)") { model.confirmPurchase() }
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut(.defaultAction)
                }
            }

        case .purchasing:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Purchasing…").foregroundStyle(.secondary)
            }

        case .purchased(let hostname):
            Label("We'll connect \(hostname) on your next Publish.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)

        case .needsAccountSetup(let hostname):
            VStack(alignment: .leading, spacing: 8) {
                Text("Finish setting up billing for \(hostname) in the Cloudflare dashboard, then come back and try again.")
                escapeHatch
            }

        case .stillProcessing(let hostname):
            Text("Still processing \(hostname). Once it finishes, come back and use \"I already own a domain\" with \(hostname) to connect it.")

        case .failed(let reason):
            VStack(alignment: .leading, spacing: 8) {
                Text(reason).foregroundStyle(.red)
                escapeHatch
            }
        }
    }

    private func searchField(buttonTitle: String) -> some View {
        HStack {
            TextField("example", text: $model.queryInput)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.submitSearch() }
            Button(buttonTitle) { model.submitSearch() }
                .disabled(model.queryInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var escapeHatch: some View {
        Link("Buy directly on the Cloudflare dashboard instead", destination: BuyDomainModel.cloudflareDomainsURL)
            .font(.caption)
    }

    @ViewBuilder
    private func candidateRow(_ candidate: BuyDomainModel.DomainCandidate) -> some View {
        Button {
            model.selectCandidate(candidate)
        } label: {
            HStack {
                Text(candidate.name)
                Spacer()
                if candidate.registrable {
                    Text(candidate.priceDisplay ?? "")
                        .foregroundStyle(.secondary)
                } else {
                    Text(candidate.reason ?? "unavailable")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!candidate.registrable)
    }

    private var footer: some View {
        HStack {
            Button("Close") { model.dismissSheet() }
            Spacer()
        }
        .padding(16)
    }
}

#Preview {
    BuyDomainSheetView(model: BuyDomainModel())
}
