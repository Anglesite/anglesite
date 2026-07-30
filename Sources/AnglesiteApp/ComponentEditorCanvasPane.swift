import SwiftUI
import WebKit
import AnglesiteCore
import AnglesiteBridge

/// Center pane: the harness `WKWebView`, the viewport-width preset toolbar, and the knobs bar
/// generated from the component's `Props` interface (design spec §3/§4.2).
///
/// Canvas-originated drops (a palette item dropped directly on the rendered canvas) still need
/// the live `WKWebView` to hit-test via `window.anglesiteCanvas?.dropTargetAt?.(...)` and decode
/// its JSON reply — that JS bridging stays here, unchanged from before this pane existed as its
/// own file. Everything downstream of the decode (resolving the drop target to a node id, the
/// sealed-instance zone redirect, dispatching `insertNode`) lives on `ComponentEditorModel`
/// (`performCanvasDrop`, #824) so it's testable without a live canvas.
struct ComponentEditorCanvasPane: View {
    @Bindable var model: ComponentEditorModel
    let context: ComponentEditorContext
    @Binding var viewportPreset: ComponentViewportPreset
    var onWebView: (WKWebView) -> Void = { _ in }

    /// The harness WKWebView instance, captured via `ComponentCanvasView.onWebView` — needed
    /// locally for `performCanvasDrop`'s JS hit-test, and bubbled up to the parent view (via
    /// `onWebView`) so the outline-selection highlight and the inspector's `ColorPicker` scrub
    /// can also reach it.
    @State private var webView: WKWebView?

    var body: some View {
        VStack(spacing: 0) {
            viewportToolbar
            Divider()
            if let props = model.model?.frontmatter?.props, !props.isEmpty {
                knobsBar(props: props)
                Divider()
            }
            canvasWebView
        }
    }

    /// Device-width preset row above the canvas (design spec §3: "A viewport-width control
    /// (device presets + free resize)…"). "Free resize" isn't implemented in this pass — the
    /// four fixed presets are the "polish" scope issue #495 asks for; a drag handle can follow
    /// as its own increment if needed.
    private var viewportToolbar: some View {
        HStack(spacing: 2) {
            ForEach(ComponentViewportPreset.allCases) { preset in
                Button {
                    viewportPreset = preset
                } label: {
                    Image(systemName: preset.systemImage)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(viewportPreset == preset ? Color.accentColor : Color.secondary)
                .help(preset.label)
            }
            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }

    /// The harness `WKWebView` itself, width-constrained to `viewportPreset.width` when a fixed
    /// preset is active. `.fill` (`width == nil`) renders identically to the pre-slice-5
    /// behavior — no frame constraint, canvas fills the available pane width.
    @ViewBuilder private var canvasWebView: some View {
        // Gated directly on `context.baseURL` (not just `model.harnessURL`)
        // so the live canvas replaces this placeholder the moment the dev
        // server becomes ready, in lockstep with the `loadKey`-driven
        // reload above the whole editor.
        if context.baseURL != nil, let url = model.harnessURL {
            let content = ComponentCanvasView(
                url: url,
                editRouter: context.editRouter,
                onSelection: { model.canvasSelected($0) },
                onComputedStyles: { model.computedStyles = $0.styles },
                onWebView: { newWebView in
                    webView = newWebView
                    onWebView(newWebView)
                }
            )
            .dropDestination(for: OutlineDragPayload.self) { items, location in
                guard let item = items.first, case .insert(let payload) = item, let webView else { return false }
                Task { await performCanvasDrop(payload: payload.kind, location: location, webView: webView) }
                return true
            }
            if let width = viewportPreset.width {
                // Sizes to the split pane's own available height (via GeometryReader) rather
                // than a fixed magic number — a hardcoded height either clipped the canvas on a
                // pane shorter than it, or left dead space below it on a taller one (PR #795
                // review). Horizontal scroll still covers the width-overflow case (preset wider
                // than the pane), which is the whole point of a fixed-width preset.
                GeometryReader { geometry in
                    ScrollView(.horizontal) {
                        content.frame(width: width, height: geometry.size.height)
                    }
                }
            } else {
                content
            }
        } else {
            ContentUnavailableView("Dev Server Starting…", systemImage: "hourglass")
        }
    }

    /// Resolves a canvas drop point to an insertion target via the overlay's `dropTargetAt`, then
    /// hands the raw line/column/zone off to `ComponentEditorModel.performCanvasDrop`, which maps
    /// the source location back to a node id the same way `canvasSelected` does and issues the
    /// `insert-node` op.
    private func performCanvasDrop(payload: ComponentStructureEditBuilder.NodeSpec, location: CGPoint, webView: WKWebView) async {
        let script = "JSON.stringify(window.anglesiteCanvas?.dropTargetAt?.(\(location.x), \(location.y)) ?? null)"
        guard let raw = try? await webView.evaluateJavaScript(script) as? String,
              let data = raw.data(using: .utf8),
              let target = try? JSONDecoder().decode(DropTargetPayload.self, from: data)
        else { return }
        await model.performCanvasDrop(atLine: target.line, column: target.column, zone: target.zone, payload: payload)
    }

    private struct DropTargetPayload: Decodable {
        let file: String?
        let line: Int
        let column: Int
        let zone: String
    }

    private func knobsBar(props: [ComponentModel.Prop]) -> some View {
        ScrollView(.horizontal) {
            HStack {
                ForEach(props, id: \.name) { prop in
                    LabeledContent(prop.name) {
                        knobControl(prop: prop)
                    }
                }
            }
            .padding(8)
        }
    }

    /// Type-aware harness knob control (design spec §4.2): a `boolean` prop gets a `Toggle`,
    /// a `number` prop gets a `Stepper` alongside its text field, and everything else keeps the
    /// plain text field slice 1 shipped. `model.knobValues` stays `[String: String]` regardless
    /// (that's `HarnessURL.build`'s contract) — these controls just read/write it through a
    /// typed `Binding`.
    @ViewBuilder
    private func knobControl(prop: ComponentModel.Prop) -> some View {
        switch prop.type {
        case "boolean":
            Toggle("", isOn: booleanKnobBinding(name: prop.name))
                .labelsHidden()
        case "number":
            HStack(spacing: 2) {
                TextField(prop.type, text: knobBinding(name: prop.name))
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 70)
                Stepper("", value: numberKnobBinding(name: prop.name))
                    .labelsHidden()
            }
        default:
            TextField(prop.type, text: knobBinding(name: prop.name))
                .textFieldStyle(.roundedBorder)
                .frame(width: 120)
        }
    }

    private func knobBinding(name: String) -> Binding<String> {
        Binding(
            get: { model.knobValues[name] ?? "" },
            set: { model.knobValues[name] = $0 }
        )
    }

    private func booleanKnobBinding(name: String) -> Binding<Bool> {
        Binding(
            get: { (model.knobValues[name] ?? "false") == "true" },
            set: { model.knobValues[name] = $0 ? "true" : "false" }
        )
    }

    private func numberKnobBinding(name: String) -> Binding<Double> {
        Binding(
            get: { Double(model.knobValues[name] ?? "") ?? 0 },
            set: { model.knobValues[name] = formatKnobNumber($0) }
        )
    }

    /// Drops a redundant trailing ".0" for whole numbers so an integer-typed prop's knob (e.g.
    /// `count`) round-trips as "2", not "2.0".
    private func formatKnobNumber(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
    }
}

/// Harness-page WKWebView: same bridge as the preview, wired to the
/// component-canvas handlers. Routes edits (e.g. a Styles panel change)
/// through `editRouter` when the site window has wired one up;
/// falls back to `LoggingEditRouter()` — logs to the Debug pane instead of
/// applying — when it hasn't (dev server not started yet, or a context that
/// intentionally has no write capability).
private struct ComponentCanvasView: NSViewRepresentable {
    let url: URL
    var editRouter: EditRouter?
    let onSelection: @MainActor (CanvasSelectionMessage) -> Void
    let onComputedStyles: @MainActor (ComputedStylesReport) -> Void
    var onWebView: (WKWebView) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor
    final class Coordinator {
        var loadedURL: URL?
        /// Debounces reloads triggered by rapid `url` changes (e.g. a knob TextField's
        /// per-keystroke `harnessURL`, which folds prop edits into the query string) so each
        /// keystroke doesn't fire a full `webView.load()`. Cancelled and restarted on every
        /// further change; only the settled URL after a short pause actually reloads.
        var pendingReload: Task<Void, Never>?
    }

    func makeNSView(context: Context) -> WKWebView {
        let onSelection = self.onSelection
        let onComputedStyles = self.onComputedStyles
        let handler = AnglesiteScriptHandler(
            router: resolveEditRouter(editRouter),
            onCanvasSelection: { message in await MainActor.run { onSelection(message) } },
            onComputedStyles: { report in await MainActor.run { onComputedStyles(report) } }
        )
        let configuration = WebViewBridge.localDevConfiguration(handler: handler)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        WebViewBridge.applyPreviewDefaults(to: webView)
        webView.load(URLRequest(url: url))
        context.coordinator.loadedURL = url
        // Cross-file contract: `onWebView` must fire only from here, never from `updateNSView`
        // below. This callback is the source of `SiteWindow.componentCanvasWebView` (threaded
        // through `MainPaneEditorView`'s `onCanvasWebView`), and that window's activation `.task`
        // relies on it firing synchronously during THIS render commit — same-key reappearances
        // (e.g. a Preview↔Editor toggle) depend on `makeNSView` re-reporting the still-live
        // webview before the async task body decides whether to clear it (#714 final review,
        // Important 1). If webview reporting ever needs to happen from `updateNSView` too,
        // revisit `SiteWindow.mainPaneContent`'s activation task first.
        onWebView(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedURL != url else { return }
        let targetURL = url
        let coordinator = context.coordinator
        coordinator.pendingReload?.cancel()
        coordinator.pendingReload = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            coordinator.loadedURL = targetURL
            coordinator.pendingReload = nil
            webView.load(URLRequest(url: targetURL))
        }
    }
}
