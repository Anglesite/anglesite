// Sources/AnglesiteApp/AcknowledgmentsView.swift
import SwiftUI
import AnglesiteCore

/// The "Open Source Acknowledgments…" window (App menu, next to About). Two-pane: a searchable
/// list grouped by ``AttributionSource`` on the left, the selected package's full license text
/// on the right.
struct AcknowledgmentsView: View {
    @State private var model = AcknowledgmentsViewModel()

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selection) {
                ForEach(AttributionSource.allCases, id: \.self) { source in
                    Section(source.displayName) {
                        if model.unavailableSources.contains(source) {
                            Text("Acknowledgments unavailable for this source.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(model.filtered(source)) { attribution in
                                VStack(alignment: .leading) {
                                    Text(attribution.name)
                                    Text(attribution.version)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(
                                    "\(attribution.name), version \(attribution.version), \(attribution.licenseSPDXId ?? "custom license")"
                                )
                                .tag(SelectedAttribution(source: source, id: attribution.id))
                            }
                        }
                    }
                }
            }
            .searchable(text: $model.searchText)
            .navigationTitle("Acknowledgments")
        } detail: {
            if let selection = model.selection, let attribution = model.attribution(withID: selection) {
                AcknowledgmentDetailView(attribution: attribution)
            } else {
                ContentUnavailableView("Select a package to view its license.", systemImage: "doc.text")
            }
        }
        .task { await model.loadAll() }
        .frame(minWidth: 640, minHeight: 420)
    }
}

private struct AcknowledgmentDetailView: View {
    let attribution: OSSAttribution

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(attribution.name)
                    .font(.title2.bold())
                Text(attribution.version)
                    .foregroundStyle(.secondary)
                Text(attribution.licenseSPDXId ?? "Custom License")
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.15), in: Capsule())
                if let homepage = attribution.homepage, let url = URL(string: homepage) {
                    Link("View homepage", destination: url)
                }
                Divider()
                Text(attribution.licenseText)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
