import SwiftUI

/// Edit-menu skeleton items (menu-bar spec §2.3): selection walkers and annotations after
/// the pasteboard block, Find ▸ in the text-editing block. The Find items are live against
/// the focused Markdown editor (#797/#517) via `MarkdownEditorFocusRegistry`, and Search Site…
/// against the focused window's toolbar search field (#520); the rest are editor/subsystem-gated
/// PlannedItems. NavigatorEditCommands owns the live Delete/Duplicate next to them.
struct EditMenuSkeletonCommands: Commands {
    private let registry = MarkdownEditorFocusRegistry.shared
    @FocusedValue(\.siteSearchActions) private var searchActions

    var body: some Commands {
        CommandGroup(after: .pasteboard) {
            PlannedItem("Deselect All", shortcut: "a", modifiers: [.command, .shift])
            PlannedItem("Select Parent", shortcut: .upArrow, modifiers: [.command, .option])

            Divider()

            // Clears draft annotations in the current page (spec §4.4).
            PlannedItem("Remove Highlights and Comments")
        }

        CommandGroup(before: .textEditing) {
            Menu("Find") {
                Button("Find…") { registry.active?.showFind() }
                    .keyboardShortcut("f")
                    .disabled(registry.active == nil)
                Button("Find Next") { registry.active?.findNext() }
                    .keyboardShortcut("g")
                    .disabled(registry.active == nil)
                Button("Find Previous") { registry.active?.findPrevious() }
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                    .disabled(registry.active == nil)
                Button("Find & Replace…") { registry.active?.showFind(withReplace: true) }
                    .keyboardShortcut("f", modifiers: [.command, .option])
                    .disabled(registry.active == nil)
                PlannedItem("Use Selection for Find", shortcut: "e")

                Divider()

                // ⇧⌘F, not one of the standard find keys: ⌘F/⌘G/⇧⌘G/⌥⌘F all belong to the
                // in-editor find bar above (#797/#517). ⇧⌘F is Xcode's Find-in-Project key, and
                // this is the same relationship — document find vs. whole-project find.
                Button("Search Site…") { searchActions?.focusSearchField() }
                    .keyboardShortcut("f", modifiers: [.command, .shift])
                    .disabled(searchActions == nil)
            }
        }
    }
}
