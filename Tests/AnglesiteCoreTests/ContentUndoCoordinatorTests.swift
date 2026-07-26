import Foundation
import Testing
@testable import AnglesiteCore

/// Unit tests for ``ContentUndoCoordinator`` — the AnglesiteCore piece of #675 that turns each
/// structural content operation (New / Duplicate / Delete / Rename) into a window `UndoManager`
/// record, undoable *and* redoable.
///
/// Every test drives a real Foundation `UndoManager` (no window needed). The applier is a spy that
/// maintains an in-memory `path → contents` "disk", so a full undo→redo cycle can be asserted on
/// the resulting file state rather than only on which records were popped. ⌘Z pops the stack entry
/// synchronously but resolves the apply in a `Task`; tests await `pendingApply` to observe the
/// settled state.
@MainActor
struct ContentUndoCoordinatorTests {
    /// In-memory stand-in for the app's `restoreContent`/`deleteContent` pair: applying a
    /// mutation writes `before` at `relativePath`, or removes the entry when `before` is nil.
    private final class ApplySpy {
        var disk: [String: String] = [:]
        var applied: [ContentUndoCoordinator.Mutation] = []
        var outcome: ContentUndoCoordinator.ApplyOutcome = .applied

        func apply(_ mutation: ContentUndoCoordinator.Mutation) -> ContentUndoCoordinator.ApplyOutcome {
            applied.append(mutation)
            guard outcome == .applied else { return outcome }
            disk[mutation.relativePath] = mutation.before
            return .applied
        }
    }

    /// A run-loop-free `UndoManager`. With the default `groupsByEvent`, the implicit event group
    /// opens at the first registration and never closes (tests don't spin the run loop), so a
    /// single `undo()` would pop every registration at once. Disabling it makes the coordinator's
    /// explicit per-record group the top-level group — the same shape production gets from one
    /// operation per main-run-loop turn. Matches `EditUndoCoordinatorTests`.
    private func makeUndoManager() -> UndoManager {
        let undoManager = UndoManager()
        undoManager.groupsByEvent = false
        return undoManager
    }

    private func makeCoordinator(undoManager: UndoManager?) -> (ContentUndoCoordinator, ApplySpy) {
        let spy = ApplySpy()
        let coordinator = ContentUndoCoordinator { mutation in spy.apply(mutation) }
        coordinator.undoManager = undoManager
        return (coordinator, spy)
    }

    private func creation(
        path: String = "src/pages/about.astro",
        contents: String = "created",
        actionName: String = "New Page"
    ) -> ContentUndoCoordinator.Mutation {
        ContentUndoCoordinator.Mutation(
            relativePath: path, before: nil, after: contents, actionName: actionName)
    }

    private func deletion(
        path: String = "src/pages/about.astro",
        contents: String = "deleted contents",
        actionName: String = "Delete \u{201C}About\u{201D}"
    ) -> ContentUndoCoordinator.Mutation {
        ContentUndoCoordinator.Mutation(
            relativePath: path, before: contents, after: nil, actionName: actionName)
    }

    // MARK: - Registration

    @Test func registeredMutationIsUndoableAndUndoAppliesTheBeforeSide() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        spy.disk["src/pages/about.astro"] = "created"
        let mutation = creation()

        #expect(!undoManager.canUndo)
        coordinator.register(mutation)
        #expect(undoManager.canUndo)

        undoManager.undo()
        await coordinator.pendingApply?.value

        // Undoing a create deletes the file.
        #expect(spy.applied == [mutation])
        #expect(spy.disk["src/pages/about.astro"] == nil)
        #expect(!undoManager.canUndo)
    }

    @Test func actionNameCarriesThroughToTheMenu() {
        let undoManager = makeUndoManager()
        let (coordinator, _) = makeCoordinator(undoManager: undoManager)

        coordinator.register(deletion())

        #expect(undoManager.undoActionName == "Delete \u{201C}About\u{201D}")
    }

    @Test func registeringWithoutAnUndoManagerIsANoOp() {
        let (coordinator, spy) = makeCoordinator(undoManager: nil)

        coordinator.register(creation())

        #expect(spy.applied.isEmpty)
    }

    @Test func multipleMutationsUndoInLIFOOrder() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        let first = creation(path: "src/pages/one.astro")
        let second = creation(path: "src/pages/two.astro")

        coordinator.register(first)
        coordinator.register(second)

        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.applied.map(\.relativePath) == ["src/pages/two.astro"])

        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.applied.map(\.relativePath) == ["src/pages/two.astro", "src/pages/one.astro"])
    }

    // MARK: - Redo

    @Test func undoPutsTheInverseOnTheRedoStackWithTheSameActionName() async {
        let undoManager = makeUndoManager()
        let (coordinator, _) = makeCoordinator(undoManager: undoManager)

        coordinator.register(deletion())
        undoManager.undo()
        await coordinator.pendingApply?.value

        // Unlike EditUndoCoordinator (whose reverse-apply is a sidecar git revert with no
        // re-apply primitive), both directions here are ordinary local writes — so redo exists.
        #expect(undoManager.canRedo)
        #expect(undoManager.redoActionName == "Delete \u{201C}About\u{201D}")
        #expect(!undoManager.canUndo)
    }

    @Test func redoAppliesTheAfterSideAndRearmsUndo() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        spy.disk["src/pages/about.astro"] = nil
        let mutation = deletion(contents: "# About\n")

        coordinator.register(mutation)

        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.disk["src/pages/about.astro"] == "# About\n")   // restored

        undoManager.redo()
        await coordinator.pendingApply?.value
        #expect(spy.disk["src/pages/about.astro"] == nil)           // deleted again
        #expect(undoManager.canUndo)
        #expect(!undoManager.canRedo)
        #expect(undoManager.undoActionName == mutation.actionName)
    }

    @Test func undoRedoUndoCyclesWithoutDrift() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        spy.disk["src/pages/about.astro"] = "renamed"

        coordinator.register(ContentUndoCoordinator.Mutation(
            relativePath: "src/pages/about.astro",
            before: "original", after: "renamed", actionName: "Rename"))

        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.disk["src/pages/about.astro"] == "original")

        undoManager.redo()
        await coordinator.pendingApply?.value
        #expect(spy.disk["src/pages/about.astro"] == "renamed")

        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.disk["src/pages/about.astro"] == "original")
        #expect(undoManager.canRedo)
        #expect(!undoManager.canUndo)
    }

    // MARK: - Failure re-arm

    @Test func failedApplyDropsTheInverseAndRearmsTheOriginal() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        spy.disk["src/pages/about.astro"] = "created"
        let mutation = creation()
        spy.outcome = .failed

        coordinator.register(mutation)
        undoManager.undo()
        await coordinator.pendingApply?.value

        // Nothing happened on disk, so the optimistically-pushed redo entry describes a
        // transition that never occurred — it must be gone, and ⌘Z must still reach the record.
        #expect(spy.disk["src/pages/about.astro"] == "created")
        #expect(!undoManager.canRedo)
        #expect(undoManager.canUndo)
        #expect(undoManager.undoActionName == "New Page")

        // The retry succeeds and the record is spent, redo now armed.
        spy.outcome = .applied
        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.applied.count == 2)
        #expect(spy.disk["src/pages/about.astro"] == nil)
        #expect(!undoManager.canUndo)
        #expect(undoManager.canRedo)
    }

    @Test func failedRedoDropsTheRecordRatherThanMigratingItOntoTheUndoStack() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        spy.disk["src/pages/about.astro"] = nil

        coordinator.register(deletion(contents: "# About\n"))
        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(undoManager.canRedo)
        #expect(spy.disk["src/pages/about.astro"] == "# About\n")

        spy.outcome = .failed
        undoManager.redo()
        await coordinator.pendingApply?.value

        // `UndoManager` can't be handed a redo entry outside an undo pass, so the record can't be
        // re-armed in the direction it came from. It must be dropped, not silently migrated onto
        // the undo stack — that would park a "Undo Delete “About”" on ⌘Z for a delete that never
        // happened, whose apply would restore a file that is already present.
        #expect(!undoManager.canUndo)
        #expect(!undoManager.canRedo)
        #expect(spy.disk["src/pages/about.astro"] == "# About\n")
    }

    // MARK: - Invalidation

    @Test func invalidateRemovesTheRecordFromTheStack() {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        let mutation = creation()

        coordinator.register(mutation)
        coordinator.invalidate(id: mutation.id)

        #expect(!undoManager.canUndo)
        #expect(spy.applied.isEmpty)
    }

    @Test func invalidateOnlyRemovesTheMatchingRecord() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)
        let kept = creation(path: "src/pages/one.astro")
        let dropped = creation(path: "src/pages/two.astro")

        coordinator.register(kept)
        coordinator.register(dropped)
        coordinator.invalidate(id: dropped.id)

        #expect(undoManager.canUndo)
        undoManager.undo()
        await coordinator.pendingApply?.value
        #expect(spy.applied.map(\.relativePath) == ["src/pages/one.astro"])
        #expect(!undoManager.canUndo)
    }

    @Test func invalidateForAnUnknownIDIsANoOp() {
        let undoManager = makeUndoManager()
        let (coordinator, _) = makeCoordinator(undoManager: undoManager)

        coordinator.register(creation())
        coordinator.invalidate(id: UUID())

        #expect(undoManager.canUndo)
    }

    @Test func invalidateAllDropsEveryPendingRecordIncludingRedoEntries() async {
        let undoManager = makeUndoManager()
        let (coordinator, spy) = makeCoordinator(undoManager: undoManager)

        coordinator.register(creation(path: "src/pages/one.astro"))
        coordinator.register(deletion(path: "src/pages/two.astro"))
        undoManager.undo()                       // pops the delete, arming a redo entry
        await coordinator.pendingApply?.value
        #expect(undoManager.canRedo)

        spy.applied.removeAll()
        coordinator.invalidateAll()

        // A site swap invalidates both directions: paths and contents belong to the old site.
        #expect(!undoManager.canUndo)
        #expect(!undoManager.canRedo)
        #expect(spy.applied.isEmpty)
    }

    // MARK: - Action names

    @Test func actionNamesReadCorrectlyInTheEditMenu() {
        #expect(ContentUndoCoordinator.createActionName("Page") == "New Page")
        #expect(ContentUndoCoordinator.createActionName("Component") == "New Component")
        #expect(ContentUndoCoordinator.duplicateActionName("About") == "Duplicate \u{201C}About\u{201D}")
        #expect(ContentUndoCoordinator.deleteActionName("  About  ") == "Delete \u{201C}About\u{201D}")
        #expect(ContentUndoCoordinator.renameActionName() == "Rename")
    }

    @Test func actionNameFallsBackWhenTheTitleIsBlank() {
        // Untitled `.astro` pages reach Delete with an empty title; "Delete “”" would read as a bug.
        #expect(ContentUndoCoordinator.deleteActionName("") == "Delete Item")
        #expect(ContentUndoCoordinator.duplicateActionName("   ") == "Duplicate Item")
    }
}
