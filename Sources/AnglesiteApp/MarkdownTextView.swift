import SwiftUI
import AppKit
import MarkdownEngine

/// SwiftUI seam over swift-markdown-engine's live-styled Markdown editor (#797; spec §A.3,
/// substrate decided by the #796 survey addendum). The ONLY file in the app that imports
/// MarkdownEngine — call sites (editor routing, menu commands, find bar) speak
/// `MarkdownEditorController`, so the substrate stays swappable.
///
/// The engine's `NativeTextViewWrapper` is embedded DIRECTLY in SwiftUI (its designed usage).
/// An earlier revision re-hosted it inside an `NSHostingView` within our own representable to
/// track first-responder state; that indirection intermittently produced duplicate engine trees
/// (still subscribed to the command bus) and mislaid layout. Focus tracking uses a zero-cost
/// `.background` sentinel that attributes the window's first responder by geometry.
///
/// #808 review raised `NSWindow.firstResponder` KVO as undocumented/fragile and suggested the
/// documented `NSText.didBeginEditingNotification`/`didEndEditingNotification` pair instead.
/// Tried it (instrumented, on-device): the engine's custom `NSTextView` subclass never posts
/// either notification — confirmed via live logging across click, focus, and typing, zero
/// firings. KVO is retained as the only mechanism that empirically works against this engine.
/// Re-verified on-device after this review pass: the Format menu correctly enables when a
/// markdown body gains focus and disables when focus moves to a non-markdown page (real clicks +
/// live menu-state assertions, not just re-reading the code). The literal two-simultaneous-
/// editors case (main pane raw file + inspector body open together) wasn't independently
/// re-exercised this pass — the smoke fixture had no raw `.md` file reachable as a main-pane
/// `.file` target to construct it — but relies on the same `contains(responder:)` geometry
/// check validated above, scoped per sentinel instance.
struct MarkdownTextView: View {
    @Binding var text: String
    let controller: MarkdownEditorController
    var documentId: String
    /// `true` for form embedding (typed-entry body): the editor grows to fit and the enclosing
    /// Form scrolls. `false` (default) scrolls internally — the main-pane file editor.
    var fitsContent = false

    /// Bus names scoped to THIS view instance's engine. The controller adopts them on appear
    /// and whenever this editor gains focus, so any transient duplicate engine tree SwiftUI
    /// creates listens on names nobody posts to (see `MarkdownEditorController.adoptBusNames`).
    @State private var busNames = MarkdownEditorController.BusNames(id: UUID())

    var body: some View {
        VStack(spacing: 0) {
            if controller.isFindBarVisible {
                MarkdownFindBar(controller: controller)
                Divider()
            }
            NativeTextViewWrapper(
                text: $text,
                configuration: Self.configuration(names: busNames, fitsContent: fitsContent),
                documentId: documentId
            )
            .background(EditorFocusSentinel(controller: controller, busNames: busNames))
            .onAppear { controller.adoptBusNames(busNames) }
        }
    }

    static func configuration(
        names: MarkdownEditorController.BusNames, fitsContent: Bool
    ) -> MarkdownEditorConfiguration {
        let bus = MarkdownEditorBus(
            applyBoldRequest: names.applyBold,
            applyItalicRequest: names.applyItalic,
            applyHeadingRequest: names.applyHeading,
            applyStrikethroughRequest: names.applyStrikethrough,
            applyInlineCodeRequest: names.applyInlineCode,
            applyLinkRequest: names.applyLink,
            findClearHighlights: names.findClearHighlights,
            findQuery: names.findQuery,
            findResults: names.findResults,
            replaceCurrent: names.replaceCurrent,
            replaceAll: names.replaceAll
        )
        return MarkdownEditorConfiguration(
            services: MarkdownEditorServices(bus: bus),
            // Auto-close pairs OFF: typing `[` must insert exactly `[` — auto-paired `]`s corrupt
            // hand-typed task/link syntax (`- [ ]`, `[text](url)`) and even defeat the engine's
            // empty-item list termination (the stray `]` makes the item non-empty). List
            // continuation itself stays on (`helpersEnabled`) — it produces valid Markdown.
            lists: ListStyle(autoClosePairsEnabled: false),
            // Fork-added toggle (Anglesite/swift-markdown-engine): Markdown sources need straight
            // quotes — smart quotes would corrupt frontmatter and code samples (addendum §2).
            spellChecking: SpellCheckingPolicy(automaticQuoteSubstitution: false),
            heightBehavior: fitsContent ? .fitsContent : .scrolls,
            // GFM strikethrough is in the v1 construct set (spec §A.2); it's an opt-in
            // engine extension.
            extensions: [StrikethroughExtension()]
        )
    }
}

/// Invisible background view sharing the editor's exact frame. Watches the window's first
/// responder and reports whether it lies within this editor's bounds — the seam that lets
/// `EditorFocusRegistry` know WHICH markdown editor owns keyboard focus (two can share
/// a window: main pane + inspector body). Field-editor responders are attributed to their
/// owning control, so focus in the find bar or an inspector text field reads as "outside".
private struct EditorFocusSentinel: NSViewRepresentable {
    let controller: MarkdownEditorController
    let busNames: MarkdownEditorController.BusNames

    func makeNSView(context: Context) -> SentinelView {
        let view = SentinelView()
        view.onFocusChange = { [weak controller, busNames] focused in
            guard let controller else { return }
            if focused {
                controller.adoptBusNames(busNames)
                EditorFocusRegistry.shared.activate(.markdown(Weak(controller)), token: controller.id)
            } else {
                EditorFocusRegistry.shared.resign(token: controller.id)
            }
        }
        controller.focusEditor = { [weak view] in
            view?.focusEditorTextView()
        }
        return view
    }

    func updateNSView(_ nsView: SentinelView, context: Context) {}

    static func dismantleNSView(_ nsView: SentinelView, coordinator: ()) {
        nsView.prepareForRemoval()
    }
}

/// The AppKit half of `EditorFocusSentinel`.
final class SentinelView: NSView {
    var onFocusChange: ((Bool) -> Void)?
    private var observation: NSKeyValueObservation?
    private var isFocused = false

    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }   // never intercept clicks

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        observation?.invalidate()
        observation = nil
        guard let window else {
            update(focused: false)
            return
        }
        observation = window.observe(\.firstResponder, options: [.initial, .new]) { [weak self] _, _ in
            // NSWindow mutates firstResponder on the main thread; the hop is for the compiler.
            MainActor.assumeIsolated { self?.refreshFocus() }
        }
    }

    /// Restores keyboard focus to the engine's text view (find-bar dismissal): the first
    /// text view in the window whose visible frame lies inside this sentinel's frame.
    func focusEditorTextView() {
        guard let window, let content = window.contentView else { return }
        let myFrame = convert(bounds, to: nil)
        if let textView = Self.firstTextView(in: content, within: myFrame) {
            window.makeFirstResponder(textView)
        }
    }

    func prepareForRemoval() {
        update(focused: false)
        onFocusChange = nil
        observation?.invalidate()
        observation = nil
    }

    private func refreshFocus() {
        guard let window else {
            update(focused: false)
            return
        }
        var responderView = window.firstResponder as? NSView
        if let text = window.firstResponder as? NSText, text.isFieldEditor {
            responderView = text.delegate as? NSView
        }
        update(focused: responderView.map(contains(responder:)) ?? false)
    }

    /// The sentinel shares the editor's exact frame (`.background`), so a responder belongs to
    /// this editor iff its visible rect lies within the sentinel's frame (both in window
    /// coordinates). Visible rect, not frame: a scrolled NSTextView's frame is the whole
    /// document and would spill outside the clip.
    private func contains(responder: NSView) -> Bool {
        guard responder.window === window else { return false }
        let mine = convert(bounds, to: nil)
        let theirs = responder.convert(responder.visibleRect, to: nil)
        return !theirs.isEmpty && mine.intersects(theirs)
    }

    private func update(focused: Bool) {
        guard focused != isFocused else { return }
        isFocused = focused
        onFocusChange?(focused)
    }

    private static func firstTextView(in view: NSView, within frame: NSRect) -> NSTextView? {
        for sub in view.subviews {
            if let textView = sub as? NSTextView,
               frame.intersects(textView.convert(textView.visibleRect, to: nil)) {
                return textView
            }
            if let found = firstTextView(in: sub, within: frame) { return found }
        }
        return nil
    }
}
