import Foundation
import Observation

/// App-level command surface for one hosted Markdown editor (#797). Menu commands and the find
/// bar talk to this controller; it forwards to the engine over per-instance NotificationCenter
/// names (`BusNames`) that `MarkdownTextView` registers as the engine's `MarkdownEditorBus`.
/// Foundation-only on purpose: nothing outside MarkdownTextView.swift imports MarkdownEngine
/// (#796 addendum — the substrate stays swappable).
@MainActor @Observable
final class MarkdownEditorController {

    /// Formatting verbs the Format menu sends to the focused editor. Each maps 1:1 onto an
    /// engine bus notification; the engine owns the toggle/wrap semantics (and the undo path).
    enum FormatCommand: Equatable {
        case bold, italic, strikethrough, inlineCode
        case heading(Int)
        case link
    }

    /// Per-instance notification names. Unique per controller because the engine's coordinator
    /// applies a bus notification unconditionally — shared names would format every open editor.
    struct BusNames {
        let applyBold: Notification.Name
        let applyItalic: Notification.Name
        let applyHeading: Notification.Name
        let applyStrikethrough: Notification.Name
        let applyInlineCode: Notification.Name
        let applyLink: Notification.Name
        let findQuery: Notification.Name
        let findClearHighlights: Notification.Name
        let findResults: Notification.Name
        let replaceCurrent: Notification.Name
        let replaceAll: Notification.Name

        init(id: UUID) {
            func make(_ suffix: String) -> Notification.Name {
                Notification.Name("io.dwk.anglesite.markdown-editor.\(id.uuidString).\(suffix)")
            }
            applyBold = make("applyBold")
            applyItalic = make("applyItalic")
            applyHeading = make("applyHeading")
            applyStrikethrough = make("applyStrikethrough")
            applyInlineCode = make("applyInlineCode")
            applyLink = make("applyLink")
            findQuery = make("findQuery")
            findClearHighlights = make("findClearHighlights")
            findResults = make("findResults")
            replaceCurrent = make("replaceCurrent")
            replaceAll = make("replaceAll")
        }
    }

    /// Notification names of the engine instance this controller currently commands. SwiftUI may
    /// transiently instantiate more than one engine tree for the same editor (observed in the
    /// #797 GUI smoke: two `makeNSView` calls for one Body field, with the orphan staying alive
    /// and subscribed); scoping names per engine INSTANCE and adopting the focused instance's
    /// names makes such orphans harmless — they listen on names nobody posts to.
    private(set) var busNames: BusNames
    /// Installed by `MarkdownTextView`; returns keyboard focus to the engine text view
    /// (used when the find bar dismisses).
    var focusEditor: (() -> Void)?

    /// Stable per-instance identity used as the `EditorFocusRegistry` activation token (#517) — an
    /// enum case can't be `weak`, so the registry can't use `===` identity the way the pre-#517
    /// single-purpose registry did; every `Focus` case needs an explicit token instead.
    let id = UUID()

    /// Called by the hosting view when its engine instance gains keyboard focus (and once at
    /// creation, so a sole instance is commandable before first focus).
    func adoptBusNames(_ names: BusNames) {
        guard names.applyBold != busNames.applyBold else { return }
        busNames = names
        observeFindResults()
    }

    // MARK: Find state (rendered by MarkdownFindBar; highlights drawn by the engine)

    var isFindBarVisible = false
    var showsReplace = false
    var query = ""
    var replacement = ""
    private(set) var matchCount = 0
    private(set) var currentMatchIndex = 0

    private var resultsObserver: (any NSObjectProtocol)?

    init() {
        busNames = BusNames(id: UUID())
        observeFindResults()
    }

    private func observeFindResults() {
        if let resultsObserver { NotificationCenter.default.removeObserver(resultsObserver) }
        // queue: nil → delivered synchronously on the posting thread, which the engine's own
        // bus handler guarantees is main — callers (the find bar, `findNext`/`findPrevious`'s
        // wrap math) depend on `matchCount`/`currentMatchIndex` already reflecting the latest
        // query by the time `post(name:)` returns, so this can't unconditionally defer via
        // `Task { @MainActor in }` (tried during #808 review — broke exactly that synchronous
        // contract). Instead: verify the guarantee at runtime rather than assuming it.
        // `Thread.isMainThread` true → `MainActor.assumeIsolated` is now a confirmed-safe
        // same-thread hop, not a trusted one. False (the guarantee broken) → fail safely with a
        // one-runloop-turn-late update via `Task` instead of trapping.
        resultsObserver = NotificationCenter.default.addObserver(
            forName: busNames.findResults, object: nil, queue: nil
        ) { [weak self] note in
            let count = note.userInfo?["count"] as? Int ?? 0
            guard let self else { return }
            @MainActor func apply() {
                self.matchCount = count
                if self.currentMatchIndex >= count { self.currentMatchIndex = max(0, count - 1) }
            }
            if Thread.isMainThread {
                MainActor.assumeIsolated { apply() }
            } else {
                Task { @MainActor in apply() }
            }
        }
    }

    // `isolated`: the @Observable macro's storage is MainActor-isolated, so a nonisolated
    // deinit can't read `resultsObserver`; running the deinit on the actor can.
    isolated deinit {
        if let resultsObserver { NotificationCenter.default.removeObserver(resultsObserver) }
    }

    // MARK: Formatting

    func perform(_ command: FormatCommand) {
        let center = NotificationCenter.default
        switch command {
        case .bold: center.post(name: busNames.applyBold, object: nil)
        case .italic: center.post(name: busNames.applyItalic, object: nil)
        case .strikethrough: center.post(name: busNames.applyStrikethrough, object: nil)
        case .inlineCode: center.post(name: busNames.applyInlineCode, object: nil)
        case .heading(let level):
            center.post(name: busNames.applyHeading, object: nil, userInfo: ["level": level])
        case .link:
            // Empty URL: the engine wraps the selection as `[selection]()` with the caret in the
            // URL slot, or inserts `[]()` with the caret in the text slot when nothing is selected.
            center.post(name: busNames.applyLink, object: nil, userInfo: ["url": ""])
        }
    }

    // MARK: Find

    func showFind(withReplace: Bool = false) {
        isFindBarVisible = true
        if withReplace { showsReplace = true }
        if !query.isEmpty { runQuery() }
    }

    func hideFind() {
        isFindBarVisible = false
        showsReplace = false
        NotificationCenter.default.post(name: busNames.findClearHighlights, object: nil)
        focusEditor?()
    }

    /// Restarts the search from the first match; the find bar calls this whenever `query` changes.
    func queryChanged() {
        currentMatchIndex = 0
        if query.isEmpty {
            matchCount = 0
            NotificationCenter.default.post(name: busNames.findClearHighlights, object: nil)
        } else {
            runQuery()
        }
    }

    func findNext() {
        guard matchCount > 0 else { return }
        currentMatchIndex = (currentMatchIndex + 1) % matchCount
        runQuery()
    }

    func findPrevious() {
        guard matchCount > 0 else { return }
        currentMatchIndex = (currentMatchIndex - 1 + matchCount) % matchCount
        runQuery()
    }

    func replaceCurrentMatch() {
        guard matchCount > 0, !query.isEmpty else { return }
        NotificationCenter.default.post(
            name: busNames.replaceCurrent, object: nil,
            userInfo: ["query": query, "replacement": replacement, "currentIndex": currentMatchIndex])
    }

    func replaceAllMatches() {
        guard !query.isEmpty else { return }
        NotificationCenter.default.post(
            name: busNames.replaceAll, object: nil,
            userInfo: ["query": query, "replacement": replacement])
    }

    private func runQuery() {
        NotificationCenter.default.post(
            name: busNames.findQuery, object: nil,
            userInfo: ["query": query, "currentIndex": currentMatchIndex])
    }
}
