# Edit ▸ Find for the remaining editor surfaces (#517)

**Status:** approved for implementation
**Date:** 2026-07-27

## Context

#517 originally scoped two gaps: Edit ▸ Find and a Format menu, for editors that had
neither. PR [#808](https://github.com/Anglesite/Anglesite-app/pull/808) shipped both for
the **Markdown editor** (`.md`/`.mdx`/`.markdown` files and typed-entry body fields) —
live Find (⌘F/⌘G/⇧⌘G/⌥⌘F, find/replace bar) and a Format menu (bold/italic/heading/link) —
via `MarkdownEditorController` + `MarkdownEditorFocusRegistry`. That PR said "Progresses
#517," not "Closes," because two other editor surfaces still have no find at all:

1. **Plain-text editor** (`MainPaneEditorView`'s `.text`/`.plist` case, a bare SwiftUI
   `TextEditor`) — covers most non-markdown, non-component content: non-component `.astro`
   files, JSON, YAML, CSS, JS/TS, and anything else `EditorKind.resolve` doesn't route
   elsewhere.
2. **Component Editor code panes** (`ComponentEditorCodePane`'s STTextView-backed "Props &
   Data" / "Behavior" zone editors, from #494).

Format (bold/italic/heading/link) doesn't apply to either surface — they're code or
arbitrary plain text, not prose — so the Format menu needs no changes. This spec covers
Find only, for these two remaining surfaces.

## Goal

Wire Find into both remaining surfaces through the same app-wide Edit ▸ Find menu
(`EditMenuSkeletonCommands`) that already drives the Markdown editor, so ⌘F/⌘G/⇧⌘G/⌥⌘F
always act on whichever editor currently has keyboard focus, regardless of which of the
three editor kinds it is.

## Why one shared dispatch point

The app's `CommandGroup(before: .textEditing)` already claims ⌘F/⌘G/⇧⌘G/⌥⌘F globally for
the custom Find menu. That means the two remaining surfaces' native find mechanisms
(SwiftUI's `.findNavigator`, AppKit's `NSTextFinder`) can't just rely on the standard
responder chain the way a plain out-of-the-box app would — this app's own menu already
intercepts those shortcuts app-wide. So, consistent with how Markdown already works, the
Find menu itself must know what's focused and dispatch to it explicitly.

## Architecture

### `EditorFocusRegistry` (replaces `MarkdownEditorFocusRegistry`)

A single generalized registry, holding one of three focus kinds:

```swift
final class Weak<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}

@MainActor @Observable
final class EditorFocusRegistry {
    static let shared = EditorFocusRegistry()

    enum Focus {
        case markdown(Weak<MarkdownEditorController>)
        case codePane(Weak<NSResponder>)
        case plainText(isPresented: Binding<Bool>)
    }

    private(set) var active: Focus?
    private var activeToken: UUID?

    func activate(_ focus: Focus, token: UUID) {
        guard activeToken != token else { return }
        active = focus
        activeToken = token
    }

    func resign(token: UUID) {
        guard activeToken == token else { return }
        active = nil
        activeToken = nil
    }
}
```

This carries forward two lessons from #808's review, now applied to all three cases
instead of just Markdown:

- **Weak associated values** (via the `Weak<T>` box) — an editor instance torn down
  abruptly (skipping the normal resign handshake) can't stay pinned alive through the
  registry. The original `MarkdownEditorFocusRegistry` used `weak var active:
  MarkdownEditorController?` for the same reason; an enum can't hold a `weak` case
  directly, so each class-backed case wraps its value in `Weak<T>` instead.
- **Token-guarded resign** — a later `activate` from a different editor can't be
  clobbered by a stale `resign` racing in behind it. The original used `===` identity
  comparison; a `UUID` token generalizes this to the `.plainText` case, where
  `Binding<Bool>` has no identity to compare.

Rename all existing call sites (`MarkdownTextView.swift`, `MarkdownFindBar.swift`,
`EditMenuSkeletonCommands.swift`, `FormatCommands.swift`) from
`MarkdownEditorFocusRegistry` to `EditorFocusRegistry`. `FormatCommands` unwraps only the
`.markdown` case (format doesn't apply to the other two):

```swift
private var markdownController: MarkdownEditorController? {
    if case .markdown(let weak) = registry.active { return weak.value }
    return nil
}
```

### Plain-text editor (`.text`/`.plist`)

`MainPaneEditorView`'s `.text, .plist` case adds SwiftUI's native find navigator and a
`@FocusState`-driven registration — no custom NSView sentinel needed here, since this is
a plain `TextEditor`, not a hosted AppKit tree:

```swift
case .text, .plist:
    TextEditor(text: $model.text)
        .font(.system(.body, design: .monospaced))
        .scrollContentBackground(.hidden)
        .findNavigator(isPresented: $model.isFindPresented)
        .focused($isEditorFocused)
        .onChange(of: isEditorFocused) { _, focused in
            if focused {
                EditorFocusRegistry.shared.activate(
                    .plainText(isPresented: $model.isFindPresented), token: model.file.id)
            } else {
                EditorFocusRegistry.shared.resign(token: model.file.id)
            }
        }
```

`isFindPresented` lives on `FileEditorModel` (alongside `isDirty`/`loadError`), not local
view `@State` — the view can be torn down/rebuilt when switching files
(`.task(id: model.file.id)`), but the model persists across that, so state doesn't reset
mid-session. `model.file.id` (already the `.task` identity key) doubles as the registry
token.

### Component Editor code panes

STTextView posts `NSText.didBeginEditingNotification`/`didEndEditingNotification` itself
(confirmed in its source — unlike the Markdown engine's custom text view, which #808 found
does *not* post these, requiring a KVO/geometry-based sentinel workaround instead). So
`ComponentCodeEditorView`'s `Coordinator` registers directly via the standard delegate
callbacks:

```swift
final class Coordinator: NSObject, STTextViewDelegate {
    let token = UUID()
    let text: Binding<String>
    var isProgrammaticUpdate = false

    func textDidBeginEditing(_ notification: Notification) {
        guard let tv = notification.object as? NSResponder else { return }
        EditorFocusRegistry.shared.activate(.codePane(Weak(tv)), token: token)
    }

    func textDidEndEditing(_ notification: Notification) {
        EditorFocusRegistry.shared.resign(token: token)
    }
}
```

Dispatch synthesizes a tagged `NSMenuItem` and calls STTextView's existing
`performTextFinderAction(_:)` (public API, backed by a fully built-in `NSTextFinder` +
find bar container — `textFinder`, `textFinderClient`, `textFinderBarContainer` are all
already wired up in STTextView itself). The method is declared on `NSResponder` itself,
not `NSTextView` — `STTextView` is `NSView`-rooted, not `NSTextView`-rooted (found during
implementation review), so `codePane` and this helper are typed against `NSResponder`:

```swift
private func sendFinderAction(_ action: NSTextFinder.Action, to responder: NSResponder) {
    let item = NSMenuItem()
    item.tag = action.rawValue
    responder.performTextFinderAction(item)
}
```

No custom find-bar UI needed for this surface — STTextView renders its own native find
bar, the same mechanism TextEdit and Xcode use.

### Dispatch in `EditMenuSkeletonCommands`

```swift
private func performFind() {
    switch registry.active {
    case .markdown(let ctrl): ctrl.value?.showFind()
    case .codePane(let tv): tv.value.map { sendFinderAction(.showFindInterface, to: $0) }
    case .plainText(let isPresented): isPresented.wrappedValue = true
    case nil: break
    }
}
```

`Find Next`/`Find Previous` are enabled for `.markdown` and `.codePane` (both support
imperative navigation — codePane via `NSTextFinder.Action.nextMatch`/`.previousMatch`) and
disabled while `.plainText` is active: `.findNavigator` exposes no imperative next/prev
hook, so once it's open its own UI (arrow buttons, ⌘G inside the field) drives navigation,
outside this menu's control.

`Find & Replace…` maps to `.showFindInterface` for `.codePane` too (STTextView's find bar
has a built-in replace toggle) — **to be confirmed in the spike below**; AppKit's
`NSTextFinder.Action` has no distinct "open in replace mode" tag, so if this doesn't
actually surface a replace UI, `Find & Replace…` falls back to disabled for `.codePane`,
same as `.plainText`.

## Risks needing a manual spike

Two questions can't be resolved by reading code, only by running the app (the original
issue itself flagged this work as needing a spike):

1. Whether AppKit's disabled-menu-item behavior lets ⌘G/⇧⌘G "pass through" to
   `.findNavigator`'s own internal handling once it's open and focused, or whether this
   app's global `CommandGroup` shadows those shortcuts regardless of `.disabled()`. If it
   doesn't pass through, arrow-key/⌘G navigation inside the plain-text find navigator may
   not work from the keyboard — an acceptable degradation (Find still opens and searches
   via mouse-driven UI), but worth confirming rather than assuming.
2. Whether `.showFindInterface` alone gives STTextView's find bar a working Replace
   toggle, or whether a separate action/property is needed to reach it.

Plan: implement `Find…` first (lowest risk, works the same way across all three surfaces),
do a manual GUI pass to settle both questions, then finish `Find Next`/`Find
Previous`/`Find & Replace…` wiring for `.codePane` per what's actually confirmed to work.

## Testing

- **Unit:** `EditorFocusRegistry` activate/resign/token-guard logic (mirrors whatever
  `MarkdownEditorControllerTests` already covers for the registry's previous shape).
- **Manual GUI smoke** (required — AppKit/SwiftUI focus and find-bar integration is
  exactly the territory unit tests can't catch, per #808's own postmortem):
  - Open a `.json` or non-component `.astro` file, ⌘F, confirm the find navigator appears
    and searches.
  - Open a component, focus a code-pane zone editor ("Props & Data" or "Behavior"), ⌘F,
    confirm STTextView's native find bar appears and searches.
  - Switch focus between a markdown file, a plain-text file, and a code pane; confirm the
    Find menu's enabled state always tracks whichever is currently focused, and only one
    is ever "active" at a time.
  - Close a window/tab with an open find bar/navigator via an abrupt path (not the normal
    blur-then-close sequence) and confirm the registry doesn't retain a stale `active`
    reference (the `Weak<T>` boxing this spec relies on).

## Out of scope

- Format menu changes — already correctly scoped to Markdown only.
- `.plist` files opened through `PlistEditorView` (a different, structured plist editor
  used elsewhere in `SiteWindow.swift`, not `MainPaneEditorView`) — out of scope; this spec
  only touches the plain-text fallback `MainPaneEditorView` uses for files whose
  `EditorKind` resolves to `.plist` (currently the same bare `TextEditor` as `.text`).
- "Use Selection for Find" (still a `PlannedItem`, all three surfaces) and "Search Site…"
  (already live, unrelated to this work) — unchanged.
