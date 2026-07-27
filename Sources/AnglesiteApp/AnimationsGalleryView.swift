import SwiftUI
import AppKit
import WebKit
import AnglesiteCore

/// Drives the Animations gallery sheet (Website ▸ Animations…, #1007): resolves the bundled
/// template, decodes its curated `@astroanimate/core` catalog, and tracks the selected entry.
/// Catalog load failures (missing/unbundled template, malformed manifest) surface as a plain
/// error view — never a crash — since this is a browse-only surface with no write path.
@MainActor
@Observable
final class AnimationsGalleryModel {
    private(set) var catalog: AnimationCatalog?
    private(set) var templateDirectory: URL?
    private(set) var loadError: String?
    var selectedComponent: String?

    var selectedEntry: AnimationCatalogEntry? {
        guard let selectedComponent, let catalog else { return nil }
        return catalog.entries.first { $0.component == selectedComponent }
    }

    func load() {
        guard catalog == nil, loadError == nil else { return }
        let resolution = TemplateRuntime.resolve()
        guard let templateDirectory = resolution.url else {
            loadError = "The website template isn't available (\(resolution.description))."
            return
        }
        do {
            let catalog = try AnimationCatalog.load(templateDirectory: templateDirectory)
            self.templateDirectory = templateDirectory
            self.catalog = catalog
            selectedComponent = catalog.entries.first?.component
        } catch {
            loadError = "Couldn't load the animations catalog: \(error.localizedDescription)"
        }
    }

    func demoURL(for entry: AnimationCatalogEntry) -> URL? {
        guard let templateDirectory else { return nil }
        return AnimationCatalog.demoURL(templateDirectory: templateDirectory, component: entry.component)
    }
}

/// The Animations gallery sheet (Website ▸ Animations…, #1007): browse the site template's
/// curated, CSP-safe `@astroanimate/core` components, preview each one's prerendered demo, and
/// copy its ready-to-paste snippet. Sidebar groups entries by `AnimationCategory`; detail shows
/// the owner description, key-props table, a live demo `WKWebView`, and Copy Snippet.
struct AnimationsGalleryView: View {
    @State private var model = AnimationsGalleryModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Animations")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .frame(minWidth: 760, minHeight: 520)
        .task { model.load() }
    }

    @ViewBuilder private var content: some View {
        if let loadError = model.loadError {
            ContentUnavailableView(
                "Animations Unavailable",
                systemImage: "sparkles.slash",
                description: Text(loadError))
        } else if let catalog = model.catalog {
            NavigationSplitView {
                sidebar(catalog)
            } detail: {
                if let entry = model.selectedEntry {
                    AnimationDetailView(entry: entry, demoURL: model.demoURL(for: entry))
                } else {
                    ContentUnavailableView(
                        "No Component Selected",
                        systemImage: "wand.and.stars")
                }
            }
        } else {
            ProgressView("Loading animations…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func sidebar(_ catalog: AnimationCatalog) -> some View {
        List(selection: $model.selectedComponent) {
            ForEach(AnimationCategory.allCases, id: \.self) { category in
                let entries = catalog.entries(in: category)
                if !entries.isEmpty {
                    Section(category.displayName) {
                        ForEach(entries) { entry in
                            Text(entry.title).tag(entry.component)
                        }
                    }
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 220)
    }
}

extension AnimationCategory {
    /// Sidebar/section title. RawValue-derived, capitalized (`text` → "Text").
    var displayName: String {
        switch self {
        case .text: "Text"
        case .cards: "Cards"
        case .buttons: "Buttons"
        case .backgrounds: "Backgrounds"
        case .navigation: "Navigation"
        }
    }
}

/// Detail pane for one catalog entry: description, key-props table, live demo, and Copy Snippet.
private struct AnimationDetailView: View {
    let entry: AnimationCatalogEntry
    let demoURL: URL?
    @State private var didCopy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(entry.title).font(.title2.bold())
            Text(entry.ownerDescription).foregroundStyle(.secondary)

            if !entry.keyProps.isEmpty {
                keyPropsTable
            }

            if let demoURL {
                AnimationDemoWebView(url: demoURL)
                    .frame(minHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.separator))
            }

            HStack {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(entry.snippet, forType: .string)
                    didCopy = true
                } label: {
                    Label(didCopy ? "Copied" : "Copy Snippet", systemImage: didCopy ? "checkmark" : "doc.on.doc")
                }
                .onChange(of: entry.component) { _, _ in didCopy = false }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var keyPropsTable: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Key Props").font(.headline)
            ForEach(entry.keyProps.sorted(by: { $0.key < $1.key }), id: \.key) { key, description in
                HStack(alignment: .top, spacing: 6) {
                    Text(key).font(.system(.body, design: .monospaced)).foregroundStyle(.secondary)
                    Text(description)
                }
            }
        }
    }
}

/// Loads a prerendered demo page (self-contained HTML with inline `<style>` only, no `<script>`
/// tags — enforced by the template's curation tests) via `loadFileURL`, scoped to the template
/// directory so the demo's sibling assets (if any) would also resolve.
private struct AnimationDemoWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.isInspectable = true
        loadIfNeeded(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        loadIfNeeded(webView)
    }

    private func loadIfNeeded(_ webView: WKWebView) {
        guard webView.url != url else { return }
        // Read access to the demo file's own directory covers the demo itself; sibling assets
        // (if a future demo needs any) would resolve the same way.
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
}
