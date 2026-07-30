// Sources/AnglesiteApp/PageInspectorView.swift
import SwiftUI
import AnglesiteCore

/// Right-hand inspector content for the selected page. Renders the typed descriptor form or the
/// plain title/description form, wrapped in shared chrome (header + dirty/Save, off-main load,
/// external-change conflict alert; ⌘S arrives via File ▸ Save, see SaveCommands). Phase 1 has a
/// single "Page" section; a tab picker for
/// selection-level editing comes in Phase 3.
struct PageInspectorView: View {
    let context: InspectorContext

    var body: some View {
        switch context {
        case .typed(let model):
            InspectorChrome(model: model) { TypedEntryForm(model: model) }
        case .page(let model):
            InspectorChrome(model: model) { PageMetadataForm(model: model) }
        case .generic(let model):
            InspectorChrome(model: model) { GenericPageInfoForm(model: model) }
        }
    }
}

/// Read-only identity for a page with no editable metadata (e.g. a plain `.astro` page) — see
/// `GenericPageInspectorModel` (#1100).
private struct GenericPageInfoForm: View {
    let model: GenericPageInspectorModel

    var body: some View {
        Form {
            LabeledContent("Route", value: model.route)
            Section {
                Text("This page has no editable metadata yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

/// The form for a plain (non-typed) frontmatter page: title + description.
private struct PageMetadataForm: View {
    @Bindable var model: PageMetadataModel

    var body: some View {
        Form {
            TextField("Title", text: model.titleBinding())
            VStack(alignment: .leading) {
                Text("Description").font(.caption).foregroundStyle(.secondary)
                TextField("", text: model.descriptionBinding(), axis: .vertical).lineLimit(2...6)
            }
        }
        .formStyle(.grouped)
    }
}

/// Shared inspector chrome around any `InspectorEditorModel`. Generic over the concrete model so the
/// form bodies keep their `@Bindable` two-way bindings.
private struct InspectorChrome<M: InspectorEditorModel & Observable, Form: View>: View {
    @Bindable var model: M
    @ViewBuilder var form: () -> Form
    @Environment(\.controlActiveState) private var controlActiveState

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if let loadError = model.loadError {
                    ContentUnavailableView {
                        Label("Can't open \(model.file.name)", systemImage: "exclamationmark.triangle")
                    } description: { Text(loadError) } actions: {
                        Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([model.file.url]) }
                    }
                } else if model.isLoading {
                    ProgressView().controlSize(.small)
                } else {
                    form()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .task(id: model.file.id) { await model.load() }
        .onChange(of: controlActiveState) { _, new in
            if new == .key { Task { await model.checkExternalChange() } }
        }
        // ⌘S is File ▸ Save (SaveCommands), which saves via SiteWindowModel.saveAllEdits() — no
        // per-view hidden shortcut button (it double-registered ⌘S alongside the editor's, #509).
        .alert("\(model.file.name) changed on disk", isPresented: conflictBinding) {
            Button("Keep My Changes", role: .cancel) { model.keepMyChanges() }
            Button("Reload from Disk") { Task { await model.reloadFromDisk() } }
        } message: {
            Text("Another tool edited this file while you had unsaved changes.")
        }
    }

    private var header: some View {
        HStack {
            Label(model.file.name, systemImage: "doc.text").font(.headline)
            if model.isDirty {
                Circle().fill(.secondary).frame(width: 7, height: 7).help("Unsaved changes")
            }
            Spacer()
            Button("Save") { Task { await model.save() } }.disabled(!model.isDirty)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var conflictBinding: Binding<Bool> {
        Binding(get: { model.conflictDiskContents != nil }, set: { _ in })
    }
}
