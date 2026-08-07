import SwiftUI

/// Edit-menu skeleton items (menu-bar spec §2.3): selection walkers and annotations after
/// the pasteboard block, Find ▸ in the text-editing block. The Find items dispatch through
/// `EditorFocusRegistry` (#797/#517) to whichever editor surface currently has focus — Markdown,
/// or plain text (which also covers the Component Editor's Source-mode `TextEditor`, #517
/// follow-up) — and Search Site… against the focused window's toolbar search field (#520); the
/// rest are editor/subsystem-gated PlannedItems. NavigatorEditCommands owns the live
/// Delete/Duplicate next to them.
struct EditMenuSkeletonCommands: Commands {
    private let registry = EditorFocusRegistry.shared
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
                Button("Find…") { performFind() }
                    .keyboardShortcut("f")
                    .disabled(registry.active == nil)
                Button("Find Next") { performFindNext() }
                    .keyboardShortcut("g")
                    .disabled(!supportsNextPrevious)
                Button("Find Previous") { performFindPrevious() }
                    .keyboardShortcut("g", modifiers: [.command, .shift])
                    .disabled(!supportsNextPrevious)
                Button("Find & Replace…") { performFindReplace() }
                    .keyboardShortcut("f", modifiers: [.command, .option])
                    .disabled(!supportsNextPrevious)
                PlannedItem("Use Selection for Find", shortcut: "e")

                Divider()

                // ⇧⌘F, not one of the standard find keys: ⌘F/⌘G/⇧⌘G/⌥⌘F all belong to the
                // in-editor find UI above (#797/#517). ⇧⌘F is Xcode's Find-in-Project key, and
                // this is the same relationship — document find vs. whole-project find.
                Button("Search Site…") { searchActions?.focusSearchField() }
                    .keyboardShortcut("f", modifiers: [.command, .shift])
                    .disabled(searchActions == nil)
            }
        }
    }

    /// `Find Next`/`Find Previous`/`Find & Replace…` need imperative navigation, which only
    /// `.markdown` supports — `.plainText`'s `.findNavigator` (covering both the plain-text file
    /// editor and the Component Editor's Source-mode `TextEditor`, #517) exposes no such hook;
    /// once shown, its own UI (arrow buttons, ⌘G inside its field) drives navigation outside this
    /// menu's control.
    private var supportsNextPrevious: Bool {
        switch registry.active {
        case .markdown: true
        case .plainText, nil: false
        }
    }

    private func performFind() {
        switch registry.active {
        case .markdown(let box): box.value?.showFind()
        case .plainText(let isPresented): isPresented.wrappedValue = true
        case nil: break
        }
    }

    private func performFindNext() {
        switch registry.active {
        case .markdown(let box): box.value?.findNext()
        case .plainText, nil: break
        }
    }

    private func performFindPrevious() {
        switch registry.active {
        case .markdown(let box): box.value?.findPrevious()
        case .plainText, nil: break
        }
    }

    private func performFindReplace() {
        switch registry.active {
        case .markdown(let box): box.value?.showFind(withReplace: true)
        case .plainText, nil: break
        }
    }
}
