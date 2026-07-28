# Micro.blog compatibility — fix the feed layer (Epic #1027)

Make a deployed Anglesite site work as a Micro.blog external blog: short notes render
inline (full text, no headline), titled posts render as linked headlines, feeds carry
full HTML content and metadata, tag links resolve, and micropost collections are
browsable on the site itself.

Issues: #1021, #1022 (blocking, one coordinated change), #1023, #1024, #1025, #1026.
Reference: https://book.micro.blog (rss-for-microblogs, json-feed, microblog-and-feeds).

## Global Constraints

- **Worktree:** all work happens in
  `/Users/dwk/Developer/github.com/Anglesite/Anglesite-app/.claude/worktrees/issue-700-ba3222`
  on branch `claude/microblog-compatibility-feed-d0bfef`. `cd` there before any git or
  build command. Never touch the main checkout.
- **Template-only scope** plus the Swift tests that couple to the template
  (`Tests/AnglesiteCoreTests/FeedsRenderSmokeTests.swift`,
  `IntegrationTemplateAssetsTests`, `ProjectValidatorTests`) and, for Task 5 only, docs
  and possibly `Sources/AnglesiteCore/IntegrationCatalog.swift`. No paired sidecar PR.
- **No new npm or Swift dependencies.** Markdown→HTML rendering must use
  `@astrojs/markdown-remark` (already a direct dependency of the template).
- **Micro.blog classification rule (binds Tasks 1–4):** presence of a `title` on a feed
  item is the signal. Title-less microposts (notes, replies, likes, photos-without-title)
  must carry **no synthesized title** in any feed format; titled collections
  (blog, articles, albums, bookmarks-with-frontmatter-title) keep real titles. Never
  fabricate a title from body text, captions, or link hosts.
- **Feeds must stay valid:** RSS 2.0 items need at least one of title/description; Atom
  entries require a `<title>` element (emit an empty one for title-less items); JSON
  Feed 1.1 `title` is optional and must be omitted, not empty.
- **Tests before push:** from `Resources/Template/`: `npm test` and `npm run build`
  (build includes `astro check` + the mf2 checker `scripts/check-microformats.ts`).
  From the repo root: `swift test --filter FeedsRenderSmoke`,
  `swift test --filter IntegrationTemplateAssets`, `swift test --filter ProjectValidator`.
- **Commits:** conventional format, subject ≤72 chars, issue number in subject,
  one commit (or a small coherent series) per task, e.g.
  `feat(#1021): drop synthesized titles from micropost feeds`. End body with the
  Claude Fable co-author trailer.
- **Drafts stay excluded from feeds** (#798 behavior in `feed-data.ts`) and the
  existing WebSub advertisement behavior must be preserved unchanged.

## Task 1 — #1021 + #1022: FeedItem overhaul (optional title, full HTML content)

One coordinated change to `Resources/Template/src/lib/feeds.ts`,
`src/lib/feed-data.ts`, their tests, and `Tests/AnglesiteCoreTests/FeedsRenderSmokeTests.swift`.

- `FeedItem.title` becomes `string | undefined`; add `contentHtml: string` (full body
  rendered to HTML).
- `FEED_COLLECTIONS` per-collection title derivation:
  - `blog`, `articles`, `albums`: `e.data.title` (required by schema, unchanged).
  - `bookmarks`: `e.data.title` when present, otherwise **no title** (drop the
    `host(bookmarkOf)` fallback — it is synthesized).
  - `notes`, `replies`, `likes`: **no title, ever** (drop excerpt/"Re: host"/"Liked host").
  - `photos`: **no title** (a caption is content, not a title; drop `caption ?? "Photo"`).
  - Remove the `|| "Untitled"` hard guarantee in `toFeedItem`.
- Full content: render `entry.body` (markdown) to HTML at build time with
  `createMarkdownProcessor` from `@astrojs/markdown-remark` (module-level cached
  processor promise; rendering happens in `feed-data.ts` since it is async — pass the
  rendered HTML into `toFeedItem` or make the mapping async; keep `toFeedItem`'s
  existing signature working for tests or update tests accordingly). For photos, if the
  body is empty, fall back to the caption text as content. `summary` keeps its current
  derivation (280-char excerpt) — it remains the *short* representation.
- Renderers:
  - RSS (`renderRss` via `@astrojs/rss`): item `title` only when present;
    `description` carries the **full HTML** (`contentHtml`) when non-empty, else the
    summary. (RSS 2.0 requires title *or* description — description always present.)
  - Atom (`renderAtom`): always emit `<title>` — empty element for title-less items;
    keep `<summary>` (plain-text summary, escaped) and add
    `<content type="html">` with the escaped full HTML.
  - JSON Feed (`renderJsonFeed`): omit `title` key when absent; add `content_html`
    (JSON Feed 1.1 requires content_html or content_text on every item — use summary
    as content_html fallback when body is empty); keep `summary`.
- Update `src/lib/feeds.test.ts`: existing derive-title tests flip to assert *absence*
  of titles for notes/replies/likes/photos; add renderer tests asserting (a) no
  `<title>`/`title` for title-less items in RSS + JSON Feed, empty `<title/>` in Atom,
  (b) full multi-paragraph HTML lands in RSS description, Atom `<content>`, JSON
  `content_html`, (c) titled collections unchanged.
- Update `FeedsRenderSmokeTests.swift`: the "likes still produces a non-empty title"
  assertions (lines ~60–63) invert — the likes feed must carry **no** title keys on
  items; add an assertion that the notes JSON feed carries `content_html` with the
  note body. Keep the suite's build-lock pattern intact.

## Task 2 — #1023: tags/categories + author metadata in feeds

Builds on Task 1's `FeedItem`. Files: `feeds.ts`, `feed-data.ts`, `feeds.test.ts`.

- `FeedItem` gains `tags?: string[]` populated from `entry.data.tags` (schema field
  already exists on all micropost collections).
- `renderRss`: per-item `<category>` elements (via `@astrojs/rss` item `categories`).
- `renderAtom`: per-entry `<category term="…"/>`.
- `renderJsonFeed`: per-item `tags` array.
- Author: add an optional `author?: { name: string; url?: string }` option to
  `renderAtom` (top-level `<author><name/><uri/></author>`) and `renderJsonFeed`
  (top-level `authors: [{name, url}]`), and to `renderRss` as channel-level
  `customData` `<dc:creator>` with the `dc` xmlns declared. Feed **routes** derive it
  from `siteProfile()` (`src/lib/profile.ts` — name/url; profile.json absent → no
  author emitted, all three renderers omit author cleanly). Wire all 27 feed routes
  (8 collections × 3 + 3 root) — a small shared helper in `feed-data.ts` (e.g.
  `feedAuthor()`) keeps the routes one-liners.
- Tests: tags flow to all three formats; author present when passed, absent when not;
  no dc xmlns when no author.

## Task 3 — #1024: `/tags/<tag>` route

- Add `Resources/Template/src/pages/tags/[tag]/index.astro` with `getStaticPaths`
  aggregating `tags` across **all** content collections that declare a `tags` field
  (blog, notes, articles, photos, albums, bookmarks, replies, likes — check
  `content.config.ts` for the authoritative list; announcements/events/reviews too if
  they have tags). Page lists that tag's entries reverse-chronologically as links
  (titled entries by title, title-less by excerpt), each pointing at its permalink
  (`/blog/<id>/` for blog, `/<collection>/<id>/` for the rest).
- Add `Resources/Template/src/pages/tags/index.astro` — tag index listing every tag
  with a count, linking to `/tags/<tag>/`.
- Handle URL-encoding (tags with spaces) consistently with
  `Hentry.astro`'s `href={`/tags/${t}`}` links — those existing links must resolve;
  if encoding is needed, fix Hentry.astro's link generation in the same commit.
- Drafts excluded in PROD (match `blog/index.astro`'s convention).
- Sample content: at least one hello-* entry should carry a tag so the route builds
  non-trivially — add a tag to `src/content/notes/hello-note.md` if none exists.
- `npm run build` proves no 404-generating regressions; mf2 check passes.

## Task 4 — #1025: browsable index + timeline pages for micropost collections

- Add `index.astro` for each feed-only collection directory: `notes/`, `photos/`,
  `articles/`, `bookmarks/`, `replies/`, `likes/`, `albums/`. Each is an h-feed:
  microposts (notes/replies/likes/photos) render **full content inline** as h-entries;
  titled collections (articles/albums/bookmarks) render as linked headlines, matching
  `blog/index.astro`'s spirit. Reverse-chronological, drafts excluded in PROD, link to
  the collection's RSS feed at the top.
- Add a combined reverse-chronological stream page at
  `src/pages/timeline/index.astro` across all eight feed collections (reuse the
  aggregation shape of `feed-data.ts`'s `getCombinedItems`, but page-side with
  `getCollection` so entries can render inline; a shared helper is fine).
- Keep the homepage as-is, but add a link to `/timeline/` alongside the existing
  `/blog/` link.
- Markup: proper `h-feed`/`h-entry` classes so `scripts/check-microformats.ts`
  passes on the new pages. Reuse existing components where sensible
  (`DraftBadge.astro`; do NOT redesign `Hentry.astro`).
- `npm run build` (includes mf2 check) + template tests pass;
  `swift test --filter FeedsRenderSmoke` still passes (dist layout gains index.html
  files, nothing removed).

## Task 5 — #1026: Micro.blog setup docs + POSSE-target decision

- Write `docs/microblog-external-blog.md`: end-to-end guide connecting a deployed
  Anglesite site to Micro.blog — register the feed (recommend `/feed.json`, mention
  `/rss.xml`), domain verification via existing `rel=me` support, enabling
  cross-posting on Micro.blog's side, and that Micropub means the Micro.blog iOS app
  can post directly to an Anglesite site. Note the feed behavior shipped by this epic
  (title-less notes inline, full content).
- **POSSE decision (record verbatim):** Micro.blog does **not** join the POSSE target
  list in `POSSEClients.swift`. Rationale: Micro.blog ingests the site's own feed
  (PESOS-free syndication at the platform edge), so a push-style POSSE client is
  redundant; cross-posting *from* Micro.blog onward is configured on Micro.blog
  itself. Document this in the new doc under a "Why Micro.blog is not a POSSE
  target" heading.
- Inspect `Sources/AnglesiteCore/IntegrationCatalog.swift`: if the IndieWeb
  integration entry supports a lightweight setup-hint/link field, add a Micro.blog
  mention pointing at the new doc; if that would require schema changes, skip the
  Swift edit and note the follow-up in the doc instead. Keep this task doc-first.
- Cross-link the doc from any existing docs index that lists site-help guides (check
  `docs/` for a README or index convention; skip if none).
