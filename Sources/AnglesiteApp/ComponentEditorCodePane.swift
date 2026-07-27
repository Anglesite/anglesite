import SwiftUI
import STTextView
import STPluginNeon
import TreeSitterResource
import AnglesiteCore

/// The "Code" group embedded in `ComponentEditorInspectorPane` (design spec §4.3/§7): two
/// STTextView panes — "Props & Data" (frontmatter TS) and "Behavior" (client script) — tree-sitter
/// highlighted, switched with a segmented picker. Dirty-tracking and the draft store itself live
/// on `ComponentEditorModel` (`codeDrafts`/`codeDraftDirty`/`saveCodeDraft`, #824); this view only
/// renders them and saves explicitly via the button below, not on blur (see that button's doc
/// comment for why it doesn't also bind ⌘S).
struct ComponentEditorCodePane: View {
    @Bindable var model: ComponentEditorModel
    @Binding var codeZone: ComponentEditorModel.CodeZone

    var body: some View {
        GroupBox("Code") {
            VStack(alignment: .leading, spacing: 6) {
                Picker("Zone", selection: $codeZone) {
                    ForEach(ComponentEditorModel.CodeZone.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                // `.id(codeZone)` forces SwiftUI to tear down and recreate this
                // NSViewRepresentable (fresh Coordinator, fresh STTextView, fresh NeonPlugin) on
                // every tab switch, rather than reusing the same underlying view/coordinator
                // across zones. Without it, `makeCoordinator`/`makeNSView` run exactly once for
                // the lifetime of this view's position in the tree: the coordinator's captured
                // `text` binding and the plugin's `language` would both stay pinned to whichever
                // zone was active at first mount, so typing after switching tabs would silently
                // write into the wrong zone's draft and highlight with the wrong grammar (PR
                // #774 review). Recreating the view on zone change does mean losing cursor/scroll
                // position when switching tabs — an acceptable tradeoff over misrouted edits.
                ComponentCodeEditorView(
                    text: codeDraftBinding(codeZone),
                    language: codeZone.language
                )
                .id(codeZone)
                .frame(height: 160)
                .border(.separator)
                HStack {
                    if model.codeDraftDirty(zone: codeZone) {
                        Text("Unsaved changes").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Save") {
                        Task { await model.saveCodeDraft(zone: codeZone) }
                    }
                    // No local ⌘S: `SaveCommands`/#509 centralized File ▸ Save specifically to
                    // avoid double-registering the shortcut when multiple editing surfaces are
                    // on screen at once. This pane isn't wired into `SiteWindowModel.activeEditor`
                    // (a closed `.text`/`.plist` enum) yet — a reasonable follow-up once the
                    // Component Editor's props/code drafts need to participate in File ▸ Save /
                    // Revert to Saved the way the main-pane editor and inspector already do.
                    .disabled(!model.codeDraftDirty(zone: codeZone))
                }
            }
        }
    }

    private func codeDraftBinding(_ zone: ComponentEditorModel.CodeZone) -> Binding<String> {
        Binding(
            get: { model.codeDrafts[zone] ?? "" },
            set: { model.codeDrafts[zone] = $0 }
        )
    }
}

/// UI-only rendering metadata for `ComponentEditorModel.CodeZone` — display label + tree-sitter
/// grammar — attached here rather than on the Core-ish model enum itself, the same split
/// `SiteGraphNodeKind`'s `title`/`systemImage`/`tint` use in `SiteGraphExplorerView`.
private extension ComponentEditorModel.CodeZone {
    var label: String {
        switch self {
        case .frontmatter: "Props & Data"
        case .client: "Behavior"
        }
    }

    var language: TreeSitterLanguage {
        switch self {
        case .frontmatter: .typescript
        case .client: .javascript
        }
    }
}

/// STTextView-backed code pane for a component script zone, tree-sitter highlighted via
/// STTextView-Plugin-Neon's `NeonPlugin`. Wraps the AppKit view directly
/// (`STTextView.scrollableTextView()`), matching `ComponentEditorCanvasPane`'s own
/// NSViewRepresentable-over-AppKit pattern rather than STTextView's SwiftUI wrapper.
private struct ComponentCodeEditorView: NSViewRepresentable {
    @Binding var text: String
    let language: TreeSitterLanguage

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    @MainActor
    final class Coordinator: NSObject, STTextViewDelegate {
        let text: Binding<String>
        /// Set while `updateNSView` is pushing the SwiftUI-side value into the text view, so
        /// the resulting `textViewDidChangeText` notification doesn't bounce right back into
        /// `text` (a no-op, but one that would otherwise re-trigger `updateNSView` every frame).
        var isProgrammaticUpdate = false
        /// `EditorFocusRegistry` activation token for this coordinator instance. `.id(codeZone)`
        /// on the enclosing view (see the doc comment on `ComponentEditorCodePane`) recreates this
        /// coordinator on every zone-tab switch, so each one needs its own token — reusing a
        /// shared token across coordinators would let a later one's resign wrongly clear an
        /// earlier one's still-active registration.
        private let focusToken = UUID()
        private var focusObservers: [NSObjectProtocol] = []

        init(text: Binding<String>) {
            self.text = text
        }

        /// STTextView posts the standard `NSText` focus notifications itself (confirmed in its
        /// source: `becomeFirstResponder`/`resignFirstResponder` post them directly when
        /// `isEditable`) — unlike the Markdown engine's custom text view, which #808 found does
        /// NOT post these, requiring a KVO/geometry-based workaround instead. Scoped to this
        /// specific `textView` via `object:` so unrelated text views elsewhere in the app don't
        /// trigger it. Parameter is `NSResponder`, not `NSTextView`: `STTextView` is `NSView`-
        /// rooted, not `NSTextView`-rooted (Task 3's review caught this — `EditorFocusRegistry`'s
        /// `codePane` case is `Weak<NSResponder>` for the same reason).
        func observeFocus(for textView: NSResponder) {
            let center = NotificationCenter.default
            focusObservers = [
                center.addObserver(
                    forName: NSText.didBeginEditingNotification, object: textView, queue: .main
                ) { [weak self, weak textView] _ in
                    guard let self, let textView else { return }
                    EditorFocusRegistry.shared.activate(.codePane(Weak(textView)), token: self.focusToken)
                },
                center.addObserver(
                    forName: NSText.didEndEditingNotification, object: textView, queue: .main
                ) { [weak self] _ in
                    guard let self else { return }
                    EditorFocusRegistry.shared.resign(token: self.focusToken)
                },
            ]
        }

        deinit {
            let center = NotificationCenter.default
            focusObservers.forEach { center.removeObserver($0) }
        }

        func textViewDidChangeText(_ notification: Notification) {
            guard !isProgrammaticUpdate, let textView = notification.object as? STTextView else { return }
            text.wrappedValue = textView.text ?? ""
        }
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = STTextView.scrollableTextView()
        guard let textView = scrollView.documentView as? STTextView else { return scrollView }
        textView.text = text
        textView.font = .monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        textView.delegate = context.coordinator
        textView.addPlugin(NeonPlugin(theme: .default, language: language))
        context.coordinator.observeFocus(for: textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? STTextView, textView.text != text else { return }
        context.coordinator.isProgrammaticUpdate = true
        textView.text = text
        context.coordinator.isProgrammaticUpdate = false
    }
}
