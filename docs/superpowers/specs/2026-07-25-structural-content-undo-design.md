# Undo/redo for structural content operations

Issue: [#675](https://github.com/Anglesite/Anglesite-app/issues/675). Part of the Mac-assed app
polish audit — ⌘Z should cover everything destructive the app can do, not just AI edits.

## 1. Problem

[#527](https://github.com/Anglesite/Anglesite-app/issues/527) wired the window `UndoManager` into
the AI edit pipeline (`EditUndoCoordinator`), so assistant-applied content edits are undoable. The
structural operations are not:

| Operation | Entry points | Today |
|---|---|---|
| New Page / Post / Collection entry / Component | New-content sheets (`SiteWindow`) | not undoable |
| Duplicate page / post | ⌘D, navigator context menu | not undoable |
| Duplicate component | Component Editor palette | not undoable |
| Delete page / post | Edit ▸ Delete, bare Delete key (#674), context menu | bespoke one-shot "Undo" alert (#586) |
| Rename | inline navigator rename, File ▸ Rename… | not undoable |

Text editors rely on native per-field undo only; that stays as-is.

## 2. Key observation

Every operation in the table is a **single-file content transition**, and the app already owns both
halves of the primitive that realizes one:

- `NativeContentOperations.restoreContent(siteID:relativePath:contents:)` — write + commit.
- `NativeContentOperations.deleteContent(siteID:relativePath:)` — `git rm` + commit.

Both are already reached through `ContentCreationWorkflow`, which also rescans `SiteContentGraph`
on success. Every structural op commits, so the file an undo needs to delete is always present in
`HEAD` — satisfying `processGitDelete`'s `headHasEntry` precondition.

Rename is included in this framing because today's rename **rewrites the title in place** via
`PageTitleEditor`; it does not move the file. (The issue text anticipates a file move; that does not
exist and is out of scope here.)

So one record type covers all seven rows:

```swift
struct Mutation {
    let id: UUID
    let relativePath: String
    let before: String?   // nil ⇒ the file did not exist
    let after: String?    // nil ⇒ the file was deleted
    let actionName: String
}
```

| Operation | before | after |
|---|---|---|
| New / Duplicate | `nil` | created contents |
| Delete | captured contents | `nil` |
| Rename | pre-rewrite contents | post-rewrite contents |

Undo means *realize `before`*. Redo means *realize `after`* — which is just undoing the reversed
mutation. No per-operation inverse logic exists anywhere.

## 3. `ContentUndoCoordinator` (AnglesiteCore)

New `Sources/AnglesiteCore/ContentUndoCoordinator.swift`, `#if canImport(Darwin)`-gated exactly like
`EditUndoCoordinator` (`UndoManager` is Darwin-only Foundation). Lives in AnglesiteCore so `swift
test` covers the stack mechanics against a plain Foundation `UndoManager`.

```swift
@MainActor
public final class ContentUndoCoordinator {
    public struct Mutation: Sendable, Equatable, Identifiable { … var reversed: Mutation }
    public enum ApplyOutcome: Sendable, Equatable { case applied, failed }
    /// Realizes `mutation.before` at `mutation.relativePath`.
    public typealias Applier = @MainActor (Mutation) async -> ApplyOutcome

    public weak var undoManager: UndoManager?
    public init(apply: @escaping Applier)
    public func register(_ mutation: Mutation)
    public func invalidate(id: UUID)
    public func invalidateAll()
}
```

Per-record `Token` targets, captured strongly by the registered handler, indexed by `Mutation.id` —
the same ownership trick `EditUndoCoordinator` documents (`UndoManager` holds targets
unsafely-unretained), so `invalidate` is per-record rather than stack-wide.

### 3.1 Redo, and why it works here when it didn't for #527

`EditUndoCoordinator` has no redo because the sidecar exposes revert (`undo_edit`) but no re-apply
primitive. Here both directions are the same local write, so redo is free — provided the inverse
lands on the *redo* stack, which requires registering it while `UndoManager.isUndoing` is still
true. The apply is async and resolves long after `undo()` returns, so the registration cannot wait
for it.

The undo handler therefore registers **optimistically and synchronously**:

1. Drop this record from `tokens` (`UndoManager` popped it synchronously).
2. `register(mutation.reversed)` — `isUndoing`/`isRedoing` is true, so it lands on the opposite
   stack with the same action name.
3. Spawn the async apply. On `.failed`, `invalidate(id:)` the inverse and `register(mutation)`
   again — by then neither flag is set, so the original returns to the undo stack. This is the same
   failure-re-arm shape #527 uses, generalized to both directions.

`register` opens an explicit undo group **only** when not undoing/redoing. During undo/redo,
`UndoManager` has already opened the group for the opposite stack; nesting one inside it would
attach the action name to the nested group and leave Edit ▸ Redo reading a bare "Redo".

### 3.2 Action names

Built by `ContentUndoCoordinator.actionName(…)` static helpers in AnglesiteCore, mirroring
`EditUndoCoordinator.actionName(for:)`. They are plain (unlocalized) strings: `setActionName` takes
a `String`, not a `LocalizedStringKey`, and keeping them in AnglesiteCore stays consistent with the
#527 precedent and out of `check-localization-catalog.sh`'s `Sources/AnglesiteApp` scan. Menu reads
`Undo Delete “About”`, `Undo New Page`, `Undo Duplicate`, `Undo Rename`.

## 4. App wiring (thin)

`SiteWindowModel` gains:

- `contentUndoCoordinator`, a lazy `ContentUndoCoordinator` whose applier is
  `applyContentUndo(_:)`; attached to `windowUndoManager` in the existing `didSet` beside
  `chat?.editUndoCoordinator` and again in `loadAndStart`.
- `applyContentUndo(_:)` — ~25 lines. `before == nil` ⇒ close any editor/inspector on the file, then
  `contentCreation.deleteContent`, clear navigator selection, refresh. Otherwise
  `contentCreation.restoreContent`, refresh, and reopen surfaces (§4.2). Failures set
  `contentActionError` and report `.failed`.
- `registerContentUndo(actionName:relativePath:before:after:)` — one call per op site.

Call sites (`createPage`, `createPost`, `createCollectionEntry`, `createComponent`,
`duplicate(id:)`, `duplicateComponent`, `confirmDelete`) register on `.created`/`.deleted`. Creates
and duplicates read the newly written file once to capture `after`; delete already captures
`savedContents` before the delete call.

`SiteNavigatorModel` gains a `registerUndo: ((ContentUndoCoordinator.Mutation) -> Void)?` callback,
set by `SiteWindowModel` when it builds the navigator, and calls it from `commitEditing()`.

### 4.1 `NavigatorRenameService` returns both sides

`rename(…)` changes from `Result<String, RenameError>` to `Result<RenameOutcome, RenameError>`:

```swift
public struct RenameOutcome: Sendable, Equatable {
    public let title: String
    public let previousContents: String
    public let newContents: String
}
```

It already loads the file and computes the rewrite, so this exposes what it has rather than adding
work. Undoing a rename rewrites the file; `ContentCreationWorkflow.restoreContent` rescans the
graph, so the navigator picks the old title back up with no extra plumbing.

### 4.2 Retiring the bespoke delete-undo alert

`DeleteUndoOffer`, `pendingDeleteUndo`, `pendingDeleteUndoEditor`, `pendingDeleteUndoInspector`,
`undoDelete()`, `dismissDeleteUndo()`, and the `SiteWindow` alert that hosts them are deleted. ⌘Z is
the single delete-recovery path.

Two behaviors that alert owned move:

- **"Add Redirect?" prompt (#530/#584)** was deferred until the user declined to undo. With no
  alert to decline, `confirmDelete()` sets `pendingRedirectOfferRoute` directly on success.
- **Reopening the editor/inspector the delete closed** (PR #608 review: "an undo that brings the
  file back but leaves the user staring at Preview would be only half a restore") is preserved and
  generalized. `SiteWindowModel` keeps `closedSurfaces: [String: …]`, keyed by relative path,
  written whenever a delete closes surfaces (both `confirmDelete` and `applyContentUndo`'s delete
  branch) and consumed when a restore for that path lands. `confirmDelete`'s existing
  restore-on-`.failed` behavior is unchanged. Entries are removed on consumption and cleared on site
  change, so the map cannot grow unbounded.

The delete confirmation dialog's message changes from "You can undo it right after deleting." to
point at Edit ▸ Undo, which requires a `Localizable.xcstrings` sync per CONTRIBUTING.

## 5. Scope

**In:** the seven rows in §1's table.

**Out:** Cleanup's dead-asset delete (`deleteCleanupCandidate` routes through `ProjectCleanupModel`,
not `contentCreation`); Publish/Unpublish (#798 — each already has an explicit inverse verb in the
UI); file-moving rename; text-editor field undo.

## 6. Testing

- **`ContentUndoCoordinatorTests`** (AnglesiteCoreTests, new) — registration and action name;
  ⌘Z invokes the applier with the right record; the inverse lands on the redo stack and redo
  applies the other side; a full undo→redo→undo cycle; failed apply removes the inverse and
  re-arms the original on the undo stack; `invalidate(id:)`/`invalidateAll()`; no-op with no
  `undoManager`. `groupsByEvent = false` in tests, as `EditUndoCoordinatorTests` does.
- **`NavigatorRenameServiceTests`** — updated for `RenameOutcome`, asserting both contents sides.
- **`SiteWindowModelTests`** — the three `pendingDeleteUndo`/`dismissDeleteUndo` tests are replaced
  by coverage of `applyContentUndo` (restore and delete directions against a temp site) and of the
  now-immediate redirect offer.

## 7. Acceptance mapping

| Issue acceptance criterion | Where |
|---|---|
| Each op undoable **and** redoable with a correct action name | §3.1, §3.2 |
| Undo of a delete restores byte-identical content, navigator reflects it | `restoreContent` writes captured contents verbatim; `ContentCreationWorkflow` rescans, `applyContentUndo` calls `navigator?.refreshNow()` |
| Dev-server preview picks up the restored file | unchanged from #586 — the restore is a real write into `Source/`, which Astro's watcher sees |
