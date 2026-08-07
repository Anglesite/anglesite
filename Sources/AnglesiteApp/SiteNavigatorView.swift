import SwiftUI
import AnglesiteCore

/// Xcode-Project-Navigator-style sidebar. Selection is bound to the model; `SiteWindow` reacts to
/// changes and either navigates the preview or opens the editor.
struct SiteNavigatorView: View {
    @Bindable var model: SiteNavigatorModel
    var onDeleteRequested: (NavigatorItem) -> Void
    var onDuplicateRequested: (NavigatorItem) -> Void
    var onRepurposeRequested: (NavigatorItem) -> Void
    var onPublishRequested: (NavigatorItem) -> Void
    var onUnpublishRequested: (NavigatorItem) -> Void
    @FocusState private var editingFocused: Bool

    var body: some View {
        List(selection: $model.selection) {
            OutlineGroup(model.nodes, children: \.children) { node in
                row(for: node)
            }
        }
        .listStyle(.sidebar)
        // Bare Delete key deletes the selection, matching Xcode/Mail/Notes sidebar convention
        // (#674). `deletableSelection()` is nil during inline-rename, so Delete edits the text
        // field there instead — same guard the Return-to-rename affordance above uses. This is
        // also the ONLY Commands-level wiring for content delete (#989): `.onDeleteCommand` is
        // what AppKit's standard Edit ▸ Delete menu item invokes too, so it doubles as that item's
        // handler — a separate Commands `Button("Delete")` alongside it just renders as a second,
        // indistinguishable "Delete" row.
        .onDeleteCommand {
            if let item = model.deletableSelection() {
                onDeleteRequested(item)
            }
        }
        .overlay {
            if model.nodes.isEmpty {
                ContentUnavailableView("No content yet", systemImage: "sidebar.left")
            }
        }
        .background {
            Button("") {
                if let id = model.selection, model.editingItemID == nil, model.canRename(id) {
                    model.beginEditing(id)
                }
            }
            .keyboardShortcut(.return, modifiers: [])
            .hidden()
            // `.hidden()` still exposes the empty-label button to VoiceOver; keep it out of the
            // accessibility tree (it's a keyboard-shortcut affordance, not a real control).
            .accessibilityHidden(true)
            // Disabled while editing: otherwise this default-button shortcut swallows Return
            // before the focused TextField's onSubmit, so commits never fire (#299 review).
            .disabled(model.editingItemID != nil)
        }
        .background {
            // ⌘⌫ as a second key equivalent for the same delete action (#989) — a view-level key
            // command, not a Commands-scene item, so it doesn't add another Edit-menu row.
            Button("") {
                if let item = model.deletableSelection() {
                    onDeleteRequested(item)
                }
            }
            .keyboardShortcut(.delete, modifiers: [.command])
            .hidden()
            .accessibilityHidden(true)
        }
        .alert(
            "Rename failed",
            isPresented: Binding(
                get: { model.renameError != nil },
                set: { if !$0 { model.renameError = nil } }),
            presenting: model.renameError
        ) { _ in
            Button("OK", role: .cancel) { model.renameError = nil }
        } message: { msg in
            Text(msg)
        }
    }

    @ViewBuilder
    private func row(for node: URLTreeNode) -> some View {
        if model.editingItemID == node.id {
            TextField("Title", text: $model.draftTitle)
                .textFieldStyle(.plain)
                .focused($editingFocused)
                .onSubmit { Task { await model.commitEditing() } }
                .onExitCommand { model.cancelEditing() }   // Esc
                .onChange(of: editingFocused) { _, focused in
                    // TextField.onSubmit does not fire reliably inside a sidebar List on macOS — Return is
                    // consumed by the list and only surfaces as focus loss. So commit on focus loss
                    // (Return / Tab / click-away, Finder-style). Esc cancels first via onExitCommand,
                    // which clears editingItemID, so this guard then skips the commit.
                    if !focused && model.editingItemID == node.id {
                        Task { await model.commitEditing() }
                    }
                }
                .task { editingFocused = true }
                .tag(node.id)
        } else if let url = model.fileURL(for: node.id) {
            // Draggable out to Finder/another app (#676) — only rows backed by a single source
            // file (today: page/post `.route` rows) qualify; see `fileURL(for:)`.
            rowLabel(for: node).draggable(url)
        } else {
            rowLabel(for: node)
        }
    }

    private func rowLabel(for node: URLTreeNode) -> some View {
        Label { Text(node.title) } icon: { icon(for: node) }
            .tag(node.id)
            .lineLimit(1)
            .truncationMode(.middle)
            .contextMenu {
                if model.canRename(node.id) {
                    Button("Rename") { model.beginEditing(node.id) }
                }
                if model.canDuplicate(node.id), let item = model.item(for: node.id) {
                    Button("Duplicate") { onDuplicateRequested(item) }
                }
                if model.canRepurpose(node.id), let item = model.item(for: node.id) {
                    Button("Repurpose Post…") { onRepurposeRequested(item) }
                }
                if model.canPublish(node.id), let item = model.item(for: node.id) {
                    Button("Publish") { onPublishRequested(item) }
                }
                if model.canUnpublish(node.id), let item = model.item(for: node.id) {
                    Button("Unpublish") { onUnpublishRequested(item) }
                }
                if model.canDelete(node.id), let item = model.item(for: node.id) {
                    Button("Delete", role: .destructive) { onDeleteRequested(item) }
                }
            }
    }

    /// #714 icon table: globe (website settings) / house (home) / doc.richtext (pages, entries) /
    /// folder (directory) — with a radio-waves badge composed on feed-bearing directories until
    /// the custom symbol from docs/art-briefs/2026-07-13-folder-rss-symbol.md ships.
    @ViewBuilder
    private func icon(for node: URLTreeNode) -> some View {
        switch node.kind {
        case .website:
            Image(systemName: "globe")
        case .home:
            Image(systemName: "house")
        case .page:
            Image(systemName: "doc.richtext")
        case .directory(_, hasFeed: false):
            Image(systemName: "folder")
        case .directory(_, hasFeed: true):
            Image(systemName: "folder")
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "dot.radiowaves.up.forward")
                        .font(.system(size: 7, weight: .bold))
                        .symbolRenderingMode(.monochrome)
                        .padding(1)
                        .background(.background, in: .circle)
                        .accessibilityLabel("Has RSS feed")
                }
        }
    }
}
