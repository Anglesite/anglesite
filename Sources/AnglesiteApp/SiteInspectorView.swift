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
                        feedRow(feed)
                    }
                }
            }
            Section {
                sitemapRow
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private func feedRow(_ feed: SiteFileTree.DetectedFeed) -> some View {
        if let base = previewBaseURL, let url = URL(string: feed.route, relativeTo: base) {
            Link(destination: url) {
                LabeledContent { Text(feed.route) } label: { Self.feedKindLabel(feed.kind) }
            }
        } else {
            LabeledContent { Text(feed.route) } label: { Self.feedKindLabel(feed.kind) }
        }
    }

    /// The template ships a site-wide `src/pages/sitemap.xml.ts` (#1020/#982) — `sitemapConfigured`
    /// (`SiteFileTree.hasSitemap`) reflects whether that route module actually exists, so
    /// "Configured" links to the live route the same way a feed row does; "Not configured" is a
    /// real probe result now, not a permanent placeholder.
    @ViewBuilder
    private var sitemapRow: some View {
        if inspection.sitemapConfigured {
            if let base = previewBaseURL, let url = URL(string: "/sitemap.xml", relativeTo: base) {
                Link(destination: url) {
                    LabeledContent("Sitemap") { Text("Configured") }
                }
            } else {
                LabeledContent("Sitemap") { Text("Configured") }
            }
        } else {
            LabeledContent("Sitemap") { Text("Not configured") }
        }
    }

    /// Returns `Text`, not `String`: a plain `String`-returning helper passed to
    /// `LabeledContent(_:value:)`'s `StringProtocol` overload never reaches the SwiftUI string
    /// catalog — `SWIFT_EMIT_LOC_STRINGS` only extracts literal `Text` initializer call sites
    /// (and `LocalizedStringKey`/`String(localized:)` calls), and a helper's return value isn't
    /// one even when the case bodies below are themselves literal `Text` calls (#714 final
    /// review — this is why the RSS/Atom/JSON Feed labels never made the catalog before).
    private static func feedKindLabel(_ kind: SiteFileTree.DetectedFeed.Kind) -> Text {
        switch kind {
        case .rss: Text("RSS")
        case .atom: Text("Atom")
        case .json: Text("JSON Feed")
        }
    }

    /// "h-entry" → "Hentry" — the template's static-dispatch layout naming (Hentry.astro etc.).
    private static func templateDisplayName(_ microformat: String) -> String {
        let parts = microformat.split(separator: "-")
        guard parts.first == "h", parts.count > 1 else { return microformat }
        return "H" + parts.dropFirst().joined()
    }
}
