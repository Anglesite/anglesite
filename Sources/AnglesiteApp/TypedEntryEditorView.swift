// Sources/AnglesiteApp/TypedEntryEditorView.swift
import SwiftUI
import AnglesiteCore

/// The schema-driven `Form` body for a typed content entry — one control per field `Kind`, ordered
/// by the descriptor. Hosted inside `PageInspectorView`, which supplies the load/save/conflict
/// chrome. (Previously a full-pane editor; the chrome moved to the inspector.)
struct TypedEntryForm: View {
    @Bindable var model: TypedEntryEditorModel

    var body: some View {
        Form {
            ForEach(scalarFields, id: \.name) { field in
                control(for: field)
            }
            if let body = bodyField {
                Section("Body") {
                    MarkdownTextView(
                        text: model.textBinding(body.name),
                        controller: model.markdownController,
                        // Distinct from the main-pane editor of the same file (different text
                        // scope — body-only vs whole file), so their undo stacks never mix.
                        documentId: model.file.id + "#body",
                        fitsContent: true
                    )
                    .frame(minHeight: 160)
                }
            }
        }
        .formStyle(.grouped)
    }

    private var scalarFields: [ContentTypeField] { model.descriptor.fields.filter { $0.kind != .markdown } }
    private var bodyField: ContentTypeField? { model.descriptor.fields.first { $0.kind == .markdown } }

    @ViewBuilder
    private func control(for field: ContentTypeField) -> some View {
        let label = field.name + (field.required ? " *" : "")
        switch field.kind {
        case .string, .url, .image:
            HStack {
                TextField(label, text: model.textBinding(field.name))
                if field.kind == .image {
                    Button("Choose…") { chooseFile(for: field.name) }
                }
            }
        case .text:
            VStack(alignment: .leading) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                TextField("", text: model.textBinding(field.name), axis: .vertical).lineLimit(2...6)
            }
        case .bool:
            Toggle(label, isOn: model.boolBinding(field.name))
        case .date, .datetime:
            DatePicker(label, selection: model.dateBinding(field.name),
                       displayedComponents: field.kind == .date ? [.date] : [.date, .hourAndMinute])
        case .number:
            TextField(label, text: model.numberBinding(field.name))
        case .stringArray, .imageArray:
            StringListEditor(title: label, items: model.listBinding(field.name),
                             pickFile: field.kind == .imageArray)
        case .markdown:
            EmptyView()   // handled by the Body section
        }
    }

    private func chooseFile(for name: String) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            model.textBinding(name).wrappedValue = url.lastPathComponent
        }
    }
}

/// A minimal add/remove list editor for `stringArray` / `imageArray` fields (tags, hours, album
/// images). Rows carry stable UUID identity so deleting a row never re-binds a surviving row's
/// editor to the wrong item; `rows` mirrors the bound `items` two-way, re-syncing when `items` is
/// replaced externally (e.g. reload-from-disk).
private struct StringListEditor: View {
    let title: String
    @Binding var items: [String]
    var pickFile: Bool

    private struct Row: Identifiable, Equatable {
        let id = UUID()
        var value: String
    }
    @State private var rows: [Row] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            ForEach($rows) { $row in
                HStack {
                    TextField("", text: $row.value)
                    Button(role: .destructive) { rows.removeAll { $0.id == row.id } } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                }
            }
            HStack {
                Button { rows.append(Row(value: "")) } label: { Label("Add", systemImage: "plus.circle") }
                    .buttonStyle(.borderless)
                if pickFile {
                    Button("Choose…") { chooseFile() }
                }
            }
        }
        .onAppear { syncRowsFromItems() }
        .onChange(of: items) { _, new in
            if new != rows.map(\.value) { rows = new.map(Row.init(value:)) }
        }
        .onChange(of: rows) { _, new in
            let mapped = new.map(\.value)
            if mapped != items { items = mapped }
        }
    }

    private func syncRowsFromItems() {
        if items != rows.map(\.value) { rows = items.map(Row.init(value:)) }
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { rows.append(Row(value: url.lastPathComponent)) }
    }
}
