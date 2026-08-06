import SwiftUI
import WebKit
import AnglesiteCore

/// Component Editor: outline + harness canvas. The inspector (Metadata/Style, with interactive
/// Styles panel and structure edits) has moved to the window's unified inspector (#714 slice 3) —
/// `ComponentMetadataInspectorPane`/`ComponentStyleInspectorPane`, hosted by `SiteInspectorView`.
///
/// The view layer is a thin renderer over `ComponentEditorModel`, which owns the draft/dirty/
/// commit/debounce state and the drag-and-drop dispatch logic (#824's extraction) — this file
/// wires up mode switching, the load lifecycle, and the two-pane layout. `ComponentEditorOutlinePane`
/// and `ComponentEditorCanvasPane` hold the pane-specific rendering, in their own files, matching
/// the decomposition `SiteGraphExplorerView` already established for this codebase: subviews bind
/// directly to model-owned state rather than mirroring it into view-local `@State`.
struct ComponentEditorView: View {
    @Bindable var model: ComponentEditorModel
    @Bindable var fileEditor: FileEditorModel
    /// Forwards the canvas webview to the host window (for the unified inspector's scrub
    /// preview) in addition to this view's own `webView` state (used for highlight pushes).
    var onWebView: ((WKWebView?) -> Void)? = nil

    private var file: FileRef { model.file }
    private var context: ComponentEditorContext { model.context }

    /// Design (outline + canvas) vs Source (existing text editor) — the escape hatch.
    @State private var mode: Mode = .design
    /// The harness canvas's live `WKWebView`, bubbled up from `ComponentEditorCanvasPane` — used
    /// here to re-highlight the canvas selection, and forwarded to the host window (via
    /// `onWebView`) for the unified inspector's Style pane `ColorPicker` scrub preview. This is
    /// a live UI resource handle, not business state, so it stays `@State` rather than moving
    /// onto the (WebKit-free) model.
    @State private var webView: WKWebView?
    /// Canvas viewport-width preset (design spec §3/§4.2) — "Fill" (the default) matches the
    /// pre-slice-5 behavior of the harness filling the available pane width.
    @State private var viewportPreset: ComponentViewportPreset = .fill
    /// Outline node the "Extract into Component…" sheet is targeting, captured at menu-tap time.
    /// Non-nil presents `ExtractComponentSheet` (design §6.3).
    @State private var extractTarget: ExtractTarget?
    /// Tracks focus on `sourcePane`'s `TextEditor` so Edit ▸ Find can dispatch to it through
    /// `EditorFocusRegistry` (#517) — mirrors `MainPaneEditorView.isPlainTextEditorFocused`.
    @FocusState private var isSourcePaneFocused: Bool

    /// Identifiable wrapper for an outline node id, so `.sheet(item:)` can drive the extract
    /// sheet off which row was right-clicked.
    private struct ExtractTarget: Identifiable {
        let id: String
    }

    enum Mode: String, CaseIterable { case design = "Design", source = "Source" }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            Divider()
            switch mode {
            case .design: designPane
            case .source: sourcePane
            }
        }
        .onChange(of: model.selectedNodeID) { _, newValue in
            highlightInCanvas(nodeID: newValue)
        }
        .onChange(of: model.loadErrorReason) { _, newValue in
            // Design spec §5: an unparseable component degrades to the Source tab with the
            // compiler diagnostic in a banner, rather than a dead-end full-pane error — fixing
            // the syntax error in source is the only way out, so land the user where they can.
            if newValue == .unparseable { mode = .source }
        }
        .sheet(item: $extractTarget) { target in
            ExtractComponentSheet { name in
                // Pass the bare name straight through — the plugin derives the full
                // `src/components/<name>.astro` path itself from `newName`.
                let applied = await model.extractComponent(nodeId: target.id, newName: name)
                // On success the sheet dismisses (nil). On failure, surface the plugin's refusal
                // (invalid-input / already-exists / dynamic-expression / a transient error) captured
                // in `writeError`; a stale refusal leaves `writeError` nil, so fall back to a generic
                // message (the conflict banner explains the reload separately).
                return applied ? nil : (model.writeError ?? "The component couldn't be extracted.")
            }
        }
    }

    @ViewBuilder private var sourcePane: some View {
        VStack(spacing: 0) {
            if model.loadErrorReason == .unparseable, let error = model.loadError {
                parseErrorBanner(message: error)
                Divider()
            }
            // Edit ▸ Find (#517): the same `.findNavigator`/`EditorFocusRegistry` treatment
            // `MainPaneEditorView` uses for its plain-text `.text`/`.plist` path, reusing
            // `fileEditor.isFindPresented` — `fileEditor` here is the very same `FileEditorModel`
            // instance `MainPaneEditorView` passes through for the open `.component` file, so
            // there's no separate find-navigator state to keep in sync. `.id(fileEditor.file.id)`
            // forces a fresh `TextEditor` identity (and thus fresh focus state) when the open file
            // changes, so an old file's focus/find state can't leak onto a newly opened one (the
            // bug #1065 fixed for the plain-text path).
            TextEditor(text: $fileEditor.text)
                .font(.system(.body, design: .monospaced))
                .scrollContentBackground(.hidden)
                .findNavigator(isPresented: $fileEditor.isFindPresented)
                .focused($isSourcePaneFocused)
                .id(fileEditor.file.id)
                .onChange(of: isSourcePaneFocused) { _, focused in
                    if focused {
                        EditorFocusRegistry.shared.activate(
                            .plainText(isPresented: $fileEditor.isFindPresented), token: fileEditor.file.id)
                    } else {
                        EditorFocusRegistry.shared.resign(token: fileEditor.file.id)
                    }
                }
        }
    }

    /// Compiler diagnostic banner shown atop the Source tab when the Design pane couldn't parse
    /// the component (see `sourcePane`). Unlike `conflictBanner`/`writeErrorBanner` it has no
    /// dismiss button — it stays until the underlying syntax error is fixed and the component
    /// reloads clean.
    private func parseErrorBanner(message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.red)
            Text(message)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
            Spacer()
        }
        .padding(8)
        .background(.red.opacity(0.12))
    }

    @ViewBuilder private var designPane: some View {
        if let error = model.loadError {
            if case .notConnected = model.loadErrorReason {
                // Dev server isn't up yet — not a hard failure. `SiteWindowModel
                // .ensureComponentEditorLoaded()`'s `.task` re-fires once
                // `context.baseURL` transitions to non-nil, which retries the load;
                // this is the interim state, matching the canvas's own
                // "Dev Server Starting…" placeholder rather than an error page.
                ContentUnavailableView("Dev Server Starting…", systemImage: "hourglass")
            } else {
                ContentUnavailableView("Can't Open Component", systemImage: "exclamationmark.triangle", description: Text(error))
            }
        } else if model.isLoading || model.model == nil {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            HSplitView {
                ComponentEditorOutlinePane(
                    model: model,
                    onExtract: { extractTarget = ExtractTarget(id: $0) }
                )
                .frame(minWidth: 180, idealWidth: 220)

                ComponentEditorCanvasPane(
                    model: model,
                    context: context,
                    viewportPreset: $viewportPreset,
                    onWebView: { webView = $0; onWebView?($0) }
                )
                .frame(minWidth: 320).layoutPriority(1)
            }
        }
    }

    private func highlightInCanvas(nodeID: String?) {
        guard let webView else { return }
        guard let nodeID,
              let node = model.outlineRows.first(where: { $0.node.id == nodeID })?.node,
              let loc = node.loc
        else {
            webView.evaluateJavaScript("window.anglesiteCanvas?.clear?.()")
            return
        }
        webView.evaluateJavaScript("window.anglesiteCanvas?.highlight?.(\(loc.line), \(loc.column))")
    }
}
