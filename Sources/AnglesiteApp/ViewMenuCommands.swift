import SwiftUI

/// The page inspector's visibility lives in `SiteWindow` scene state (`@SceneStorage`), not on the
/// window model, so the View menu reaches it through this focused value rather than
/// `\.siteWindowModel` (#512).
struct InspectorPanelActions {
    let isShown: Bool
    let isAvailable: Bool
    let toggle: @MainActor () -> Void
}

private struct FocusedInspectorPanelKey: FocusedValueKey { typealias Value = InspectorPanelActions }

extension FocusedValues {
    var inspectorPanel: InspectorPanelActions? {
        get { self[FocusedInspectorPanelKey.self] }
        set { self[FocusedInspectorPanelKey.self] = newValue }
    }
}

/// View-menu commands for the focused site window: main-pane switching (⌘1–3) and the side-panel
/// toggles (#512). Declared before `PreviewNavigationCommands` so these sit above it in the View
/// menu.
struct ViewMenuCommands: Commands {
    @FocusedValue(\.siteWindowModel) private var model
    @FocusedValue(\.inspectorPanel) private var inspectorPanel

    var body: some Commands {
        CommandGroup(after: .toolbar) {
            // Toggles (not Buttons) so the active pane gets a menu checkmark; setting an already-on
            // pane to false is a no-op, giving radio behavior.
            Toggle("Preview", isOn: paneBinding(0))
                .keyboardShortcut("1")
                .disabled(model == nil)

            Toggle("Editor", isOn: paneBinding(1))
                .keyboardShortcut("2")
                .disabled(model?.activeEditorFile == nil)

            Toggle("Graph", isOn: paneBinding(2))
                .keyboardShortcut("3")
                .disabled(model?.canShowGraph != true)

            Divider()

            // ⌃⌘K — ⌘K is reserved for Format ▸ Add Link… per the macOS editing
            // convention (menu-bar spec §3). The shortcut lives here, not on the
            // toolbar chat button — a shortcut on a toolbar item is invisible in
            // the menu bar (the discoverability gap #512 exists to close).
            Button(model?.chatPresented == true ? "Hide Chat" : "Show Chat") {
                model?.chatPresented.toggle()
            }
            .keyboardShortcut("k", modifiers: [.command, .control])
            .disabled(model == nil)

            Button(model?.relatedPagesPresented == true ? "Hide Related Pages" : "Show Related Pages") {
                model?.relatedPagesPresented.toggle()
            }
            .disabled(model == nil)

            // ⌥⌘I per the HIG-standard inspector shortcut — reserved for this in #510, when the
            // Web Inspector moved to ⌥⇧⌘I. Submenu shape per menu-bar spec §2.8; the tab items
            // are planned until the inspector grows Style/Animation/Attributes tabs.
            Menu("Inspector") {
                PlannedItem("Style")
                PlannedItem("Animation")
                PlannedItem("Attributes")

                Divider()

                PlannedItem("Show Next Inspector Tab")
                PlannedItem("Show Previous Inspector Tab")

                Divider()

                Button(inspectorPanel?.isShown == true ? "Hide Inspector" : "Show Inspector") {
                    inspectorPanel?.toggle()
                }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(inspectorPanel?.isAvailable != true)
            }

            Divider()
        }
    }

    private func paneBinding(_ index: Int) -> Binding<Bool> {
        Binding(
            get: { model?.paneSelection == index },
            set: { isOn in if isOn { model?.setPaneSelection(index) } }
        )
    }
}
