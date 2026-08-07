import SwiftUI

/// Weak reference box, used to hold class-typed associated values in `EditorFocusRegistry.Focus`
/// without retaining them — an `enum` case can't be declared `weak` directly the way a stored
/// property can. Mirrors the original `MarkdownEditorFocusRegistry`'s `weak var active` (#808
/// review): an editor instance torn down abruptly (skipping the normal resign handshake) must not
/// stay pinned alive through the registry.
final class Weak<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}

/// Tracks which editor surface currently owns keyboard focus, app-wide, across the editor kinds
/// (#517). `EditMenuSkeletonCommands`'s Find menu and `FormatCommands`'s Format menu both
/// dispatch through this single registry — the app's own `CommandGroup(before: .textEditing)`
/// already claims ⌘F/⌘G/⇧⌘G/⌥⌘F globally, so neither surface's native find mechanism (Markdown's
/// custom bus, SwiftUI's `.findNavigator`) can rely on the standard responder chain to reach it —
/// the menu must know what's focused and dispatch explicitly. Replaces the Markdown-only
/// `MarkdownEditorFocusRegistry` from #808.
///
/// `.plainText` covers both the plain-text file editor (`.text`/`.plist`) and the Component
/// Editor's Source-mode `TextEditor` (`ComponentEditorView.sourcePane`, #517 follow-up) — both
/// are SwiftUI `TextEditor`s using `.findNavigator`, so they share the case. An earlier
/// `.codePane(Weak<NSResponder>)` case existed for the Component Editor's code pane when it was
/// STTextView-backed (AppKit's `NSTextFinder` via `performTextFinderAction`); #714 slice 3 deleted
/// that view in favor of a bare SwiftUI `TextEditor`, and this case followed it once the Source
/// pane got the same `.findNavigator` treatment as the plain-text editor rather than an
/// AppKit-bridged one.
@MainActor @Observable
final class EditorFocusRegistry {
    static let shared = EditorFocusRegistry()

    enum Focus {
        case markdown(Weak<MarkdownEditorController>)
        case plainText(isPresented: Binding<Bool>)
    }

    private(set) var active: Focus?
    private var activeToken: AnyHashable?

    /// A later `activate` from a different editor must not be clobbered by a stale `resign` racing
    /// in behind it — mirrors the original registry's `===` identity guard, generalized to a token
    /// since `Binding<Bool>` (the `.plainText` case) has no identity to compare.
    func activate(_ focus: Focus, token: AnyHashable) {
        guard activeToken != token else { return }
        active = focus
        activeToken = token
    }

    /// Clears `active` only while `token` still owns it.
    func resign(token: AnyHashable) {
        guard activeToken == token else { return }
        active = nil
        activeToken = nil
    }
}
