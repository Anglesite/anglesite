// UndoManager is a Darwin-only Foundation type, so this bridge — used only by the app target's
// ChatModel — compiles out elsewhere. No non-Darwin consumer exists yet (see the cross-platform
// port design doc §5); a portable in-memory undo stack can slot in behind the same public API
// if/when a Linux/Windows GUI shell needs one.
#if canImport(Darwin)
import Foundation

/// Bridges app-applied edits into a window's `UndoManager` so Edit ▸ Undo (⌘Z) reverses them (#527).
///
/// This sits at the shared edit-pipeline level, not inside any one assistant: every applied
/// edit with a commit — overlay drops, chat/assistant tool edits, alt-text follow-ups — flows
/// through `MCPApplyEditRouter.onEdit` into the app's edit recorder, which registers a
/// ``Record`` here at apply time. The reverse-apply itself is the plugin's git-revert
/// (`undo_edit`, wrapped by ``UndoCommand``), so the record only needs the commit SHA (the
/// stable identity of the edit — chat rows are re-created with fresh UUIDs on every history
/// reload) plus the file path for the menu action name. The injected ``Performer`` delegates
/// to the existing inverse-application + conflict-detection path (`ChatModel.undoEdit`).
///
/// The app-target glue stays thin: set ``undoManager`` from SwiftUI's
/// `@Environment(\.undoManager)` and supply `perform`; everything else lives here where it's
/// unit-testable against a plain Foundation `UndoManager`.
///
/// Policy notes:
/// - **No redo.** The plugin exposes revert (`undo_edit`) but no re-apply primitive, so
///   nothing lands on the redo stack — after a successful ⌘Z, Edit ▸ Redo stays disabled.
/// - **Failure re-arms.** `UndoManager` pops the action synchronously the instant ⌘Z fires,
///   before the async revert resolves. If the revert then fails or hits the working-tree
///   conflict sheet (``UndoOutcome/retryable``), the record is re-registered so the edit stays
///   reachable via ⌘Z — symmetric with the chat row's Undo button, which also keeps its entry
///   on failure. (If newer edits were applied during the round trip, the re-armed record sits
///   above them; a tolerable ordering skew for a failure path.)
/// - **LIFO matches git.** `UndoManager` pops newest-first, which is exactly the head-first
///   order the edits branch wants reverts in.
/// - **Out-of-band undos invalidate their record.** When an edit is undone by another path
///   (the chat row's Undo button), call ``invalidate(commit:)`` so ⌘Z doesn't replay a stale
///   action; when the transcript is cleared wholesale (reset conversation), call
///   ``invalidateAll()``. Each record registers against its own private token target, so
///   removal is per-record (`removeAllActions(withTarget:)` on that token), not stack-wide.
@MainActor
public final class EditUndoCoordinator {
    /// One applied edit, as registered on the undo stack.
    public struct Record: Sendable, Equatable {
        /// Source file the edit landed on (site-relative path). Drives the menu action name.
        public let file: String
        /// SHA of the commit on `refs/heads/anglesite/edits` that captures this edit — the
        /// record's identity. Stable across transcript reloads, unlike chat-row UUIDs.
        public let commit: String

        /// Memberwise initializer — built by the edit recorder from the applied reply's
        /// `file` + `commit` pair.
        public init(file: String, commit: String) {
            self.file = file
            self.commit = commit
        }
    }

    /// What actually happened when a popped record's reverse-apply resolved.
    public enum UndoOutcome: Sendable, Equatable {
        /// The edit was reverted. The record is spent.
        case undone
        /// The revert didn't happen but could later (MCP error, conflict sheet cancelled,
        /// MCP not running). The coordinator re-registers the record so ⌘Z can retry.
        case retryable
        /// The record no longer maps to an undoable edit (row gone or already undone via
        /// another path). Dropped without re-registering.
        case stale
    }

    /// Runs the reverse-apply for one record and reports what happened. Called on the main
    /// actor from a `Task` the coordinator spawns when the user invokes Edit ▸ Undo.
    public typealias Performer = @MainActor (Record) async -> UndoOutcome

    /// Per-record registration target. `UndoManager` does not retain targets, so each token is
    /// kept alive by the registered handler capturing it — its lifetime is exactly the
    /// lifetime of its undo-stack entry — and indexed in ``tokens`` for selective removal.
    private final class Token {
        let record: Record
        init(_ record: Record) { self.record = record }
    }

    /// The focused window's undo manager. Weak: the window owns it; this coordinator only
    /// registers into it. `nil` (no window attached yet) makes ``registerApplied(_:)`` a no-op.
    public weak var undoManager: UndoManager?

    private let perform: Performer
    /// Live registrations by commit SHA, so ``invalidate(commit:)`` can remove exactly one
    /// record's action. Entries are dropped when their undo fires or they're invalidated;
    /// a `.retryable` outcome re-inserts.
    private var tokens: [String: Token] = [:]
    /// The in-flight reverse-apply spawned by the most recent ⌘Z. Exposed for tests, which
    /// `await` it to observe the re-register-on-retryable behavior deterministically.
    private(set) var pendingPerform: Task<Void, Never>?

    /// The ``Performer`` is fixed at construction; ``undoManager`` is deliberately *not* a
    /// parameter — SwiftUI supplies it later (and can change it per focused window) via
    /// `@Environment(\.undoManager)`, so it stays a settable property instead.
    public init(perform: @escaping Performer) {
        self.perform = perform
    }

    /// Registers an applied edit on the undo stack. Call at apply time, right after the edit
    /// row is recorded. No-op when no ``undoManager`` is attached.
    public func registerApplied(_ record: Record) {
        guard let undoManager else { return }
        let token = Token(record)
        tokens[record.commit] = token
        // Explicit group per record: without one, registrations coalesce into whatever group is
        // open and a single ⌘Z would revert several edits at once. Under `groupsByEvent` (the
        // app default) this nests inside the run loop's event group, so edits applied in
        // *separate* main-run-loop turns — every real apply, since each arrives as its own MCP
        // reply hop — stay independent ⌘Z steps, while edits somehow registered in the same
        // turn batch into one ⌘Z (well-defined: reverts both, LIFO order within the group;
        // exercised by `sameRunLoopBurstBatchesUnderGroupsByEvent`). The explicit group is
        // load-bearing for run-loop-free consumers (unit tests set `groupsByEvent = false`),
        // where no implicit event group ever opens or closes around registrations.
        undoManager.beginUndoGrouping()
        // `token` is captured strongly by the handler on purpose: UndoManager holds its target
        // unsafely-unretained, so the capture pins the token (and nothing else — self is weak)
        // for exactly as long as the stack entry exists.
        undoManager.registerUndo(withTarget: token) { [weak self, token] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                // The stack entry is popped synchronously right now, whatever the async revert
                // later resolves to — mirror that in `tokens`, then re-arm on `.retryable`.
                self.tokens[token.record.commit] = nil
                self.pendingPerform = Task { @MainActor [weak self] in
                    guard let self else { return }
                    if await self.perform(token.record) == .retryable {
                        // Runs after `undo()` returned (`isUndoing` is false again), so this
                        // lands back on the undo stack — not the redo stack.
                        self.registerApplied(token.record)
                    }
                }
            }
        }
        // Named while the group is still open — the name attaches to the open group; after
        // `endUndoGrouping` there may be no group left to attach to.
        undoManager.setActionName(Self.actionName(for: record))
        undoManager.endUndoGrouping()
    }

    /// Removes a still-pending record from the undo stack — call after an edit was undone via
    /// another path (e.g. the chat row's Undo button) so ⌘Z skips it. No-op for unknown or
    /// already-fired records.
    public func invalidate(commit: String) {
        guard let token = tokens.removeValue(forKey: commit) else { return }
        undoManager?.removeAllActions(withTarget: token)
    }

    /// Drops every pending record — call when the transcript backing the records is cleared
    /// wholesale (reset conversation), so ⌘Z can't fire actions whose rows no longer exist.
    public func invalidateAll() {
        for token in tokens.values {
            undoManager?.removeAllActions(withTarget: token)
        }
        tokens.removeAll()
    }

    /// Menu action name for a record: "Edit <filename>" → the menu shows "Undo Edit <filename>".
    public static func actionName(for record: Record) -> String {
        let filename = record.file.split(separator: "/").last.map(String.init) ?? record.file
        return "Edit \(filename)"
    }
}
#endif
