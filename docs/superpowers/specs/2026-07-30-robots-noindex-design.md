# Robots.txt and noindex — design

Issue: [#1093](https://github.com/Anglesite/Anglesite/issues/1093)
Status: proposed

## Problem statement

A site owner needs a way to keep a specific page (or post) out of search results and, separately,
to stop crawlers from fetching it at all. Today the template emits a single static `robots.txt`
that allows everything, and no page emits any indexing directive. The issue cites a real leak
scenario (private content surfacing in search) as the motivation, so the mechanism needs to
actually work, not just exist — see "Two independent controls" below for why a single "No Index"
checkbox that also edits `robots.txt` would undermine that goal.

## Goals

- A per-page "Hide from search results" control that reliably keeps a page's URL out of search
  indexes even when the page is linked from elsewhere.
- A per-page "Block crawling entirely" control for pages that should never be fetched by
  well-behaved crawlers at all.
- Both controls available from the app's page inspector for every page kind the app can open:
  frontmatter pages (`src/pages/about.md`), content-collection entries (blog posts, notes,
  articles, …), and plain `.astro` pages (`index.astro`, `404.astro`, collection index pages, …).
- `robots.txt` stays a `Disallow:`-per-line file generated at build time, with each generated line
  traceable back to the page/collection entry that produced it, and room for hand-added rules that
  the app's own read/write logic will never touch or clobber.

## Non-goals

- Reading hand-edited `robots.txt` back into the inspector. `robots.txt` remains a build output;
  the new config file (below) is the editable source of truth. Confirmed with the repo owner
  during design: robots.txt generation stays one-way (config → file), not a two-way sync.
- General-purpose safe editing of arbitrary `.astro` frontmatter. This design deliberately avoids
  needing that (see "Why not per-page frontmatter storage" below), so it does not reopen or narrow
  the read-only stance `GenericPageInspectorModel` took in #1100 for anything except these two new
  toggles.
- A UI for hand-authoring the `extra` raw-rules escape hatch (schema support only — see below).

## Terminology — two independent controls

| Control | Emits | Effect |
|---|---|---|
| **Hide from search results** (`noindex`) | `<meta name="robots" content="noindex">` in that page's `<head>`, and an `X-Robots-Tag: noindex` response header for its route | Crawling stays allowed, so the noindex signal is actually seen; the page is fetched but excluded from indexes. This is what Google's own guidance recommends for keeping a page out of search. |
| **Block crawling entirely** (`disallowCrawl`) | A `Disallow:` line in `robots.txt` for that page's route | Well-behaved crawlers never fetch the page. Stronger, but if the page is linked from elsewhere it can still surface in search results without a snippet, because the crawler never sees a noindex signal it can't fetch. |

The two are independent toggles, not one checkbox, precisely because combining them naively
(`Disallow` + relying on `noindex`) is a known anti-pattern: a blocked crawler can't see the
`noindex` tag it was never allowed to fetch. A page can have either, both, or neither set.

## Why not per-page frontmatter storage

An earlier iteration of this design stored both flags per page — YAML frontmatter for markdown
pages, a new content-collection schema field, and a new regex-based `.astro`-prop editor
(parallel to the existing `PageTitleEditor`) for plain pages — with a build-time script that
walked every page to rebuild `robots.txt` and `_headers` from scratch each build.

That works, but during design review the repo owner asked for `robots.txt` to be generated from a
JSON/YAML config whose entries back-reference the page/collection that produced them, and that
also leaves room for hand-added rules. Once that config file exists as the source of truth for
`disallow`, storing `noindex` in three different per-page formats stops pulling its weight: both
directives are fundamentally the same kind of fact ("this route should not be indexed / crawled"),
robots.txt is inherently one file for the whole site, and centralizing both removes the need for
the `.astro`-prop editor, the schema/descriptor changes, and the build-time page-scanning step
entirely. See "Architecture" below.

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────────┐
│  Page inspector      │  R/W   │  src/data/robots-config.json  │
│  (3 form variants)   │◄──────►│  (git-tracked, one per site)  │
└─────────────────────┘        └──────────────────────────────┘
                                            │  read (build time, no page scan)
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
          BaseLayout.astro          scripts/csp.ts          scripts/edge-artifacts.ts
          (per-request meta tag)    (public/_headers)        (public/robots.txt)
```

`src/data/robots-config.json` is the single source of truth for both directives, analogous to the
existing `src/data/licensing.json` (already read by `edge-artifacts.ts` for the AI-crawler
blocklist). The app writes to it when a toggle changes; nothing at build time inspects individual
page files to figure out `noindex`/`disallowCrawl` state.

### Config file schema

`Source/src/data/robots-config.json`:

```json
{
  "noindex": [
    { "path": "/blog/private-post/", "source": { "kind": "collection", "collection": "blog", "id": "private-post" } }
  ],
  "disallow": [
    { "path": "/internal-notes/", "source": { "kind": "page", "file": "src/pages/internal-notes.astro" } }
  ],
  "extra": []
}
```

- `path` is the site-relative route (leading slash, matching Astro's own routing — trailing-slash
  convention follows whatever `astro.config` already resolves for the site, same rule the two
  dynamic collection routes use today).
- `source` identifies which page/collection entry the app wrote this entry for:
  - Frontmatter/plain pages: `{ "kind": "page", "file": "<repo-relative path under Source/>" }`.
  - Content-collection entries: `{ "kind": "collection", "collection": "<name>", "id": "<entry id>" }`.
  - Omitted (or `null`) for a hand-added entry. The app's upsert/remove logic only ever matches
    entries by `source`, so a sourceless entry is never touched by the toggle UI — that's the
    "arbitrary content" door the design asks for.
- `extra` is a list of raw robots.txt-syntax lines/blocks merged in verbatim by the generator, for
  directives that don't fit the single-path-entry shape (e.g. a rule scoped to one named bot). No
  UI writes to it in this iteration; it exists so a future feature doesn't need a schema change.

### Swift: `RobotsConfigStore`

New pure type in `AnglesiteCore` (`Sources/AnglesiteCore/RobotsConfigStore.swift`), following the
same "pure transform, caller does I/O" shape as `PageMetadataEditor`/`buildRobotsTxt`:

```swift
public struct RobotsConfigSource: Codable, Equatable, Sendable {
    public var kind: String        // "page" | "collection"
    public var file: String?       // kind == "page"
    public var collection: String? // kind == "collection"
    public var id: String?         // kind == "collection"
}

public struct RobotsConfigEntry: Codable, Equatable, Sendable {
    public var path: String
    public var source: RobotsConfigSource?
}

public struct RobotsConfig: Codable, Equatable, Sendable {
    public var noindex: [RobotsConfigEntry] = []
    public var disallow: [RobotsConfigEntry] = []
    public var extra: [String] = []
}

public enum RobotsDirective { case noindex, disallowCrawl }

public enum RobotsConfigStore {
    /// Missing or malformed file reads as an empty config — never a hard error, same tolerance
    /// `readLicensingUsage` already applies to `licensing.json`.
    public static func read(_ contents: String) -> RobotsConfig
    public static func contains(source: RobotsConfigSource, directive: RobotsDirective, in config: RobotsConfig) -> Bool
    public static func upserting(path: String, source: RobotsConfigSource, directive: RobotsDirective, into config: RobotsConfig) -> RobotsConfig
    public static func removing(source: RobotsConfigSource, directive: RobotsDirective, from config: RobotsConfig) -> RobotsConfig
    /// Stable (sorted) JSON so re-saves without a real change produce no git diff.
    public static func serialized(_ config: RobotsConfig) -> String
}
```

### Swift: inspector integration

All three inspector model kinds (`PageMetadataModel`, `TypedEntryEditorModel`,
`GenericPageInspectorModel`) gain the same two bindings, backed by the shared config file rather
than their own page file:

- On `load()`: in addition to whatever the model already loads, read
  `src/data/robots-config.json` (relative to the site's `Source/` root) and compute this page's
  `source` identity (file path for page kinds, `collection`+`id` for typed entries — the same
  identity the model already has available: `TypedEntryEditorModel` has `descriptor`+`file`,
  `GenericPageInspectorModel` already computes `route`). The two toggles' loaded values are
  `RobotsConfigStore.contains(source:directive:in:)` for each directive; this becomes part of the
  model's dirty-tracking baseline, the same way `PageMetadataModel` diffs against `PageMetadata`
  and `TypedEntryEditorModel` diffs `values != savedValues`.
- On `save()`: alongside whatever the model already writes, re-read the shared config (not the
  load-time snapshot — reduces clobber risk across saves, see "Known limitations"), apply
  `upserting`/`removing` for each directive whose toggle changed, and write it back only if it
  changed. This keeps one Save button and one dirty-dot for the whole page, matching the existing
  `InspectorChrome` UX — no separate save action for robots settings.
- `GenericPageInspectorModel` currently declares `isDirty`/`isSaving`/etc. as constant `let`
  bindings because it has never had editable state (#1100). This design turns those into real
  computed/stored properties, scoped to exactly these two toggles — everything else about the
  model (title, description, body) stays exactly as read-only as #1100 left it.

UI: a shared `RobotsSettingsSection` view (two `Toggle`s: "Hide from search results" /
"Block crawling entirely", with the SEO caveat as help text on the second one) is composed into all
three form bodies (`PageMetadataForm`, `TypedEntryForm`, and the current `GenericPageInfoForm`,
whose "This page has no editable metadata yet" copy needs updating since it's no longer accurate).
One implementation, three call sites — not three copies of the same two toggles.

### Astro template: reading the config

- `BaseLayout.astro` imports `../data/robots-config.json` directly (a plain JSON import, resolved
  and inlined at build time like any other static import) and checks `Astro.url.pathname` against
  the `noindex` list itself to decide whether to emit the meta tag. No prop threading through
  `BlogPost.astro`, `Hentry.astro`, `Hevent.astro`, `Hreview.astro`, or any plain page's
  `<BaseLayout>` call — every page already renders through `BaseLayout`, so the check lives in
  exactly one place.
- `scripts/edge-artifacts.ts`'s `buildRobotsTxt` takes the config's `disallow` entries (and
  `extra` raw lines) as a parameter, emitting one `Disallow: <path>` line per entry — optionally
  preceded by a `# <source>` comment when `source` is present, which is the "back-reference"
  behavior requested. No page-scanning.
- `scripts/csp.ts`'s `buildHeaders` takes the config's `noindex` entries as a parameter, appending
  one path-specific block per route in the same format the file already uses for `/_astro/*`:
  ```
  /blog/private-post/
    X-Robots-Tag: noindex
  ```
- Both scripts already run in the same `prebuild` sequence
  (`well-known.ts && csp.ts && edge-artifacts.ts`) and already read sibling files under
  `src/data/`; reading `robots-config.json` is the same shape of change as `readLicensingUsage`.

## Data flow walkthrough

1. Owner opens a blog post in the app, toggles "Hide from search results" on, clicks Save.
2. `TypedEntryEditorModel.save()` writes the post's own file (unchanged in this case — the flag
   isn't stored there) and separately upserts `{ path: "/blog/<slug>/", source: { kind:
   "collection", collection: "blog", id: "<slug>" } }` into `src/data/robots-config.json`,
   committing that file to git the same way other app-driven writes already do.
3. On the next `astro build` (dev server or deploy):
   - `BaseLayout.astro` sees `/blog/<slug>/` in the imported config's `noindex` list and emits the
     meta tag for that page.
   - `csp.ts` emits an `X-Robots-Tag: noindex` block for that path into `public/_headers`.
   - `edge-artifacts.ts` does *not* add a `Disallow:` line (only `disallowCrawl` does that).
4. Owner later deletes the post. Nothing in this design automatically removes its
   `robots-config.json` entry — flagged under "Known limitations."

## Error handling

- `RobotsConfigStore.read` on a missing or malformed file returns an empty `RobotsConfig` (never
  throws) — same tolerance `readLicensingUsage` already applies to a malformed `licensing.json`,
  logged rather than failing the build.
- A save that fails to write `robots-config.json` (disk/permission error) surfaces through the
  same `loadError`/save-failure path the models already use (`PageMetadataModel`'s
  `"Save failed: …"`), so the existing conflict/error UI in `InspectorChrome` covers it without new
  UI.
- Malformed entries inside `extra` are passed through to `robots.txt` verbatim — the schema doesn't
  validate robots.txt syntax; a site owner hand-editing `extra` is responsible for valid syntax,
  same trust level the project already extends to hand-authored `security.txt`/`mta-sts.txt`.

## Testing plan

- `RobotsConfigStoreTests` (Swift): `read` tolerance (missing/malformed file), `contains`,
  `upserting`/`removing` round-trips including the "never touch a sourceless entry" invariant,
  stable `serialized` output.
- Inspector model tests: loading reflects existing config entries as checked; saving upserts/
  removes the right entry and leaves unrelated entries untouched; `isDirty` reacts to toggle
  changes.
- TS unit tests: `buildRobotsTxt` with `disallow`/`extra` parameters (comment back-reference
  formatting, ordering, no entries → unchanged output from today); `buildHeaders` with `noindex`
  entries (block formatting matches existing `/_astro/*` style).
- Template-level: per repo convention, run `swift test --filter` covering the template-asset
  guard suites after touching `BaseLayout.astro` (this repo's Swift tests couple to template
  markup — see `CONTRIBUTING.md`).
- Manual/E2E: toggle both controls on a page in the app, run the local dev server to confirm the
  meta tag renders, then a production build to confirm `public/_headers` and `public/robots.txt`
  both reflect the change.

## Known limitations / follow-ups

- **Stale entries on delete/rename.** Deleting or renaming a page/entry doesn't currently prune or
  update its `robots-config.json` entry, so a deleted page's `Disallow`/`noindex` entry can outlive
  the page (harmless — the route 404s — but not self-cleaning) and a renamed page's entry keeps
  the old path until someone re-toggles it. A follow-up could hook this into whatever already
  handles page rename (there's existing rename plumbing for `title`, e.g.
  `NavigatorRenameService`) — out of scope here to avoid growing this change further.
- **Last-write-wins on the shared config.** Two saves in close succession (unlikely given the
  inspector shows one selection at a time) re-read-then-write rather than using real conflict
  detection; acceptable given how narrow the concurrent-edit window is, but worth naming rather
  than silently ignoring.
- **No UI for `extra`.** Schema support only, so a future "advanced robots.txt rules" feature
  doesn't need a breaking format change.
