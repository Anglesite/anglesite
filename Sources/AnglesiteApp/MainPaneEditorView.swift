import SwiftUI
import AnglesiteCore

/// Inline editor for a navigator-selected file. `EditorKind.resolve` picks the editor per file:
/// plain text for most files, a dedicated `PlistEditorView`-backed case for `.plist`, and the
/// three-pane `ComponentEditorView` (outline + canvas + inspector) for `.astro` components when
/// `componentContext` is available. State lives in `FileEditorModel` (owned by `SiteWindow`) so
/// navigating away can auto-save and the buffer survives the Preview/Editor toggle. All IO is
/// async/off-main in the model.
struct MainPaneEditorView: View {
    @Bindable var model: FileEditorModel
    /// Non-nil once the preview's runtime is ready; enables the `.component` editor case below.
    /// `nil` falls back to the plain text editor (dev server still starting, or no site window
    /// wiring available, e.g. in previews).
    var componentContext: ComponentEditorContext? = nil
    @Environment(\.controlActiveState) private var controlActiveState
    @FocusState private var isPlainTextEditorFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if let loadError = model.loadError {
                    ContentUnavailableView {
                        Label("Can't open \(model.file.name)", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(loadError)
                    } actions: {
                        Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([model.file.url]) }
                    }
                } else if model.isLoading {
                    ProgressView().controlSize(.small)
                } else {
                    switch EditorKind.resolve(for: model.file) {
                    case .text, .plist:
                        TextEditor(text: $model.text)
                            .font(.system(.body, design: .monospaced))
                            .scrollContentBackground(.hidden)
                            .findNavigator(isPresented: $model.isFindPresented)
                            .focused($isPlainTextEditorFocused)
                            .id(model.file.id)
                            .onChange(of: isPlainTextEditorFocused) { _, focused in
                                if focused {
                                    EditorFocusRegistry.shared.activate(
                                        .plainText(isPresented: $model.isFindPresented), token: model.file.id)
                                } else {
                                    EditorFocusRegistry.shared.resign(token: model.file.id)
                                }
                            }
                    case .markdown:
                        MarkdownTextView(
                            text: $model.text,
                            controller: model.markdownController,
                            documentId: model.file.id
                        )
                    case .component:
                        if let componentContext {
                            ComponentEditorView(file: model.file, context: componentContext, fileEditor: model)
                        } else {
                            TextEditor(text: $model.text)
                                .font(.system(.body, design: .monospaced))
                                .scrollContentBackground(.hidden)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        // Load off-main when the file changes; re-fires for a new file id.
        .task(id: model.file.id) { await model.load() }
        // Re-check the file when the window regains focus — chat/overlay/CLI may have written it.
        .onChange(of: controlActiveState) { _, new in
            if new == .key { Task { await model.checkExternalChange() } }
        }
        // ⌘S is File ▸ Save (SaveCommands), which saves via SiteWindowModel.saveAllEdits() — no
        // per-view hidden shortcut button (it double-registered ⌘S alongside the inspector's, #509).
        .alert("\(model.file.name) changed on disk", isPresented: conflictBinding) {
            // Each button is solely responsible for resolving the conflict; the binding's setter has
            // NO side effect, so a system-initiated dismissal can't silently pick "Keep" (or race the
            // "Reload" action and clear the disk contents before it reads them).
            Button("Keep My Changes", role: .cancel) { model.keepMyChanges() }
            Button("Reload from Disk") { Task { await model.reloadFromDisk() } }
        } message: {
            Text("Another tool edited this file while you had unsaved changes.")
        }
    }

    private var header: some View {
        HStack {
            Label(model.file.name, systemImage: "doc.text")
                .font(.headline)
            if model.isDirty {
                Circle().fill(.secondary).frame(width: 7, height: 7)
                    .help("Unsaved changes")
            }
            Spacer()
            Button("Save") { Task { await model.save() } }
                .disabled(!model.isDirty)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    /// Read-only presentation: the get reflects model state, the set is a no-op. Conflict resolution
    /// happens exclusively in the two alert button actions — never as a binding side effect.
    private var conflictBinding: Binding<Bool> {
        Binding(get: { model.conflictDiskContents != nil }, set: { _ in })
    }
}
