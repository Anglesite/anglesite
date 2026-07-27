import SwiftUI
import AppKit

/// Weak reference box, used to hold class-typed associated values in `EditorFocusRegistry.Focus`
/// without retaining them — an `enum` case can't be declared `weak` directly the way a stored
/// property can. Mirrors the original `MarkdownEditorFocusRegistry`'s `weak var active` (#808
/// review): an editor instance torn down abruptly (skipping the normal resign handshake) must not
/// stay pinned alive through the registry.
final class Weak<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}

/// Tracks which editor surface currently owns keyboard focus, app-wide, across all three editor
/// kinds (#517). `EditMenuSkeletonCommands`'s Find menu and `FormatCommands`'s Format menu both
/// dispatch through this single registry — the app's own `CommandGroup(before: .textEditing)`
/// already claims ⌘F/⌘G/⇧⌘G/⌥⌘F globally, so none of the three surfaces' native find mechanisms
/// (Markdown's custom bus, SwiftUI's `.findNavigator`, AppKit's `NSTextFinder`) can rely on the
/// standard responder chain to reach them — the menu must know what's focused and dispatch
/// explicitly. Replaces the Markdown-only `MarkdownEditorFocusRegistry` from #808.
@MainActor @Observable
final class EditorFocusRegistry {
    static let shared = EditorFocusRegistry()

    enum Focus {
        case markdown(Weak<MarkdownEditorController>)
        case codePane(Weak<NSResponder>)
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
