# Site search surfaces — design (#520)

Date: 2026-07-26
Issue: [#520](https://github.com/Anglesite/Anglesite-app/issues/520) (toolbar search field), part of [#518](https://github.com/Anglesite/Anglesite-app/issues/518)
Backend: [#765](https://github.com/Anglesite/Anglesite-app/issues/765), landed as `Sources/AnglesiteCore/SiteSearchIndex.swift` (PR #952)

## Problem

`SiteSearchIndex` shipped with zero consumers. Two search surfaces are still missing:

1. **In-app** — the site window has no `.searchable`, so there is no way to find content by
   name or text. The Apple-native trailing toolbar search slot is empty, and
   `Edit ▸ Find ▸ Search Site…` is still a disabled `PlannedItem`
   (`Sources/AnglesiteApp/EditMenuSkeletonCommands.swift:41`).
2. **Reader-facing** — a published site offers visitors no search at all. For a long-running
   blog (the kottke.org persona exercise on #520: tens of thousands of posts across decades),
   archive search is a daily workflow for both the author and their readers.

## Scope

Two independent deliverables, landing as two focused PRs (CONTRIBUTING ▸ "Keep PRs focused").
They share no code: one is Swift app UI, the other is an Astro template feature with an npm
dependency, a build step, and a CSP change.

- **PR 1 — app-side site search.** Closes #520.
- **PR 2 — Pagefind reader search.** Template-only; filed as its own issue from #520's comment.

Non-goals: in-editor find (#517, already live for Markdown via #797), a full in-app search
*results pane*, and semantic/RAG reranking of results — `SiteSearchIndex` deliberately wraps
`SiteKnowledgeIndex.search()` lexically, because a toolbar field wants fast literal matching.

## PR 1 — app-side site search

### Architecture

CI does not run hosted app-target tests (CLAUDE.md ▸ "Build"), so every decision worth testing
lives in `AnglesiteCore` as a pure type, and the app target holds only SwiftUI glue. This is the
`TokenOnboarding` precedent.

#### `AnglesiteCore/SiteSearchScope`

The user-facing kind filter behind `.searchScopes`:

| Case | `SiteKnowledgeIndex.Document.Kind` set passed to `SiteSearchIndex.search(kinds:)` |
|---|---|
| `all` | `nil` (no filter) |
| `pages` | `[.page]` |
| `posts` | `[.post, .content]` |
| `components` | `[.component, .layout]` |
| `styles` | `[.style]` |

A test freezes the case list and each mapping. `all` maps to `nil`, not to the union of every
kind: an explicit set would silently exclude `.config`/`.script`/`.other` documents that the
index does hold.

#### `AnglesiteCore/SiteSearchDestination`

The activation decision, as a pure function:

```swift
public enum SiteSearchDestination: Equatable {
    case navigator(id: String)
    case file(path: String, group: FileGroup)

    public static func resolve(
        hit: SiteSearchIndex.Hit,
        navigatorRouteIDs: [String: String]   // route → navigator node id
    ) -> SiteSearchDestination
}
```

A hit whose `route` matches a live navigator row resolves to `.navigator` so the sidebar,
preview, inspector, and Related Pages panel all stay in sync with what the user picked.
Everything else resolves to `.file`, mapping kind → `FileGroup`:

| Kind | `FileGroup` |
|---|---|
| `.page` | `.pages` |
| `.post`, `.content` | `.posts` |
| `.component`, `.layout` | `.components` |
| `.style` | `.styles` |
| `.config` | `.metadata` |
| `.script`, `.other` | `.components` |

`.script`/`.other` fall to `.components` because `EditorKind.resolve` reads the group only to
choose an editor, and those files are plain text the component/text editor already handles.

A hit with a non-`nil` route that matches no navigator row still resolves to `.file` — that is
the documented `ContentRouteResolver` caveat (a convention-derived route is not a guarantee the
route is served), so the file is the reliable destination.

### App glue

**`SiteSearchModel`** (`@MainActor @Observable`), shaped after `RelatedPagesModel`:

- Holds `query`, `scope`, `private(set) hits`, `private(set) isSearching`.
- `search(siteID:)` debounces ~150 ms in a single cancellable `Task` (a new keystroke cancels
  the pending one), then calls `SiteSearchIndex.search(index, siteID:query:limit:8, kinds:)`.
- Captures `query` and `scope` before the await and discards the result if either changed
  during it — the generation guard `RelatedPagesModel` spells as its `currentPath` check.
- A blank or whitespace-only query clears `hits` and issues no search.
- Holds no index state: `SiteSearchIndex` reads the live index every call, so results always
  reflect the latest `KnowledgeReindex` pass.

**`SiteWindow`** gains, on the `NavigationSplitView`:

- `.searchable(text:placement: .toolbar, prompt: "Search Site")` — the standard trailing slot.
- `.searchScopes` bound to `SiteSearchScope`.
- `.searchSuggestions` — one row per hit: kind icon, title (falling back to the last path
  component), route or path as the subtitle, and the `matchContext` excerpt. An empty result
  set renders a single disabled "No matching content" row rather than an empty dropdown.

  Rows are made selectable with `.searchCompletion(hit.path)`, **not** by wrapping each in a
  `Button`. Two reasons: `.searchCompletion` is the mechanism that makes a suggestion row
  respond to both a click and arrow-keys-then-Return (it wraps its content in a button itself,
  which is why Apple's guidance is to apply it to non-interactive views), and since macOS 26 an
  `NSGlassContainerView` intercepts mouse events for interactive SwiftUI views layered over the
  title-bar/toolbar area — exactly where this popover sits — so a bare `Button` is unreliable
  there. Selecting a row therefore puts the hit's path in the field and submits;
  `onSubmit(of: .search)` turns that back into a hit via
  `SiteSearchIndex.hit(forSubmittedQuery:in:)`, which resolves an exact path match to that row
  and any other typed text to the top-ranked hit (Spotlight's Return behavior). The path is
  visible in the field only for the instant before activation clears it.
- `.searchFocused($searchFieldFocused)` so the menu command can focus the field.

No `SiteToolbarItemID` change: `.searchable` mints its own toolbar item id, so no saved user
customization is disturbed and the frozen id set stays as-is.

**`SiteWindowModel.openSearchHit(_:)`** runs `SiteSearchDestination.resolve` against
`navigator.routeIDs` and then either sets `navigator.selection` + calls
`applyNavigatorSelection(id)`, or builds a `FileRef` under `site.sourceDirectory` and calls
`openFile(_:)`. Both paths already handle leaving the current editor/inspector safely. The
query is cleared afterward so the dropdown dismisses.

**`SiteNavigatorModel`** gains `var routeIDs: [String: String]`, rebuilt alongside `nodesByID`
in `refresh` — the same shape as the existing `postIDs`/`postsByID` sidecar maps, assigned in
the same place so it can never drift from the tree on screen.

**`EditMenuSkeletonCommands`** replaces `PlannedItem("Search Site…")` with a live `Button` on
**⇧⌘F**, disabled when no site window is focused. ⌘F / ⌘G / ⇧⌘G / ⌥⌘F stay with the Markdown
find bar (#797), so this is the #517 interplay the issue asked to coordinate; ⇧⌘F is Xcode's
Find-in-Project key and is otherwise unused in this app. The action arrives through a new
`SiteSearchActions` focused value carrying a `focus: @MainActor () -> Void` closure, published
by `SiteWindow` next to `NavigatorSelectionActions` and consumed with `@FocusedValue` — the
established pattern for menu items that act on the focused window.

### Error handling

`SiteKnowledgeIndex.search` neither throws nor fails; it returns an empty array. The three ways
a user sees nothing are therefore indistinguishable at the API and share one message ("No
matching content"): no match, an index that has not finished its first `KnowledgeReindex` pass,
and a site with no indexable content. This is deliberate — a toolbar dropdown is the wrong
place to explain indexing state, and the index populates within moments of a site opening.

A hit whose file has been deleted since the last index pass resolves to `.file` and fails in
`openFile`'s existing error path; no new handling.

### Testing

- `swift test` — `SiteSearchScopeTests` (case freeze + kind mappings), `SiteSearchDestinationTests`
  (navigator match, no match, every kind→group mapping, nil-route hits), and
  `SiteSearchSubmissionTests` (exact-path vs. free-text vs. blank submissions).
- `xcodebuild -scheme Anglesite -configuration Debug build`.
- New user-visible strings mean an `xcstringstool sync` pass on `Localizable.xcstrings`,
  committed alongside (CONTRIBUTING ▸ Development setup).
- Manual GUI check (the navigator-command precedent, #586): field appears in the trailing
  toolbar slot, scopes filter, ⇧⌘F focuses it, a page hit selects its navigator row and
  previews, a component hit opens the editor.

## PR 2 — Pagefind reader search

Filed as its own issue, referencing #520's kottke.org comment. Sketch:

- `pagefind` as a template `devDependency` and a `postbuild` step indexing `dist/`. **New
  dependency** — approved in the #520 design conversation on 2026-07-26; to be recorded in the
  new issue and the PR body per CONTRIBUTING ▸ "Discuss big changes first".
- `src/pages/search.astro` using the self-hosted Pagefind UI bundle, with a `<noscript>` note.
- One CSP baseline change in `scripts/csp.ts`: `'wasm-unsafe-eval'` in `script-src`, because
  Pagefind compiles a WASM index reader. Everything else it loads is same-origin, which the
  existing `'self'` baseline already covers. `csp.ts`'s test updates with it.
- A nav link in `BaseLayout.astro`.

Template-only, so no paired sidecar PR (CLAUDE.md ▸ "Two-repo coordination").

## Follow-ups not taken

An in-app **full results pane** (a main-pane mode beside Graph/Cleanup, with grouping and
excerpts). `.searchable`'s dropdown shows the top ~8 hits, which serves navigation but not
archive spelunking; PR 2's reader page covers the archive case for the author too. Worth
filing only if the dropdown proves too thin in use.
