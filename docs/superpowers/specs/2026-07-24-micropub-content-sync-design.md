# Micropub Content Sync: D1 → `Source/` Bridge

**Date:** 2026-07-24
**Status:** Proposed
**Part of:** #912 (V-3.2 follow-up), #360 (V-3.2 Micropub server), #337 (V-3 tracking), #334 (pivot epic)
**Precedent:** #587 (`InboxSubmissionSync`), #362 (`ReceivedInteractionSync`) — same D1-to-git
shape, third instance

---

## Goal

A Micropub client (a blog editor app, `micropub.rocks`, an iOS posting client) creates a post
through the site's `/micropub` endpoint. Today that post lives only as an mf2 row in
`MICROPUB_DB` (D1) — it is not in `Source/` git, does not render on the built site, and is lost
if the site ever migrates off this Worker's D1 database. This design closes that gap: "app-edit
and Micropub-post are one operation on the repo," the acceptance bar #360 originally set and
explicitly deferred to this follow-up.

Concretely: a Micropub-created Note/Article/Photo/Album/Bookmark/Reply/Like/Event/Review becomes
a typed content file under `Source/src/content/<collection>/`, indistinguishable from one created
through the app's own editors, and renders at the URL the Micropub client was told about.

## Background

### The established sync pattern (read before implementing)

Two prior bridges already solve "D1 is the operational store, git is canonical, reconcile
on site-open" for this app:

- `InboxSubmissionSync` / `InboxSubmissionCommitter` (#587) — `INBOX_KV` staging →
  `src/content/inbox/`.
- `ReceivedInteractionSync` / `ReceivedInteractionCommitter` (#362) — `WEBMENTION_INBOX` D1 →
  `data/interactions/`.

Both share: an app-side D1/KV client (injectable-transport DI, no Keychain coupling, token
passed at init), a `Sync` orchestrator with a `pullAndCommitIfConfigured` entry point that no-ops
(returns 0, no network call) until the relevant `SiteSettings`/`provisionedWorkerResources` field
is set, a `Committer` that reconciles the *full current set* against a directory (write
changed, delete stale, true no-op — no git call at all — when nothing changed), one batched
commit via `processGitCommitBatch` (SwiftGit2 on Darwin, subprocess git off-Darwin), and a call
site in `PreviewModel.open(site:)` alongside the others. This design is a third instance of that
exact shape, reading `@dwk/micropub`'s `posts` table instead.

### What's different this time: the URL has to be right, not just present

The two precedents write into app-owned directories (`data/interactions/`, `src/content/inbox/`)
that nothing else writes to, and their target filename is an opaque id — no collision, no
routing concern. This bridge writes into `src/content/<collection>/`, a directory humans also
hand-edit, and the resulting page must render at the **same URL** the Micropub client's `Location`
header already promised. Two consequences drive the design below:

1. `@dwk/micropub`'s shipped default `generatePostUrl` assigns a flat `{baseUrl}/<slug>` URL,
   but Astro serves collection entries at `/<collection>/<slug>/`
   (`Resources/Template/src/pages/[collection]/[...slug].astro`). Left alone, a Micropub post's
   announced URL never matches where it will actually render. **Decision:** fix this at the
   source — configure a custom `generatePostUrl` in `worker.ts`'s Micropub composition that picks
   the collection at create time and returns `{baseUrl}/<collection>/<slug>`. The sync bridge
   then parses the collection straight out of the stored `url` column; it never needs to
   re-run type classification for the h-entry family at all, only for the top-level mf2 type.
2. A Micropub `mp-slug` (or name-derived slug) can collide with an existing, hand-authored file
   in the same collection — `@dwk/micropub`'s own URL-uniqueness check only guards its D1 table,
   not git filenames. **Decision:** the sync bridge checks the filesystem too and suffixes on
   collision, and remembers that resolution in a small per-site state file
   (`Config/micropubSync.json`, url → relative path) so a later re-sync of the *same* post updates
   the file it already wrote rather than re-resolving (and potentially re-suffixing) the slug
   every time.

### Content-type scope

The registry's personal h-entry family (`note`, `article`, `photo`, `album`, `bookmark`,
`reply`, `like`) plus two business types that Micropub clients can post directly via the JSON
`type` field: `event` (h-event) and `review` (h-review). `repost` (`u-repost-of`) has no
`ContentTypeDescriptor` today — out of scope for this slice, same posture as h-event/h-review
were for #360: a real, logged gap rather than a forced mapping. Any other/unrecognized mf2 type
is skipped (logged, left D1-only) by the sync — it never guesses.

---

## Design

### 1. Worker-side: type-aware URL generation (`worker.ts`)

A new pure module, `Resources/Template/worker/post-type-discovery.ts`, exports
`discoverCollection(mf2: { type: readonly string[]; properties: Record<string, unknown[]> }): string | null`:

- `type[0] === "h-event"` → `"events"`.
- `type[0] === "h-review"` → `"reviews"`.
- `type[0] === "h-entry"` (or absent, matching `@dwk/micropub`'s own default) → run IndieWeb
  [Post Type Discovery](https://www.w3.org/TR/post-type-discovery/), extended with a
  `bookmark-of` check (present in practice, not in the original algorithm text) and the
  count-based photo/album split:
  1. `bookmark-of` present → `"bookmarks"`
  2. `like-of` present → `"likes"`
  3. `in-reply-to` present → `"replies"`
  4. `photo` present, exactly one value → `"photos"`
  5. `photo` present, 2+ values → `"albums"`
  6. `name` present and the plain-text `content` doesn't start with `name` → `"articles"`
  7. else → `"notes"`
- Anything else (unrecognized `h-*`, `repost-of`, `rsvp`, `checkin`, `video`) → `null`.

`generatePostUrl` (passed into `createMicropub({ baseUrl, me, generatePostUrl })` in `worker.ts`):
calls `discoverCollection`; if `null`, falls back to `@dwk/micropub`'s own default flat-URL
policy (post stays creatable, just outside this bridge's scope, exactly like today). Otherwise:
slug = `mp-slug` (commands.slug) → `name`-derived slug → timestamp-based slug (same fallback
order and `slugify`/`randomSlug` `@dwk/micropub` already uses internally — this module doesn't
reimplement collision-retry, since `publishPost`'s existing loop already retries the whole
returned URL on a D1 conflict), and the function returns
`{baseUrl}/{collection}/{slug}`. Tested in `worker.test.ts`: one case per collection dispatch
rule, the unrecognized-type fallback, and the photo/album count split.

### 2. Swift app-side: `MicropubPostD1Client`

Mirrors `WebmentionInboxD1Client` exactly (same `CloudflareTransport` DI, same D1 HTTP query
shape) — a new file, `Sources/AnglesiteCore/MicropubPostD1Client.swift`:

```swift
public struct MicropubPostD1Client: Sendable {
    public struct Post: Sendable, Equatable {
        public let url: String
        public let type: String                    // mf2 root type, e.g. "h-entry"
        public let properties: [String: [JSONValue]] // raw mf2 property map, decoded generically
        public let deleted: Bool
        public let updatedAt: Int
    }
    public func listLivePosts() async throws -> [Post]   // SELECT ... FROM posts ORDER BY updated_at DESC
}
```

`properties` is `TEXT` (a JSON blob) in D1, not flat columns — the query decodes the row's
`properties` column as JSON per-row (unlike `WebmentionInboxD1Client`'s flat SQL projection,
this one JSON-decodes a nested blob). A small `JSONValue` enum (or reuse of an existing
any-JSON decode helper if one exists in `AnglesiteCore`) represents mf2 property values, since a
property's array elements can be plain strings or nested objects (rich-text `content`, form
sub-keys). Queries `SELECT url, type, properties, deleted, updated_at FROM posts ORDER BY
updated_at DESC` — no `WHERE deleted = 0` filter, matching `ReceivedInteractionSync`'s "pull the
full current set, let the committer's reconciliation decide what's live" pattern: a soft-deleted
row still needs to reach the committer so it can delete the corresponding file.

Reuses `ReceivedInteractionSync`'s account-id resolution and the same
`SiteSettings.provisionedWorkerResources.d1DatabaseID` (Micropub shares the same `{site}-social`
D1 database) — `MicropubContentSync.pullAndCommitIfConfigured` needs no new `SiteSettings` field.

### 3. Swift app-side: field mapping via the registry's existing projections

No new mapping table. `ContentTypeProjections.microformatProperties` already maps
`fieldName → mf2Property` (e.g. `"body": "e-content"`) for every registered type. Add one
small, pure reverse helper (`ContentTypeProjections.rawMf2PropertyName(for field:)` or a
computed `reverseMicroformatProperties: [String: String]`) that strips the mf2 prefix class
(`p-`/`e-`/`u-`/`dt-`) to get the raw property key `@dwk/micropub` actually stores (`"e-content"`
→ `"content"`), keyed by field name. `MicropubContentSync` then, for a given post's resolved
`ContentTypeDescriptor` (looked up via `ContentTypeRegistry.descriptor(id:)` using the collection
parsed from the post's URL — `descriptor(forCollection:)` — not by re-running Post Type
Discovery app-side):

- For each `ContentTypeField` on the descriptor, reads `properties[rawMf2PropertyName]`.
- Converts by `Kind`: `.string`/`.text`/`.markdown`/`.url` take `values[0]` (markdown/body
  additionally unwraps mf2 rich-text — a string as-is, or an object's `.value` string, mirroring
  `extractMf2ContentString` in `worker.ts`'s AP fan-out; no HTML-to-Markdown conversion in this
  slice — an explicit, stated simplification, same posture #362's design doc took on
  interaction-content truncation); `.datetime`/`.date` parse `values[0]` as ISO 8601;
  `.stringArray` takes the whole array as strings; `.image` takes `values[0]` as a URL string
  (the R2 media URL a prior `/media` upload returned); `.imageArray` (album only) takes every
  value; `.bool` (`draft`) is derived from `properties["post-status"] == ["draft"]`, not a direct
  field — matches the Post Status extension`@dwk/micropub` already validates on write.
- A required field with no matching property → the post is skipped (logged), not written with a
  placeholder — a malformed/partial post shouldn't produce invalid frontmatter.

### 4. Swift app-side: `MicropubContentCommitter` + sync-state file

New `Sources/AnglesiteCore/MicropubContentCommitter.swift`, structurally close to
`ReceivedInteractionCommitter` but per-collection and slug-aware rather than id-keyed:

- Reads/writes `Config/micropubSync.json` (`AnglesitePackage.configURL`-relative — app-owned
  state, never in git, same split every other per-site state already uses): a
  `[url: String]` → `relPath: String` map.
- For each live (non-deleted) post with a resolved collection + descriptor:
  - If `url` is already in the map, use its recorded `relPath` directly (no re-slugging, no
    collision check — this is what makes a second sync of the same post update-in-place).
  - Otherwise, derive the slug (from the URL's last path segment — the same slug the Worker
    already chose, so no independent slug logic app-side either), check
    `src/content/<collection>/<slug>.md` for an existing file; if present and its content wasn't
    written by this committer (no entry pointing at it in the map), suffix
    (`<slug>-2`, `<slug>-3`, …) until free, then record the mapping.
- For each mapped `relPath` no longer present in the live set (post soft-deleted, or its type
  fell out of scope on an edit — see below), delete the file and its map entry.
- Renders frontmatter (YAML, sorted keys for stable diffs) + body per the field mapping above,
  matching each collection's exact `.strict()` Zod schema in `content.config.ts` — no extra
  keys, or Astro's build fails closed on that collection.
- Writes/deletes are batched into one commit via the existing
  `InboxSubmissionCommitter.processGitCommitBatch`, message
  `"micropub: sync {n} post(s), remove {m}"` (mirroring
  `ReceivedInteractionCommitter.commitMessage`'s write/delete/both cases) — true no-op (no git
  call) when nothing changed. `Config/micropubSync.json` itself is written outside the git
  commit (it's in `Config/`, not `Source/`).

**Update semantics:** `@dwk/micropub`'s `updateProperties` overwrites a live post's `properties`
wholesale server-side already (no separate patch/merge needed app-side) — every sync simply
re-renders the file from the row's current `properties` and overwrites if content differs,
identical to how `ReceivedInteractionCommitter` handles a changed interaction. If an update
changes properties enough that `discoverCollection`-equivalent classification would now differ
(e.g. a note edited to add `bookmark-of`) — the *URL's* collection segment does not change (URLs
are permanent once assigned, matching IndieWeb norms and `worker.ts`'s existing
collision-retry-only-at-create behavior), so the file simply stays in its original collection
with updated content. This is a deliberate simplification: post identity (URL, and therefore
collection) is fixed at creation, never re-derived on update.

### 5. Wiring

`PreviewModel.open(site:)` gains a third call alongside the existing two:

```swift
_ = await MicropubContentSync.pullAndCommitIfConfigured(
    siteDirectory: siteDirectory, configDirectory: configDirectory)
```

No-ops (returns 0, no network call) until `provisionedWorkerResources.d1DatabaseID` is set —
same gate `ReceivedInteractionSync` already uses, since Micropub provisions the same shared D1
database.

---

## Data flow

```
Micropub client → POST /micropub (h-entry/h-event/h-review, Bearer token)
                       │
                       ▼
     @dwk/micropub validates + generatePostUrl (worker.ts, new):
     discoverCollection(mf2) → "notes"/"articles"/.../null
                       │
                       ▼
     writes mf2 row to MICROPUB_DB, url = {baseUrl}/{collection}/{slug}
     (or the untouched flat-URL fallback when discoverCollection → null)
                       │
                       ▼
              201 Created + Location: {baseUrl}/{collection}/{slug}


Next site-open (PreviewModel.open(site:)):
     MicropubPostD1Client.listLivePosts() → full current `posts` table
                       │
                       ▼
     MicropubContentSync: for each row, parse {collection} from url,
     descriptor(forCollection:) → ContentTypeDescriptor (skip if none)
                       │
                       ▼
     MicropubContentCommitter: resolve/create slug mapping (micropubSync.json),
     reverse-project mf2 properties → frontmatter via the field's own
     ContentTypeProjections, reconcile src/content/{collection}/, one commit
                       │
                       ▼
     Next Astro build: page renders at /{collection}/{slug}/ — the same
     URL the Micropub client's Location already promised
```

## Error handling

- D1 query failure → `listLivePosts()` throws, caught by
  `pullAndCommitIfConfigured` → returns 0; the next site-open re-attempts (matches both
  precedents — never surfaces a transient network error to the caller).
- A post whose collection can't be resolved (`discoverCollection` returned `null` at create
  time, or its mf2 `type` isn't one this bridge recognizes) → skipped, logged, left D1-only —
  visible in the debug pane (`LogCenter`), not a silent gap.
- A post missing a required field's mf2 property → skipped, logged — never written with a
  placeholder value that would fail the collection's Zod schema at build time anyway.
- Filesystem collision with a non-Micropub file → suffixed per the flow in §4, never
  overwritten.
- Commit failure (git subprocess/libgit2 error) → the whole reconcile for this sync pass
  returns without updating `micropubSync.json` for any newly-resolved mapping, so an
  interrupted sync re-attempts cleanly next time rather than leaving `micropubSync.json` and
  git out of sync with each other.

## Testing

- `Resources/Template/worker/post-type-discovery.test.ts` — one case per `discoverCollection`
  dispatch rule (each h-entry sub-type, h-event, h-review, unrecognized type → `null`, the
  photo/album count split, `bookmark-of` alongside `like-of`/`in-reply-to` precedence).
- `Resources/Template/worker/worker.test.ts` — `generatePostUrl` end-to-end: a create request
  for each supported type lands at the expected `/{collection}/{slug}` URL; an unsupported type
  falls back to the existing flat URL.
- `Tests/AnglesiteCoreTests/MicropubPostD1ClientTests.swift` — row decoding (including a
  `properties` blob with nested rich-text `content`), unauthorized/malformed-response handling
  (mirrors `WebmentionInboxD1ClientTests`).
- `Tests/AnglesiteCoreTests/MicropubContentSyncTests.swift` — collection resolution from a
  post's `url`, descriptor lookup, skip-and-log for an unresolvable collection/missing required
  field.
- `Tests/AnglesiteCoreTests/MicropubContentCommitterTests.swift` — write/update/delete
  reconciliation, `micropubSync.json` round-trip (first-sync slug resolution + suffix-on-
  collision, second-sync reuses the recorded path with no re-suffix), no-op-when-unchanged,
  frontmatter matches each collection's exact Zod schema (no extra/missing keys), commit-message
  variants.

## Files touched

- `Resources/Template/worker/post-type-discovery.ts` (new), `.test.ts`
- `Resources/Template/worker/worker.ts` (`generatePostUrl` wiring), `worker.test.ts`
- `Sources/AnglesiteCore/MicropubPostD1Client.swift` (new)
- `Sources/AnglesiteCore/MicropubContentSync.swift` (new)
- `Sources/AnglesiteCore/MicropubContentCommitter.swift` (new)
- `Sources/AnglesiteApp/PreviewModel.swift` (third sync call in `open(site:)`)
- Matching files under `Tests/AnglesiteCoreTests/`

## Self-review

- **Placeholders:** none — every section describes concrete behavior.
- **Internal consistency:** the URL-generation rule in §1 and the collection-parsing rule in §2
  are the same classification, run once (Worker, create time) and read once (app, sync time) —
  not two independent implementations of Post Type Discovery that could drift.
- **Scope:** the h-entry family + event + review, per the confirmed decision; `repost` explicitly
  named out of scope (no registry type exists for it yet) rather than left ambiguous.
- **Ambiguity resolved:** URL/routing mismatch, photo-vs-album dispatch, and hand-authored-file
  collision safety were all open questions in the originating issue; each has one stated answer
  above, not a menu of options.
