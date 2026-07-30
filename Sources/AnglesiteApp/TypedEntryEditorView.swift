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
        case .objectArray(let memberFields):
            ObjectArrayEditor(title: label, memberFields: memberFields, records: model.recordsBinding(field.name))
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

/// An add/remove list editor for `objectArray` fields — one collapsible-free block per record, each
/// rendering its member fields inline. Rows carry stable UUID identity, mirroring `StringListEditor`,
/// so deleting a row never re-binds a surviving row's editor to the wrong record.
private struct ObjectArrayEditor: View {
    let title: String
    let memberFields: [ContentTypeField]
    @Binding var records: [[String: TypedContentEditor.FieldValue]]

    private struct Row: Identifiable, Equatable {
        let id = UUID()
        var values: [String: TypedContentEditor.FieldValue]
    }
    @State private var rows: [Row] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            ForEach($rows) { $row in
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(memberFields, id: \.name) { field in
                        memberControl(for: field, in: $row.values)
                    }
                    HStack {
                        Spacer()
                        Button(role: .destructive) { rows.removeAll { $0.id == row.id } } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary))
            }
            Button { rows.append(Row(values: emptyRecord())) } label: {
                Label("Add", systemImage: "plus.circle")
            }
            .buttonStyle(.borderless)
        }
        .onAppear { syncRowsFromRecords() }
        .onChange(of: records) { _, new in
            if new != rows.map(\.values) { rows = new.map(Row.init(values:)) }
        }
        .onChange(of: rows) { _, new in
            let mapped = new.map(\.values)
            if mapped != records { records = mapped }
        }
    }

    private func emptyRecord() -> [String: TypedContentEditor.FieldValue] {
        Dictionary(uniqueKeysWithValues: memberFields.map { ($0.name, TypedContentEditor.defaultValue(for: $0.kind)) })
    }

    private func syncRowsFromRecords() {
        if records != rows.map(\.values) { rows = records.map(Row.init(values:)) }
    }

    @ViewBuilder
    private func memberControl(for field: ContentTypeField, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> some View {
        let label = field.name + (field.required ? " *" : "")
        switch field.kind {
        case .bool:
            Toggle(label, isOn: flagBinding(field.name, in: values))
        case .date, .datetime:
            DatePicker(label, selection: dateBinding(field.name, in: values),
                       displayedComponents: field.kind == .date ? [.date] : [.date, .hourAndMinute])
        case .number:
            TextField(label, text: numberBinding(field.name, in: values))
        default:
            TextField(label, text: textBinding(field.name, in: values))
        }
    }

    private func textBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<String> {
        Binding(
            get: { if case .text(let s)? = values.wrappedValue[name] { return s }; return "" },
            set: { values.wrappedValue[name] = .text($0) }
        )
    }

    private func flagBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<Bool> {
        Binding(
            get: { if case .flag(let b)? = values.wrappedValue[name] { return b }; return false },
            set: { values.wrappedValue[name] = .flag($0) }
        )
    }

    private func dateBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<Date> {
        Binding(
            get: { if case .date(let d)? = values.wrappedValue[name] { return d ?? Date() }; return Date() },
            set: { values.wrappedValue[name] = .date($0) }
        )
    }

    private func numberBinding(_ name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) -> Binding<String> {
        Binding(
            get: {
                if case .number(let n)? = values.wrappedValue[name], let n { return String(n) }
                return ""
            },
            set: { values.wrappedValue[name] = .number(Double($0)) }
        )
    }
}
