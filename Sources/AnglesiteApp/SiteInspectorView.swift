import SwiftUI
import WebKit
import AnglesiteCore

/// Which unified-inspector tab is showing. `String` raw value for `@SceneStorage` persistence.
enum SiteInspectorTab: String {
    case metadata, style
}

/// The window's one inspector (#714 slice 3): a Pages-style Metadata | Style tab pair over the
/// current selection — the routed page, the open component, or the selected collection. Content
/// per (selection, tab) follows the spec §4 table; the tab choice persists per window.
struct SiteInspectorView: View {
    let selection: InspectorSelection
    /// The component harness canvas's live webview (nil outside component mode) — threaded to the
    /// Style pane for the ColorPicker scrub preview.
    var canvasWebView: WKWebView?
    /// Dev-server origin for the collection form's feed preview links; nil until the server is up.
    var previewBaseURL: URL?
    @SceneStorage("siteInspector.tab") private var tab: SiteInspectorTab = .metadata

    var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector Tab", selection: $tab) {
                Text("Metadata").tag(SiteInspectorTab.metadata)
                Text("Style").tag(SiteInspectorTab.style)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            Divider()
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch (selection, tab) {
        case (.page(let context), .metadata):
            PageInspectorView(context: context)
        case (.component(let model), .metadata):
            ComponentMetadataInspectorPane(model: model)
        case (.component(let model), .style):
            ComponentStyleInspectorPane(model: model, webView: canvasWebView)
        case (.collection(let inspection), .metadata):
            CollectionInspectorForm(inspection: inspection, previewBaseURL: previewBaseURL)
        case (.page, .style), (.collection, .style):
            // Element-level styling needs an element selection, which only the component canvas
            // provides today; preview-page element selection is the next-phase design (spec §4).
            ContentUnavailableView(
                "Select something on the page", systemImage: "cursorarrow.rays")
        }
    }
}

/// Read-mostly collection properties (spec §6): type, entries, feeds, template, sitemap status.
struct CollectionInspectorForm: View {
    let inspection: CollectionInspection
    var previewBaseURL: URL?

    var body: some View {
        Form {
            LabeledContent("Route", value: inspection.route)
            if let contentTypeName = inspection.contentTypeName {
                LabeledContent("Content Type", value: contentTypeName)
            }
            LabeledContent("Entries", value: "\(inspection.entryCount)")
            if let microformat = inspection.microformat {
                LabeledContent("Template", value: Self.templateDisplayName(microformat))
            }
            Section("Feeds") {
                if inspection.feeds.isEmpty {
                    Text("No feeds").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(inspection.feeds) { feed in
                        if let base = previewBaseURL,
                           let url = URL(string: feed.route, relativeTo: base) {
                            Link(destination: url) {
                                LabeledContent(Self.feedKindLabel(feed.kind), value: feed.route)
                            }
                        } else {
                            LabeledContent(Self.feedKindLabel(feed.kind), value: feed.route)
                        }
                    }
                }
            }
            Section {
                LabeledContent("Sitemap", value: "Not configured")
            }
        }
        .formStyle(.grouped)
    }

    private static func feedKindLabel(_ kind: SiteFileTree.DetectedFeed.Kind) -> String {
        switch kind {
        case .rss: "RSS"
        case .atom: "Atom"
        case .json: "JSON Feed"
        }
    }

    /// "h-entry" → "Hentry" — the template's static-dispatch layout naming (Hentry.astro etc.).
    private static func templateDisplayName(_ microformat: String) -> String {
        let parts = microformat.split(separator: "-")
        guard parts.first == "h", parts.count > 1 else { return microformat }
        return "H" + parts.dropFirst().joined()
    }
}
