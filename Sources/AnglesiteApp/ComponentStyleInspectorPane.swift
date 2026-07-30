import SwiftUI
import WebKit
import AnglesiteCore

/// Style tab of the unified inspector while a component is open (#714 slice 3): the component's
/// scoped style rules (grouped by media, editable) and the selected element's computed values.
/// Extracted from the retired in-pane `ComponentEditorInspectorPane`; the transient add-rule and
/// collapse state is owned here.
///
/// `webView` is read-only — the harness canvas's live handle, used only to push a live scrub
/// preview while a `ColorPicker` drags; the model has no webview handle of its own.
struct ComponentStyleInspectorPane: View {
    @Bindable var model: ComponentEditorModel
    var webView: WKWebView?
    @State private var newRuleSelector: String = ""
    @State private var newRuleMedia: String = ""
    @State private var collapsedMediaKeys: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.conflict {
                    ComponentConflictBanner(model: model)
                }
                if let writeError = model.writeError {
                    ComponentWriteErrorBanner(model: model, message: writeError)
                }
                stylesGroup
                computedGroup
            }
            .padding(10)
        }
    }

    // MARK: - Styles panel

    private var stylesGroup: some View {
        GroupBox("Styles") {
            if let styles = model.model?.styles, !styles.isEmpty {
                let groups = ComponentStyleGrouping.groups(from: styles)
                ForEach(Array(groups.enumerated()), id: \.offset) { groupIndex, group in
                    DisclosureGroup(isExpanded: mediaExpandedBinding(for: group.media)) {
                        ForEach(Array(group.rules.enumerated()), id: \.element.index) { position, indexed in
                            ruleRow(ruleIndex: indexed.index, rule: indexed.rule)
                            if position < group.rules.count - 1 {
                                Divider()
                            }
                        }
                    } label: {
                        Text(group.media.map { "@media \($0)" } ?? "Base styles")
                            .font(.caption).bold()
                    }
                    if groupIndex < groups.count - 1 {
                        Divider()
                    }
                }
            } else {
                Text("No scoped styles").foregroundStyle(.secondary)
            }
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    TextField("New selector, e.g. .card-footer", text: $newRuleSelector)
                        .font(.system(.caption, design: .monospaced))
                    TextField("Condition, e.g. (min-width: 768px)", text: $newRuleMedia)
                        .font(.system(.caption, design: .monospaced))
                }
                Button("Add rule") {
                    let selector = newRuleSelector.trimmingCharacters(in: .whitespaces)
                    guard !selector.isEmpty else { return }
                    let media = ComponentStyleGrouping.normalizeMediaCondition(newRuleMedia)
                    Task {
                        await model.addStyleRule(selector: selector, media: media.isEmpty ? nil : media, declarations: [])
                        newRuleSelector = ""
                        newRuleMedia = ""
                    }
                }
                .disabled(newRuleSelector.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    /// Stable dictionary/Set key for a media group — `""` for the unscoped "Base styles" group,
    /// the media condition string otherwise. Mirrors `ComponentStyleGrouping.groups`' own
    /// `key.isEmpty ? nil : key` convention so the two stay in sync.
    private func mediaGroupKey(_ media: String?) -> String { media ?? "" }

    /// Expand/collapse binding for one media group's `DisclosureGroup`, backed by
    /// `collapsedMediaKeys` — defaults to expanded (absent from the set) so the panel reads the
    /// same as the old always-expanded flat list until the user explicitly collapses a section.
    private func mediaExpandedBinding(for media: String?) -> Binding<Bool> {
        let key = mediaGroupKey(media)
        return Binding(
            get: { !collapsedMediaKeys.contains(key) },
            set: { expanded in
                if expanded {
                    collapsedMediaKeys.remove(key)
                } else {
                    collapsedMediaKeys.insert(key)
                }
            }
        )
    }

    /// One rule's editable selector + declaration rows, grouped by media above.
    @ViewBuilder
    private func ruleRow(ruleIndex: Int, rule: ComponentModel.StyleRule) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("selector", text: selectorBinding(for: rule))
                .font(.system(.caption, design: .monospaced))
                .textFieldStyle(.plain)
                .bold()
                .onSubmit { model.commitSelector(rule: rule) }
            ForEach(rule.declarations, id: \.property) { decl in
                HStack(spacing: 4) {
                    TextField("property", text: propertyBinding(for: decl))
                        .font(.system(.caption, design: .monospaced))
                        .textFieldStyle(.plain)
                        .frame(width: 110)
                        .onSubmit { Task { await model.commitDeclaration(ruleIndex: ruleIndex, rule: rule, decl: decl) } }
                    Text(":")
                    declarationValueField(ruleIndex: ruleIndex, rule: rule, decl: decl)
                    Button(role: .destructive) {
                        model.removeDeclaration(rule: rule, decl: decl)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                }
            }
            Button("Add declaration") {
                let newProperty = "new-property-\(UUID().uuidString.prefix(8))"
                Task { await model.setStyleProperty(ruleSpan: [rule.span.start, rule.span.end], property: newProperty, value: "") }
            }
            .font(.caption2)
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private func selectorBinding(for rule: ComponentModel.StyleRule) -> Binding<String> {
        Binding(
            get: { model.selectorDraft(for: rule) },
            set: { model.setSelectorDraft($0, for: rule) }
        )
    }

    private func propertyBinding(for decl: ComponentModel.Declaration) -> Binding<String> {
        Binding(
            get: { model.propertyDraft(for: decl) },
            set: { model.setPropertyDraft($0, for: decl) }
        )
    }

    @ViewBuilder
    private func declarationValueField(
        ruleIndex: Int,
        rule: ComponentModel.StyleRule,
        decl: ComponentModel.Declaration
    ) -> some View {
        let valueBinding = Binding(
            get: { model.valueDraft(for: decl) },
            set: { model.setValueDraft($0, for: decl) }
        )
        HStack(spacing: 4) {
            TextField("value", text: valueBinding)
                .font(.system(.caption, design: .monospaced))
                .textFieldStyle(.plain)
                .onSubmit { Task { await model.commitDeclaration(ruleIndex: ruleIndex, rule: rule, decl: decl) } }
            if CSSColor.colorProperties.contains(decl.property),
               let color = CSSColor.parse(valueBinding.wrappedValue) {
                ColorPicker("", selection: Binding(
                    get: { color },
                    set: { newColor in
                        let formatted = CSSColor.format(newColor)
                        model.setValueDraft(formatted, for: decl)
                        webView?.evaluateJavaScript(
                            "window.anglesiteCanvas?.scrub?.(\(jsStringLiteral(rule.selector)), \(jsStringLiteral(decl.property)), \(jsStringLiteral(formatted)))"
                        )
                        model.debounceColorCommit(ruleIndex: ruleIndex, rule: rule, decl: decl) {
                            Task { _ = try? await webView?.evaluateJavaScript("window.anglesiteCanvas?.clearScrub?.()") }
                        }
                    }
                ))
                .labelsHidden()
            }
        }
    }

    /// Escapes a Swift string into a double-quoted JS string literal for
    /// interpolation into `evaluateJavaScript` call sites.
    private func jsStringLiteral(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }

    // MARK: - Computed

    private var computedGroup: some View {
        GroupBox("Computed") {
            if model.computedStyles.isEmpty {
                Text("Select an element in the canvas").foregroundStyle(.secondary)
            } else {
                ForEach(model.computedStyles.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                    LabeledContent(key, value: value)
                        .font(.system(.caption, design: .monospaced))
                }
            }
        }
    }
}
