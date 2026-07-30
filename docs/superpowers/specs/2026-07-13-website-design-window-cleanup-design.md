# Website Design Window Cleanup (#714) — Design

**Date:** 2026-07-13
**Issue:** [#714](https://github.com/Anglesite/Anglesite-app/issues/714)
**Status:** Approved by DWK 2026-07-13. Amended 2026-07-30 (approved by DWK):
§4 redesigned as the *unified* inspector — the window inspector becomes the only
inspector, following the selection (element, page, or collection); §6's
main-pane Collection Settings surface is dropped in favor of an inspector
collection context, shrinking slice 2 to Website Settings only.

## Goal

Reshape the per-site window toward the Apple Pages model the issue references:

- **Left sidebar** — the site as a *visitor* understands it: a URL tree of the built
  site's human-visible pages, not a source-file browser. A single entry named for
  the website's title sits at the very top and opens site-wide settings in the
  main editor (§7); below it, `index.html` pinned first, then other HTML pages,
  then subdirectories. Differentiated icons for directories with an RSS feed
  (collections) vs. without, and for HTML files. Images, CSS, and JS are hidden.
- **Right inspector** — tabbed **Metadata | Style** for the current selection,
  where "selection" is an HTML element on the page, the page itself, or a
  collection (a feed-bearing directory such as the blog).
- **Toolbar** — common editing tools by default; site operations recede to the
  customization palette and menus.
- **Icons** — SF Symbols wherever a fitting one exists; where none does, an art
  brief covers the custom symbol (see §3).

This coordinates with the menu-bar/toolbar epic (#518): every demoted toolbar item
keeps its menu equivalent, per that epic's conventions.

## Non-goals / deferred to the next design phase

Explicitly out of scope here, by decision on 2026-07-13:

- **Selection-driven style/component entry from the preview.** Site-wide styles,
  metadata, and installed components are reachable through the Website Settings
  entry (§7), so removing the Components / Styles / Metadata sidebar sections no
  longer strands them — but richer, selection-driven entry (click an element,
  land in its owning component) remains a next-phase design.
- **Editable collection settings.** §6's inspector collection context is
  read-mostly in v1; making template, feed, and sitemap configuration
  *writable* requires template code changes and lands with the deferred phase.
- **Sitemap generation.** The template generates no sitemap today; the
  collection context reports "Not configured".
- **Style-tab write operations.** Gated on Component Editor slice 2 (#492), which
  is itself gated on plugin zone-filter fixtures (Anglesite/anglesite#411).

## 1. Sidebar: the site as a URL tree

### Model (AnglesiteCore)

A new pure builder replaces `buildNavigatorTree` (NavigatorTree.swift):

```swift
public struct URLTreeNode: Identifiable, Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case home                       // "/" — pinned first
        case page                       // any other HTML page or collection entry
        case directory(hasFeed: Bool)   // URL path segment with children
    }
    public let id: String               // graph entity id for pages/entries (rename &
                                        // context-menu machinery resolves rows via
                                        // graph.page(id:)/post(id:)); "dir:<route>" for
                                        // directories, "website" for the settings row
    public let title: String
    public let route: String
    public let kind: Kind
    public let children: [URLTreeNode]? // nil for leaves (hides List disclosure)
}

public func buildSiteURLTree(
    websiteTitle: String?,
    pages: [SiteContentGraph.Page],
    posts: [SiteContentGraph.Post],
    feedCollections: Set<String>,
    contentTypes: ContentTypeRegistry = .default
) -> [URLTreeNode]
```

Rules:

- **Website entry pinned at the very top:** a single node named for the website's
  title (falling back to "Website", as the old metadata row did) that opens the
  Website Settings surface (§7) in the main editor. It is not part of the URL
  hierarchy — it renders above home, unindented, with the `globe` icon.
- **Sources:** page routes from `SiteContentGraph.Page.route` (ContentScanner
  already handles nested `src/pages` folders) and collection-entry routes from
  `postRoute(for:)` (`/<collection>/<slug>/`). Nothing else enters the tree — so
  images, CSS, JS, feed routes (`rss.xml` etc.), and components are hidden by
  construction.
- **Top level:** home (`/`) pinned first, then other top-level pages sorted by
  title, then directories sorted by title.
- **Directories:** one node per URL path segment that has children — collection
  folders (`/notes/`) and nested page folders (`/blog/`). Title is the registered
  content type's `displayName` (e.g. "Notes") when
  `ContentTypeRegistry.descriptor(forCollection:)` matches, else the capitalized
  segment.
- **Inside a directory:** the directory's own index page pinned first, then
  entries sorted by `publishDate` descending (visitor-facing collections are
  reverse-chronological), falling back to title for undated items, then nested
  subdirectories.
- **Feed detection:** `feedCollections` is computed by probing
  `Source/src/pages/<collection>/rss.xml.ts` — the template materializes one per
  feed-bearing collection (`src/lib/feeds.ts` `FEED_COLLECTIONS`). No template or
  plugin change is needed. The probe lives beside `SiteFileTree.scan` and refreshes
  with it.
- Node titles use `Page.title ?? route` and `Post.title`, matching what a visitor
  sees in the browser.

### Selection semantics

`NavigatorTarget` gains two cases:

- `.route(String)` — unchanged: pages and entries navigate the preview and
  populate the inspector.
- `.directory(collection: String?, route: String)` — new: navigates the
  preview to the directory's route and populates the inspector with the
  collection context (§6). `collection` is set for `src/content`-backed
  directories, nil for plain nested page folders. *(Amended 2026-07-30 — the
  original design opened a main-pane settings surface instead.)*
- `.websiteSettings` — new: the website-title row; opens the Website Settings
  surface in the main pane (§7).
- `.file(FileRef)` — retained for the editor pipeline; no sidebar row produces
  it directly any more, but rows inside the Website Settings surface do (§7).

### What leaves the sidebar

- The Pages / Posts / Collections / Components / Styles / Metadata sections
  (`FileGroup`-keyed `NavigatorSection`s).
- The synthetic **Cleanup** section: it is not part of the visitor's site. It
  moves to a **Site ▸ Cleanup…** menu command that presents the existing
  `ProjectCleanupModel` results (same rows, same actions) in the main pane.

### What carries over

- Inline Finder-style rename, and the context-menu Rename / Duplicate /
  Repurpose Post… / Delete commands, on page and entry rows, with the existing
  `canRename`/`canDelete`/`canDuplicate`/`canRepurpose` gating.
- Live refresh via `SiteContentGraph.changeStream()`.
- `@SceneStorage` sidebar visibility, widths, and the empty-state
  `ContentUnavailableView`.

## 2. Icons

| Node | Symbol | Notes |
|---|---|---|
| Website settings (title row) | `globe` | already the app's canonical site icon |
| Home (`/`) | `house` | new to the app |
| HTML page / entry | `doc.richtext` | already the app's canonical page icon |
| Directory, no feed | `folder` | |
| Directory with feed | `folder` + `dot.radiowaves.up.forward` badge | composed in SwiftUI (ZStack overlay, badge bottom-trailing) until a custom symbol ships |

No stock SF Symbol exists for a feed-bearing folder (`folder.badge.rss` does not
exist), so the composite is the v1 rendering and §3's art brief covers the real
symbol — the exact fallback the issue prescribes.

## 3. Art brief

`docs/art-briefs/2026-07-13-folder-rss-symbol.md` (committed with this spec)
briefs a custom SF Symbol: a `folder` silhouette carrying an RSS badge
(quarter-arcs + dot) at bottom-trailing, drawn on the SF Symbols app template so
it tracks weights and the three scales, in monochrome + hierarchical renditions.

## 4. Inspector: one unified inspector, Metadata | Style tabs

*(Amended 2026-07-30 — supersedes the original "tab shell only" §4.)*

The window `.inspector` becomes the **only** inspector, always answering
"what's selected?". A selection is one of three kinds: an **HTML element** on
the page, the **page** itself, or a **collection** (feed-bearing directory).
A Pages-style segmented control (**Metadata | Style**) sits above the content;
the selected tab persists per window via `@SceneStorage("siteInspector.tab")`.

Per selection kind:

| Selection | Metadata tab | Style tab |
|---|---|---|
| HTML element (Component Editor canvas today; preview later) | selection summary + Props form | Styles + Computed groups, with the style-write conflict/error banners |
| Page (routed page in the navigator) | today's content: `InspectorChrome` wrapping `TypedEntryForm`, `PageMetadataForm`, or the read-only `GenericPageInfoForm` fallback (#1100), incl. dirty/Save, off-main load, and the external-change conflict alert | `ContentUnavailableView` ("Select something on the page") until preview-page element selection lands (next phase) |
| Collection (directory row) | content type, entry count, detected feeds, template, sitemap status (§6) | `ContentUnavailableView` |

Structural changes this requires:

- **Component Editor inspector unification.** The in-pane `HSplitView`
  inspector column (`ComponentEditorInspectorPane`) is removed; outline and
  canvas absorb the space. Its sections are extracted into standalone views
  (owning their own transient form state) and hosted by the window inspector:
  Props under Metadata, Styles + Computed under Style. The per-selection code
  zone is dropped from the inspector — the Design/Source mode picker already
  covers source editing.
- **Model hoisting.** `ComponentEditorModel` moves from `ComponentEditorView`'s
  view-local `@State` to `SiteWindowModel` ownership: the editor-pane's
  activation task creates/rebuilds it keyed on (file, dev-server URL) — the
  same identity the old view-local load key watched (its context dependencies
  — preview `readyURL`, MCP client, shared edit router — are already reachable
  on the window model). It survives Preview/Editor mode toggles (same lifetime
  as the editor buffer's usefulness, not `activeEditor` itself) and is torn
  down only on site change, window close, or the open component being
  deleted. `ComponentEditorView` receives the model.
- **Presentation gate.** The inspector shows when *any* selection context
  exists (page inspector context, component editor model, or collection
  context) instead of clearing on `openFile`; the toolbar toggle enables
  accordingly.

Style-tab write operations beyond what the Component Editor styles panel does
today deepen with #492.

## 5. Toolbar: editing tools default, ops recede

All existing frozen `SiteToolbarItemID`s survive — only `.defaultCustomization`
changes — plus one new frozen ID:

- **New `insert`** — a `plus` menu button: New Page…, New Post…, New Collection
  Entry…, New Component…, reusing the navigator content-command actions
  (2026-07-09 navigator-content-commands design).
- **Defaults:** `panes` (principal) · `insert` · `openInBrowser` · `deploy` ·
  `chat` · `inspector`.
- **Demoted to hidden palette:** `graph`, `backup`, `audit` — each already has a
  menu equivalent, satisfying #518's "menu is the durable path" convention.
- Already-hidden palette items are unchanged.

`SiteToolbarItemIDTests` extends to cover the new ID and the new default set.

## 6. Collection properties (inspector)

*(Amended 2026-07-30 — the original design put these in a main-pane
"Collection Settings" surface; they are inspector-shaped selection properties,
so they live in the inspector's collection context instead. There is no
main-pane surface.)*

Selecting a directory row navigates the preview to the directory's route and
populates the inspector's **Metadata** tab with:

- Content type (registry `displayName`) and entry count.
- Detected feeds — RSS / Atom / JSON, probed from
  `src/pages/<collection>/{rss.xml,atom.xml,feed.json}.ts`, each linked to its
  preview URL.
- Template/layout in use (static dispatch: Hentry / Hevent / Hreview per the
  template's `[collection]/[...slug].astro`).
- Sitemap status ("Not configured" until the template gains one).

v1 is read-mostly; editability is deferred (see Non-goals). Plain nested page
folders (no collection) show route and entry count only — no content-type,
feed, or template rows.

## 7. Website Settings (main pane)

Selecting the website-title row at the top of the sidebar opens a **Website
Settings** surface in the main editor — the single home for everything
site-wide. Three sections:

- **Metadata** — the site-wide configuration the old sidebar Metadata row
  reached: the package `Info.plist` / `SiteConfigStore` fields (display name,
  domain, and the existing `PlistEditorView` content, embedded or linked).
- **Site-wide styles** — the stylesheets from `src/styles`, listed; opening one
  uses the existing `.file` → main-pane editor pipeline.
- **Installed components** — the components from `src/components` +
  `src/layouts`, listed; opening one uses the existing `.astro` editor path
  (Component Editor).

This is where the content of the removed Components / Styles / Metadata sidebar
sections lands: browsing moves out of the navigator into a settings surface,
while the editors themselves are unchanged. The website row clears the
inspector context — it is a browsing hub, not a selection. (Directory rows, by
contrast, populate the inspector per the amended §6.)

Slice 1 wires the row to the existing `PlistEditorView` (exactly what the old
metadata row opened) so nothing is stranded; the full three-section surface
ships in slice 2.

## Slices

1. **URL-tree navigator** — `URLTreeNode` + `buildSiteURLTree` + feed probe in
   AnglesiteCore; `SiteNavigatorView`/`SiteNavigatorModel` swap to the tree;
   website-title row (interim: opens `PlistEditorView`); icons + composite feed
   badge; Cleanup moves to Site menu; art brief committed.
2. **Website Settings surface** — the full main-pane Website Settings surface
   (§7) behind the `.websiteSettings` target. *(Amended 2026-07-30: the
   Collection Settings surface moved to slice 3's inspector collection
   context.)*
3. **Unified inspector** — segmented Metadata | Style tabs; Component Editor
   inspector unification (model hoisting, in-pane column removal, section
   extraction); collection context for `.directory` selections (§6).
4. **Toolbar re-curation** — `insert` item, default set change, demotions.

Each slice is independently shippable. Slices 2 and 3 depend on slice 1
(their selection targets exist only in the new tree); slice 4 is fully
independent of the others.

## Testing

- Unit tests for `buildSiteURLTree`: website row first with title fallback,
  home pinning (root and per-directory),
  top-level vs. directory sorting, reverse-chron entry order with undated
  fallback, feed-badge propagation, nested `src/pages` folders, percent-encoded
  collection/slug routes, empty site.
- Feed-probe tests against fixture directory layouts.
- `SiteNavigatorModel` tests updated for tree output and `.directory` selection.
- `SiteWindowModel` tests for the unified-inspector gate and
  `ComponentEditorModel` lifecycle: opening a component creates the model;
  toggling to Preview and back keeps it (only the inspector's *surfacing* of
  it toggles); `.directory` selection populates the collection context; route selection
  restores the page context. Existing `ComponentEditorModel` behavior tests
  survive the hoisting unchanged.
- `SiteToolbarItemIDTests` updated for `insert` + new defaults.
- Full `swift test` before push (several suites string-match template markup).

## Risks

- **Extra click for dev files (accepted):** components and styles move from
  always-visible sidebar rows to lists inside Website Settings — one step
  further away for power users, in exchange for a visitor-comprehensible
  sidebar. Selection-driven entry (next phase) is the durable answer.
- **Feed probe couples to template layout:** if the template moves its feed
  routes, badges silently vanish. The probe is one function with fixture tests,
  so the coupling is cheap to update; a registry-level feed flag is the likely
  next-phase home.
- **`ComponentEditorModel` hoisting is the load-bearing refactor (slice 3):**
  moving the model from view-local `@State` to `SiteWindowModel` changes its
  lifecycle owner; the canvas/outline wiring must keep working across
  main-pane mode changes and window teardown. Mitigated by keeping the
  existing model behavior tests green and adding lifecycle tests.
- **Inspector width shift:** the window inspector is 260–420 pt where the
  in-pane column was 220–260 pt; the extracted sections were built for narrow
  widths, so this is cosmetic only.
- **Slug-keyed Post IDs:** `SiteContentGraph.Post.id` is keyed by slug only;
  identical slugs across collections would collide in the tree exactly as they
  do in today's navigator — no new exposure, noted for the next-phase registry
  work.
