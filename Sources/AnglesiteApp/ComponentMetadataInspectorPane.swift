import SwiftUI
import AnglesiteCore

/// Metadata tab of the unified inspector while a component is open (#714 slice 3): the selected
/// node's attributes and the component-level Props form. Extracted from the retired in-pane
/// `ComponentEditorInspectorPane`; the transient add-attribute form state is owned here.
struct ComponentMetadataInspectorPane: View {
    @Bindable var model: ComponentEditorModel
    @State private var newAttrName: String = ""
    @State private var newAttrValue: String = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.conflict {
                    ComponentConflictBanner(model: model)
                }
                if let writeError = model.writeError {
                    ComponentWriteErrorBanner(model: model, message: writeError)
                }
                if let node = model.selectedNode {
                    selectionGroup(node: node)
                } else {
                    Text("Select an element in the canvas")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                propsForm
            }
            .padding(10)
        }
    }

    // MARK: - Selection / attributes

    private func selectionGroup(node: ComponentModel.Node) -> some View {
        GroupBox("Selection") {
            LabeledContent("Kind", value: node.kind.rawValue)
            if let tag = node.tag { LabeledContent("Tag", value: tag) }
            ForEach(node.attrs, id: \.name) { attr in
                HStack(spacing: 4) {
                    Text(attr.name).font(.system(.caption, design: .monospaced)).frame(width: 90, alignment: .leading)
                    TextField("value", text: attrValueBinding(node: node, name: attr.name))
                        .font(.system(.caption, design: .monospaced))
                        .textFieldStyle(.plain)
                        .onSubmit { model.commitAttr(node: node, name: attr.name) }
                    Button(role: .destructive) {
                        model.removeAttr(node: node, name: attr.name)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove Attribute")
                }
            }
            HStack {
                TextField("New attribute name", text: $newAttrName)
                    .font(.system(.caption, design: .monospaced))
                TextField("value", text: $newAttrValue)
                    .font(.system(.caption, design: .monospaced))
                Button("Add") {
                    let name = newAttrName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    Task {
                        await model.setAttr(nodeId: node.id, name: name, value: newAttrValue)
                        newAttrName = ""
                        newAttrValue = ""
                    }
                }
                .disabled(newAttrName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func attrValueBinding(node: ComponentModel.Node, name: String) -> Binding<String> {
        Binding(
            get: { model.attrValueDraft(node: node, name: name) },
            set: { model.setAttrValueDraft($0, node: node, name: name) }
        )
    }

    // MARK: - Props form

    /// Structured Props form (component-editor design spec §4.3): the component's `Props`
    /// interface as name/type/optional/default rows, independent of outline selection — props
    /// belong to the component as a whole, not to any one template node. Edits accumulate in
    /// `model.propsDraft` and commit together via "Save Props".
    private var propsForm: some View {
        GroupBox("Props") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach($model.propsDraft) { $prop in
                    HStack(spacing: 4) {
                        TextField("name", text: $prop.name)
                            .font(.system(.caption, design: .monospaced))
                            .frame(width: 80)
                        TextField("type", text: $prop.type)
                            .font(.system(.caption, design: .monospaced))
                            .frame(width: 70)
                        Toggle("optional", isOn: $prop.optional)
                            .labelsHidden()
                            .help("Optional")
                        TextField("default", text: $prop.defaultValue)
                            .font(.system(.caption, design: .monospaced))
                        Button(role: .destructive) {
                            model.propsDraft.removeAll { $0.id == prop.id }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove Prop")
                    }
                }
                HStack {
                    Button("Add Prop") {
                        model.propsDraft.append(ComponentEditorModel.PropDraft(name: "", type: "string", optional: false, defaultValue: ""))
                    }
                    .font(.caption2)
                    .buttonStyle(.plain)
                    Spacer()
                    Button("Save Props") {
                        Task { await model.savePropsDraft() }
                    }
                    .disabled(!model.propsDraftDirty)
                }
            }
        }
    }
}
