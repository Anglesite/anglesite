# Drag & drop completeness — design

**Issue:** #676 — Drag & drop completeness: drag sites and content items out; richer drop feedback
**Date:** 2026-07-27
**Status:** Approved design; ready for implementation planning.

## Goal

Part of the Mac-assed app polish audit (mac-assed-app-spec.md). Today drag & drop
in Anglesite is one-directional: the launcher accepts `.anglesite` package drops
(`SitesLauncherView.swift`, #524), but nothing can be dragged *out* of the app, and
the launcher's drop target gives no visible feedback beyond the system default.
This closes both gaps:

1. Launcher rows draggable out (as `.anglesite` package file URLs).
2. Navigator items draggable out (as their `Source/` file URLs).
3. Explicit `isTargeted` highlight on the launcher drop target.

## Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Drop-highlight fidelity | Simple hover highlight — reuse `.dropDestination(for: URL.self)`'s existing `isTargeted:` closure. Highlights for any file-URL drag over the list, not just valid `.anglesite` packages. The drop-accept logic (filter to `.anglesite` extension) is unchanged. |
| Navigator drag scope | Only `.route` (page/post) and `.file` (component/style/metadata) targets are draggable. `.directory` and `.websiteSettings` targets are not — no single backing file, and navigator reordering is an explicit non-goal (content order is filesystem/frontmatter-derived). |
| Navigator route→file resolution | Add a synchronous `routeFileURLs: [String: URL]` cache built during `SiteNavigatorModel.refresh()` (alongside the existing `postsByID`/`postIDs` caches), since `.draggable`'s payload closure runs synchronously at drag-start and can't await the graph actor. |

## 1. Launcher rows draggable

`SitesLauncherView.swift`'s `siteList` renders each `SiteStore.Site` row as a
`Button` label (line ~141). Add `.draggable(site.packageURL)` to the label's
`HStack`. `URL` already conforms to `Transferable` — the launcher's own
`dropDestination(for: URL.self)` proves this works round-trip in this app. No
change needed for invalid/dead sites (`!site.isValid`): the package URL is still
draggable even if the site can't currently be opened (e.g. `needsReauthorization`)
since it's just a file-system path.

## 2. Launcher drop highlight

Extend the existing `.dropDestination(for: URL.self) { urls, _ in ... }` call
(line ~193) with its `isTargeted:` trailing closure:

```swift
.dropDestination(for: URL.self) { urls, _ in
    ... // unchanged accept logic
} isTargeted: { targeted in
    isDropTargeted = targeted
}
```

Add `@State private var isDropTargeted = false` and apply a visible highlight
(accent-colored border/background, matching platform drag-and-drop convention)
to `siteList` when `isDropTargeted` is true. Since the highlight fires for any
file-URL drag (not just `.anglesite` packages), no additional validation code is
needed — the accept/reject distinction stays in the closure body as it is today.

## 3. Navigator items draggable out

`SiteNavigatorView.swift`'s `row(for:)` renders each `URLTreeNode` as a `Label`.
Add a conditional `.draggable(url)` using a new accessor on `SiteNavigatorModel`:

```swift
func fileURL(for id: String) -> URL? {
    guard case .route = target(for: id) else { return nil }
    return routeFileURLs[id]
}
```

`NavigatorTarget` also has a `.file(FileRef)` case, but `URLTreeNode.Kind` has no
case that currently produces it (components/styles moved out of the navigator
tree in #714 slice 1 — see the `SiteNavigatorModelTests` comment on that), so
`target(for:)` can never actually return `.file` today. Handling only `.route`
here (rather than exhaustively naming the unreachable `.file`/`.directory`/
`.websiteSettings` cases) avoids dead code for a case nothing can construct; when
`.file` rows come back to the tree, this accessor gets a `case .file(let ref):
return ref.url` branch alongside it.

`routeFileURLs` is populated in `refresh(siteID:siteRoot:)` right where `pages`
and `posts` are already fetched, mirroring how `postsByID` is built today:

```swift
var routeFileURLs: [String: URL] = [:]
if let sourceDirectory {
    for page in pages { routeFileURLs[page.id] = sourceDirectory.appendingPathComponent(page.filePath) }
    for post in posts { routeFileURLs[post.id] = sourceDirectory.appendingPathComponent(post.filePath) }
}
```

In the view, the non-editing row branch wraps its existing `Label` in an `if let`
so only rows with a resolvable file URL become draggable:

```swift
if let url = model.fileURL(for: node.id) {
    rowLabel(for: node).draggable(url)
} else {
    rowLabel(for: node)
}
```

where `rowLabel(for:)` is the existing `Label { Text(node.title) } icon: { icon(for: node) }`
plus its `.tag`/`.contextMenu` chain, factored out so it isn't duplicated between
the two branches.

## Testing

- `AnglesiteCoreTests`: unit-test the `routeFileURLs` population logic (page/post
  id → expected `sourceDirectory`-relative URL) if it's extracted into a testable
  pure function; otherwise cover indirectly through `SiteNavigatorModel`'s existing
  refresh tests.
- No new Swift Testing target needed — this is additive to existing
  `SiteNavigatorModel`/`SitesLauncherView` coverage.
- Manual QA (drag-and-drop has no good headless test path on macOS): drag a
  launcher row to Finder/Desktop, confirm the `.anglesite` package copies/moves;
  drag a navigator page/component row to Finder, confirm the source file copies;
  drag a `.anglesite` package (and, separately, some other file) over the launcher
  list and confirm the highlight appears in both cases (simple-highlight decision
  above — this is expected, not a bug).

## Non-goals

- Navigator drag-to-reorder (content order is filesystem/frontmatter-derived,
  `.onMove` has no meaningful model behind it).
- Content-type-validated drop highlighting (rejected in favor of the simpler
  any-file-URL highlight — see Decisions table).
- Dragging `.directory`/`.websiteSettings` navigator rows (no single backing file).
