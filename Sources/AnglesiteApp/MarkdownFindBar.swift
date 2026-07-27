import SwiftUI

/// Find / replace bar shown above a `MarkdownTextView` (#517 Edit ▸ Find). Pure chrome: match
/// highlighting, navigation, and replacement all execute inside the engine via the controller's
/// bus; this view renders state and forwards intents.
struct MarkdownFindBar: View {
    @Bindable var controller: MarkdownEditorController
    @FocusState private var findFieldFocused: Bool

    var body: some View {
        // Two compact rows so the bar also fits the narrow inspector host (typed-entry Body).
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                TextField("Find", text: $controller.query)
                    .textFieldStyle(.roundedBorder)
                    .focused($findFieldFocused)
                    .onSubmit { controller.findNext() }
                Text(matchCountLabel)
                    .font(.callout).monospacedDigit()
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
            HStack(spacing: 6) {
                ControlGroup {
                    Button { controller.findPrevious() } label: { Image(systemName: "chevron.left") }
                        .help("Find Previous")
                    Button { controller.findNext() } label: { Image(systemName: "chevron.right") }
                        .help("Find Next")
                }
                .disabled(controller.matchCount == 0)
                .frame(width: 72)
                Toggle("Replace", isOn: $controller.showsReplace)
                    .toggleStyle(.checkbox)
                Spacer()
                Button("Done") { controller.hideFind() }
            }
            if controller.showsReplace {
                HStack(spacing: 6) {
                    TextField("Replace With", text: $controller.replacement)
                        .textFieldStyle(.roundedBorder)
                    Button("Replace") { controller.replaceCurrentMatch() }
                        .disabled(controller.matchCount == 0)
                    Button("All") { controller.replaceAllMatches() }
                        .accessibilityLabel("Replace All")
                        .disabled(controller.matchCount == 0)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .onAppear {
            // Setting @FocusState in the same transaction the field appears in is dropped on
            // macOS (focus lands on the form's first field instead — and ⌘F keystrokes would
            // type into it). Defer one runloop turn so the field exists first.
            DispatchQueue.main.async { findFieldFocused = true }
        }
        // The find bar sits OUTSIDE the engine's focus-tracking container, so gaining field focus
        // would otherwise read as "editor lost focus" and disable Find Next/Format mid-search.
        .onChange(of: findFieldFocused) { _, focused in
            if focused { EditorFocusRegistry.shared.activate(.markdown(Weak(controller)), token: controller.id) }
        }
        .onChange(of: controller.query) { controller.queryChanged() }
        .onExitCommand { controller.hideFind() }
    }

    private var matchCountLabel: String {
        if controller.query.isEmpty { return "" }
        if controller.matchCount == 0 { return String(localized: "No matches") }
        return String(localized: "\(controller.currentMatchIndex + 1) of \(controller.matchCount)")
    }
}
