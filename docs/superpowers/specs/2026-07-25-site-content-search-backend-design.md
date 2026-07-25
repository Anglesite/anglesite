# Site content search backend (#765)

## Problem

[#520](https://github.com/Anglesite/Anglesite-app/issues/520) (toolbar search field) explicitly
needs "a search backend first (no code backing yet)," but no issue tracked building that backend
— #765 is that prerequisite.

## Findings

Before designing anything new, the existing retrieval stack was audited against the issue's scope
bullets:

- **`SiteKnowledgeIndex`** (`Sources/AnglesiteCore/SiteKnowledgeIndex.swift`) is a lexical index
  over a site's pages, posts, components, layouts, content-collection entries, config, styles, and
  scripts. Its `search(siteID:query:options:)` already returns ranked results with `kind`,
  `title`, `score`, an `excerpt`, and a `lineRange` (match context), plus `SearchOptions.kinds` for
  filtering by document kind.
- It is **already incrementally updated**: `KnowledgeReindex.apply` translates file-watcher
  `FileChangeBatch`es into `upsertFile`/`removeFile` calls, wired in
  `LocalContainerSiteRuntime.swift:532`. No full reindex per keystroke — this was built for #383
  and needs no new plumbing.
- **`SiteContentGraph`** was the other candidate the issue named. It has a ready-made `route` field
  for pages, but is *not* wired to the generic file watcher (only rescanned on app-initiated
  operations — content creation, navigator rename, site open), has no concept of "component" at
  all, and its `searchPages`/`searchPosts` are unranked substring filters with no excerpt/match
  context. It loses to `SiteKnowledgeIndex` on every axis this issue cares about.
- The **one real gap**: nothing in `SiteKnowledgeIndex` computes a navigable `route`. Page routes
  are already derivable via `ContentScanner.routeFromPagePath` (`Sources/AnglesiteCore/
  ContentScanner.swift:62`). Content-collection entry routes follow the shipped template's
  `/{collection}/{slug}` convention, confirmed against `Resources/Template/src/pages/
  [collection]/[...slug].astro`.
- Content types stored as **singletons** (`ContentStorage.singleton`, e.g. business/personal
  profile) resolve to a fixed slot path via `ContentScaffold.singletonRelativePath(slot:)`, which
  is not under `src/content/` — so a generic `src/content/{collection}/{entry}` route rule safely
  excludes them without special-casing.

Conclusion: the scoped-out work is small. Reuse `SiteKnowledgeIndex` as the storage/ranking engine
as-is (no changes to it), and add a thin, additive query facade that fills the one missing field
(`route`) and shapes results for UI consumption.

## Scope

Add one new file, `Sources/AnglesiteCore/SiteSearchIndex.swift`, containing two stateless pieces.
No changes to `SiteKnowledgeIndex` itself, no new actor, no new file-watch wiring.

### `ContentRouteResolver`

A pure static function:

```swift
enum ContentRouteResolver {
    static func route(
        kind: SiteKnowledgeIndex.Document.Kind,
        path: String,
        frontmatter: [String: FrontmatterValue]
    ) -> String?
}
```

- `.page` → delegates to `ContentScanner.routeFromPagePath(path)` (already `internal`, same
  module — no access-level change needed).
- `.post` / `.content` → the path is expected to look like `src/content/{collection}/{entry...}`.
  Requires at least two path segments after `src/content/` (a collection folder and an entry);
  anything shallower (or not under `src/content/` at all) returns `nil` rather than guessing.
  Slug is the frontmatter `slug` string value if present and non-empty, else the entry filename's
  stem. Route is `/{collection}/{slug}`.
- All other kinds (`.component`, `.layout`, `.config`, `.style`, `.script`, `.other`) → `nil`.
  These aren't rendered at a stable URL, so no route is fabricated for them.

### `SiteSearchIndex`

An enum namespace (matching the existing `ContentScanner`/`KnowledgeReindex` "stateless static
funcs" idiom) with one result type and one query function:

```swift
public enum SiteSearchIndex {
    public struct Hit: Sendable, Equatable, Identifiable {
        public let id: String
        public let kind: SiteKnowledgeIndex.Document.Kind
        public let title: String?
        public let route: String?
        public let path: String
        public let matchContext: String
        public let score: Double
    }

    public static func search(
        _ index: SiteKnowledgeIndex,
        siteID: String,
        query: String,
        limit: Int = 8,
        kinds: Set<SiteKnowledgeIndex.Document.Kind>? = nil
    ) async -> [Hit]
}
```

`search` calls `index.search(siteID:query:options:)` with `SiteKnowledgeIndex.SearchOptions(limit:
kinds:)`, then maps each `SearchResult` to a `Hit`: `id`/`kind`/`title`/`path`/`score` pass through
directly, `matchContext` is the result's `excerpt`, and `route` is computed via
`ContentRouteResolver` from the result document's `kind`, `path`, and `frontmatter`.

No caching layer — each call reads the live actor state, so results always reflect whatever the
file-watcher pipeline has most recently applied.

## Non-goals

- The toolbar `.searchable` UI itself (#520) — this issue ships the backend only.
- Edit ▸ Find in-editor search (#517).
- Wiring `SemanticRanker` into this path. The issue's own framing — "toolbar search wants fast
  literal matching more than semantic recall" — is taken as the decision: `SiteSearchIndex` uses
  `SiteKnowledgeIndex`'s lexical order as-is, unblended. `SearchKnowledgeTool` remains the
  semantic-blended path for assistant use; this is a separate, simpler consumer of the same
  underlying index.
- Changing `SiteKnowledgeIndex.Document`'s kind classification (e.g. widening `.post` to cover all
  article-like collections) — out of scope; `ContentRouteResolver` computes routes for both `.post`
  and `.content` kinds identically, so this gap doesn't block route coverage, and reclassifying
  would touch existing scoring behavior and 7 unrelated test files that construct `Document`
  directly (semantic ranker, link graph, cleanup report tests).

## Testing

- `Tests/AnglesiteCoreTests/ContentRouteResolverTests.swift`: page routes (nested paths, `index`
  stripping), content-collection routes with and without a frontmatter `slug` override,
  non-routable kinds → `nil`, shallow/malformed `src/content/` paths (no collection segment, or
  directly under `src/content/` with no subfolder) → `nil`.
- `Tests/AnglesiteCoreTests/SiteSearchIndexTests.swift`: seed a `SiteKnowledgeIndex` with
  page/post/component fixtures via `upsertFile`, assert `Hit` field mapping (route populated for
  page/post, `nil` for component), `kinds` filtering, and limit/ordering passthrough from the
  underlying `search()`.
