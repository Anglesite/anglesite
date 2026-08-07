import SwiftUI

/// The Format menu (menu-bar spec §2.6). Font items are semantic elements (strong/em/u/s/code),
/// not visual styling. The Markdown items are live against the focused Markdown editor
/// (#797/#517) via `EditorFocusRegistry` — a focused-value can't disambiguate two editors in one
/// window (main pane + inspector body), so the registry is the deliberate departure from the
/// PlannedItem→focused-value convention. Format doesn't apply to the registry's other case
/// (`.plainText`, which covers both the plain-text file editor and the Component Editor's
/// Source-mode `TextEditor`) — those stay PlannedItems here, same as before. Remaining items
/// stay PlannedItems until their editors land.
struct FormatCommands: Commands {
    private let registry = EditorFocusRegistry.shared

    private var markdownController: MarkdownEditorController? {
        if case .markdown(let box) = registry.active { return box.value }
        return nil
    }

    var body: some Commands {
        CommandMenu("Format") {
            Menu("Font") {
                Button("Strong") { markdownController?.perform(.bold) }
                    .keyboardShortcut("b")
                    .disabled(markdownController == nil)
                Button("Emphasis") { markdownController?.perform(.italic) }
                    .keyboardShortcut("i")
                    .disabled(markdownController == nil)
                PlannedItem("Underline", shortcut: "u")
                Button("Strikethrough") { markdownController?.perform(.strikethrough) }
                    .disabled(markdownController == nil)
                Button("Code") { markdownController?.perform(.inlineCode) }
                    .disabled(markdownController == nil)
            }

            Menu("Heading") {
                ForEach(1...6, id: \.self) { level in
                    Button("Heading \(level)") { markdownController?.perform(.heading(level)) }
                        .keyboardShortcut(KeyEquivalent(Character("\(level)")), modifiers: [.command, .option])
                        .disabled(markdownController == nil)
                }
            }

            Menu("Text") {
                PlannedItem("Align Left", shortcut: "{")
                PlannedItem("Align Center", shortcut: "|")
                PlannedItem("Align Right", shortcut: "}")
                PlannedItem("Justify")
                PlannedItem("Auto-Align Table Cell")

                Divider()

                PlannedItem("Increase Indent Level", shortcut: "]")
                PlannedItem("Decrease Indent Level", shortcut: "[")

                Divider()

                PlannedItem("Reverse Text Direction")
            }

            PlannedItem("Table")
            PlannedItem("Image")

            Divider()

            PlannedItem("Copy Style", shortcut: "c", modifiers: [.command, .option])
            PlannedItem("Paste Style", shortcut: "v", modifiers: [.command, .option])
            PlannedItem("Copy Animation")
            PlannedItem("Paste Animation")

            Divider()

            Button("Add Link…") { markdownController?.perform(.link) }
                .keyboardShortcut("k")
                .disabled(markdownController == nil)
            PlannedItem("Remove Link")
        }
    }
}
