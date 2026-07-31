// UndoManager is a Darwin-only Foundation type, so this bridge — used only by the app target's
// SiteWindowModel/SiteNavigatorModel — compiles out elsewhere, exactly like `EditUndoCoordinator`.
// See the cross-platform port design doc §5: a portable in-memory undo stack can slot in behind the
// same public API if/when a Linux/Windows GUI shell needs one.
#if canImport(Darwin)
import Foundation

/// Bridges *structural* content operations — New Page/Post/Collection entry/Component, Duplicate,
/// Delete, Rename — into a window's `UndoManager` so Edit ▸ Undo (⌘Z) and Edit ▸ Redo (⇧⌘Z)
/// reverse and replay them (#675).
///
/// Sibling of ``EditUndoCoordinator`` (#527), which covers assistant-applied *content* edits. The
/// two register into the same window `UndoManager` and interleave LIFO, as `UndoManager` does for
/// any set of clients.
///
/// ## One record type for every operation
///
/// Every structural operation is a single-file content transition, so one ``Mutation`` — a
/// `(relativePath, before, after)` snapshot pair, `nil` meaning "the file does not exist" — covers
/// all of them:
///
/// | Operation      | `before`          | `after`           |
/// |----------------|-------------------|-------------------|
/// | New, Duplicate | `nil`             | created contents  |
/// | Delete         | captured contents | `nil`             |
/// | Rename         | pre-rewrite       | post-rewrite      |
///
/// Undo means *realize `before`*; redo means *realize `after`*, which is just undoing
/// ``Mutation/reversed``. There is no per-operation inverse logic anywhere — the injected
/// ``Applier`` only has to write contents or delete a file, which the app already does through
/// `ContentCreationWorkflow.restoreContent` / `.deleteContent`.
///
/// ## Policy notes
///
/// - **Redo works here** (unlike #527, whose reverse-apply is a sidecar git revert with no
///   re-apply primitive). See ``register(_:)`` for the ordering that makes it work with an
///   asynchronous applier. (`perform(_:)` is the private popped-record apply path.)
/// - **Failure re-arms ⌘Z.** `UndoManager` pops the entry synchronously the instant ⌘Z fires,
///   long before the async apply resolves. On ``ApplyOutcome/failed`` the optimistically-registered
///   inverse is removed and, for a failed undo, the original record re-registered — the same shape
///   ``EditUndoCoordinator`` uses for its retryable outcome. A failed *redo* can only be dropped;
///   see `perform(_:)`.
/// - **Out-of-band invalidation.** Each record registers against its own private token target, so
///   ``invalidate(id:)`` removes exactly one record (`removeAllActions(withTarget:)` on that
///   token) rather than clearing the stack. ``invalidateAll()`` drops every pending record — call
///   it when the window's site is replaced, since paths and contents are site-relative.
@MainActor
public final class ContentUndoCoordinator {
    /// One structural operation, as a before/after snapshot of the single file it touched.
    public struct Mutation: Sendable, Equatable, Identifiable {
        /// Record identity. Not the path: a path can legitimately have several live records
        /// (create → delete → restore), and ``invalidate(id:)`` must remove exactly one.
        public let id: UUID
        /// The file the operation touched, relative to the site's `Source/` directory.
        public let relativePath: String
        /// Contents before the operation, or `nil` if the file did not exist. Undo realizes this.
        public let before: String?
        /// Contents after the operation, or `nil` if the operation deleted the file.
        public let after: String?
        /// Menu action name, e.g. `Delete “About”` → Edit ▸ Undo reads "Undo Delete “About”".
        /// Carried on the record so it survives onto the redo entry unchanged.
        public let actionName: String

        /// Creates a record; each property documents its own contract. `id` defaults to a fresh
        /// identity — every registration is a distinct record, including a ``reversed`` twin.
        public init(id: UUID = UUID(), relativePath: String, before: String?, after: String?, actionName: String) {
            self.id = id
            self.relativePath = relativePath
            self.before = before
            self.after = after
            self.actionName = actionName
        }

        /// The same transition read backwards — a fresh record (new ``id``) whose undo realizes
        /// this one's ``after``. Registered by the undo handler to populate the redo stack.
        public var reversed: Mutation {
            Mutation(relativePath: relativePath, before: after, after: before, actionName: actionName)
        }
    }

    /// What happened when a popped record's apply resolved.
    public enum ApplyOutcome: Sendable, Equatable {
        /// ``Mutation/before`` is now on disk. The record is spent (its inverse is on the
        /// opposite stack).
        case applied
        /// The write or delete didn't happen (git refused, no site open, I/O error). The
        /// coordinator drops the inverse it optimistically pushed. A failed **undo** is then
        /// re-registered so ⌘Z can retry; a failed **redo** is dropped — see `perform(_:)`.
        case failed
    }

    /// Realizes `mutation.before` at `mutation.relativePath`: `nil` means delete the file,
    /// non-`nil` means write those exact bytes. Called on the main actor from a `Task` the
    /// coordinator spawns when the user invokes Edit ▸ Undo or Edit ▸ Redo.
    public typealias Applier = @MainActor (Mutation) async -> ApplyOutcome

    /// Per-record registration target. `UndoManager` does not retain targets, so each token is
    /// kept alive by the registered handler capturing it — its lifetime is exactly the lifetime of
    /// its stack entry — and indexed in ``tokens`` for selective removal.
    private final class Token {
        let mutation: Mutation
        init(_ mutation: Mutation) { self.mutation = mutation }
    }

    /// The focused window's undo manager. Weak: the window owns it; this coordinator only
    /// registers into it. `nil` (no window attached yet) makes ``register(_:)`` a no-op.
    public weak var undoManager: UndoManager?

    private let apply: Applier
    /// Live registrations by record id, on either stack. Entries are dropped when their handler
    /// fires and re-inserted by the re-arm path.
    private var tokens: [UUID: Token] = [:]
    /// The in-flight apply spawned by the most recent ⌘Z/⇧⌘Z. Exposed for tests, which `await` it
    /// to observe the settled stack state deterministically.
    private(set) var pendingApply: Task<Void, Never>?

    /// Creates a coordinator that realizes popped records through `apply`. Attach
    /// ``undoManager`` separately — the coordinator is typically built before the window (and
    /// therefore its undo manager) exists, and registration is a safe no-op until one is set.
    public init(apply: @escaping Applier) {
        self.apply = apply
    }

    /// Registers a completed structural operation. Call at operation time, right after the write
    /// lands. No-op when no ``undoManager`` is attached.
    ///
    /// Also the mechanism behind redo: the undo handler calls this with ``Mutation/reversed``
    /// while `UndoManager.isUndoing` is still true, so the entry lands on the redo stack. That
    /// registration is **optimistic** — it happens synchronously, before the async ``Applier``
    /// resolves, because `undo()` returns (and clears `isUndoing`) long before it does and a later
    /// registration would land back on the undo stack instead. ``ApplyOutcome/failed`` rolls the
    /// optimism back.
    public func register(_ mutation: Mutation) {
        guard let undoManager else { return }
        let token = Token(mutation)
        tokens[mutation.id] = token

        // Open an explicit group only outside undo/redo processing. Outside, this is what keeps
        // each operation an independent ⌘Z step (see EditUndoCoordinator's fuller note on
        // `groupsByEvent`). Inside, `UndoManager` has already opened the group for the opposite
        // stack; nesting one within it would attach `setActionName` to the *nested* group and
        // leave Edit ▸ Redo reading a bare "Redo".
        let opensGroup = !undoManager.isUndoing && !undoManager.isRedoing
        if opensGroup { undoManager.beginUndoGrouping() }
        // `token` is captured strongly on purpose: UndoManager holds its target
        // unsafely-unretained, so the capture pins the token (and nothing else — self is weak)
        // for exactly as long as the stack entry exists.
        undoManager.registerUndo(withTarget: token) { [weak self, token] _ in
            MainActor.assumeIsolated {
                self?.perform(token.mutation)
            }
        }
        undoManager.setActionName(mutation.actionName)
        if opensGroup { undoManager.endUndoGrouping() }
    }

    /// Removes a still-pending record from either stack — call when the record can no longer be
    /// meaningfully applied. No-op for unknown or already-fired records.
    public func invalidate(id: UUID) {
        guard let token = tokens.removeValue(forKey: id) else { return }
        undoManager?.removeAllActions(withTarget: token)
    }

    /// Drops every pending record — call when the window's site changes, since every record's
    /// path and contents belong to the site it was captured from.
    public func invalidateAll() {
        for token in tokens.values {
            undoManager?.removeAllActions(withTarget: token)
        }
        tokens.removeAll()
    }

    /// Runs one popped record: put its inverse on the opposite stack, then realize `before`.
    private func perform(_ mutation: Mutation) {
        // The stack entry is popped synchronously right now, whatever the async apply later
        // resolves to — mirror that in `tokens` before anything else.
        tokens[mutation.id] = nil
        // Which stack this record came off, captured while the flag is still set. Determines
        // whether the failure path below can re-arm it (see ``ApplyOutcome/failed``).
        let wasUndo = undoManager?.isUndoing ?? false
        let inverse = mutation.reversed
        register(inverse)

        pendingApply = Task { @MainActor [weak self] in
            guard let self else { return }
            guard await self.apply(mutation) == .failed else { return }
            // Nothing changed on disk, so the inverse we optimistically pushed onto the opposite
            // stack describes a transition that never happened — drop it.
            self.invalidate(id: inverse.id)
            // Re-arming is only possible in one direction. This runs after `undo()`/`redo()`
            // returned, so both flags are false and `register` necessarily lands on the *undo*
            // stack — right for a failed undo, a lie for a failed redo. `UndoManager` exposes no
            // way to push onto the redo stack outside an undo pass, so a failed redo drops the
            // record instead of parking a transition on ⌘Z that the user never performed. That
            // is the honest end state either way: after a failed undo the operation is still
            // undoable (⌘Z retries — matching `EditUndoCoordinator`'s retryable policy, and the
            // case that actually matters, e.g. a restore that couldn't recommit); after a failed
            // redo the disk is already in the undone state, so ⌘Z would be a no-op anyway. Both
            // surface the reason through the applier's own error reporting.
            guard wasUndo else { return }
            self.register(mutation)
        }
    }

    // MARK: - Action names

    /// Menu action name for creating `displayName`: "New Page" → the menu reads "Undo New Page".
    /// Plain (unlocalized) strings, matching ``EditUndoCoordinator/actionName(for:)`` — and kept
    /// here rather than in the app target so they stay out of `check-localization-catalog.sh`'s
    /// `Sources/AnglesiteApp` scan, which has no way to see through `setActionName`'s `String`.
    public static func createActionName(_ displayName: String) -> String { "New \(displayName)" }

    /// Menu action name for a duplicate: "Duplicate “About”".
    public static func duplicateActionName(_ title: String) -> String { "Duplicate \(quoted(title))" }

    /// Menu action name for a delete: "Delete “About”".
    public static func deleteActionName(_ title: String) -> String { "Delete \(quoted(title))" }

    /// Menu action name for a rename. The *new* title is deliberately absent: the record is
    /// applied in both directions and naming one end would read backwards after a redo.
    public static func renameActionName() -> String { "Rename" }

    private static func quoted(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Item" : "\u{201C}\(trimmed)\u{201D}"
    }
}
#endif
