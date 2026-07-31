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
            RobotsSettingsSection(route: model.route, noindex: model.noindexBinding(), disallowCrawl: model.disallowCrawlBinding())
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
        // `.language` renders as a plain text field for now, matching `.string` — Task 10 (inspector
        // UI, #956) swaps this arm to the curated `LanguagePicker` control; storage stays identical.
        case .string, .language, .url, .image:
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
    /// In-progress number text per row, per member field — the nested-row counterpart of
    /// `TypedEntryEditorModel.numberDrafts`. Keyed by row identity so two rows editing the same
    /// member field never share (and clobber) each other's draft. Without it a mid-edit draft like
    /// "3." (on its way to "3.5") parses as nil and snaps the field back to empty.
    @State private var numberDrafts: [Row.ID: [String: String]] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            ForEach($rows) { $row in
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(memberFields, id: \.name) { field in
                        memberControl(for: field, in: $row.values, rowID: row.id)
                    }
                    HStack {
                        Spacer()
                        Button(role: .destructive) { removeRow(row.id) } label: {
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
            if new != rows.map(\.values) {
                rows = new.map(Row.init(values:))
                numberDrafts.removeAll()   // rows were replaced wholesale (e.g. reload from disk)
            }
        }
        .onChange(of: rows) { _, new in
            let mapped = new.map(\.values)
            if mapped != records { records = mapped }
        }
    }

    private func removeRow(_ id: Row.ID) {
        rows.removeAll { $0.id == id }
        numberDrafts[id] = nil
    }

    private func emptyRecord() -> [String: TypedContentEditor.FieldValue] {
        Dictionary(uniqueKeysWithValues: memberFields.map { ($0.name, TypedContentEditor.defaultValue(for: $0.kind)) })
    }

    private func syncRowsFromRecords() {
        if records != rows.map(\.values) { rows = records.map(Row.init(values:)) }
    }

    @ViewBuilder
    private func memberControl(for field: ContentTypeField,
                               in values: Binding<[String: TypedContentEditor.FieldValue]>,
                               rowID: Row.ID) -> some View {
        let label = field.name + (field.required ? " *" : "")
        // Exhaustive on purpose — no `default:`. A catch-all rendered the four kinds a member field
        // must not use (see `ContentTypeField.Kind.objectArray`) as an ordinary TextField bound to
        // `.text`, while `TypedContentEditor.decode`/`encode` expect `.list`/`.records` there — a
        // working-looking control that corrupts the record on save. Listing every kind also makes
        // the compiler flag a newly added `Kind` here instead of letting it fall into that trap.
        switch field.kind {
        // `.language` is a permitted scalar member kind, same as `.string` — see the note on the
        // top-level `control(for:)` switch above re: Task 10 swapping in `LanguagePicker`.
        case .string, .language, .text, .url, .image:
            HStack {
                TextField(label, text: textBinding(field.name, in: values))
                if field.kind == .image {
                    Button("Choose…") { chooseFile(for: field.name, in: values) }
                }
            }
        case .bool:
            Toggle(label, isOn: flagBinding(field.name, in: values))
        case .date, .datetime:
            DatePicker(label, selection: dateBinding(field.name, in: values),
                       displayedComponents: field.kind == .date ? [.date] : [.date, .hourAndMinute])
        case .number:
            TextField(label, text: numberBinding(field.name, in: values, rowID: rowID))
        case .markdown, .stringArray, .imageArray, .objectArray:
            // Fail visibly rather than silently. `verbatim:` deliberately: this is a
            // descriptor-authoring diagnostic that no shipped descriptor can reach, not user copy.
            Text(verbatim: "\(field.name) — unsupported member field kind")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func chooseFile(for name: String, in values: Binding<[String: TypedContentEditor.FieldValue]>) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            values.wrappedValue[name] = .text(url.lastPathComponent)
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

    /// Mirrors `TypedEntryEditorModel.numberBinding` one level down: a per-row draft buffer so a
    /// mid-edit unparseable value never clobbers the stored number, and integral display formatting
    /// so a valid "1" doesn't immediately redisplay as "1.0".
    private func numberBinding(_ name: String,
                               in values: Binding<[String: TypedContentEditor.FieldValue]>,
                               rowID: Row.ID) -> Binding<String> {
        Binding(
            get: {
                if let draft = numberDrafts[rowID]?[name] { return draft }
                if case .number(let n)? = values.wrappedValue[name], let n { return Self.displayNumber(n) }
                return ""
            },
            set: { raw in
                numberDrafts[rowID, default: [:]][name] = raw
                let trimmed = raw.trimmingCharacters(in: .whitespaces)
                // Only overwrite the stored value when the draft parses (or is cleared). A mid-edit
                // unparseable draft like "3." must not clobber a previously valid number with nil.
                if trimmed.isEmpty {
                    values.wrappedValue[name] = .number(nil)
                } else if let parsed = Double(trimmed) {
                    values.wrappedValue[name] = .number(parsed)
                }
            }
        )
    }

    /// Integral values render without a trailing ".0"; the magnitude guard avoids the `Int(_:)`
    /// overflow trap. Mirrors `TypedEntryEditorModel.displayNumber` (private there) — keep the two
    /// in step so a number reads identically at top level and inside a record row.
    private static func displayNumber(_ n: Double) -> String {
        if n == n.rounded(), abs(n) < 1e15 { return String(Int(n)) }
        return String(n)
    }
}
