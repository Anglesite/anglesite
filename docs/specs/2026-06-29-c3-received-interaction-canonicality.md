# C.3: Received-Interaction Data Canonicality

**Date:** 2026-06-29
**Status:** Decided; snapshot step implemented (#362, 2026-07-24)
**Part of:** #340 (cross-cutting decisions), #334 (pivot epic)
**Prerequisite for:** V-3.4 (#362, render + snapshot received interactions)

**Note on the mf2-enrichment gap:** `@dwk/webmention`'s D1 rows only carry
`interactionType`/`author`/`content`/`publishedAt` once its inbox is enriched
via `@dwk/mf2` — that enrichment pass merged to the sibling `davidwkeith/workers`
monorepo's `main` on 2026-07-24 but was not yet published to npm when #362
shipped. `WebmentionInboxD1Client` reads those columns as fully optional, so a
site running the older published package still snapshots (as plain
`"mention"`-typed interactions, no author/content) rather than breaking; the
richer data appears automatically once the site redeploys against a released
version that populates them — no further app-side change needed.

---

## The Question

When someone else's site sends a webmention to your site (a reply, a like, a
repost), or when an ActivityPub actor delivers an activity to your inbox, the
Worker's inbox store (D1) records it. That data is **someone else's content,
cached on your infrastructure.** Is it canonical in your git repo (`Source/`)?

This matters because #72 says "git is the source of truth." If received
interactions only live in D1, they're lost when you move hosting providers — your
site's comment section evaporates. If they're in git, they survive any backend
migration.

## Decision

**Snapshot received interactions into `Source/` git.** The Worker periodically
(or on-demand) serializes verified interactions to JSON files in
`Source/data/interactions/`, committed to the site's repo. This is the
IndieWeb-standard approach: your site's git repo contains a complete, portable
record of both your content and the interactions it received.

### The schema

Each interaction is a JSON file at `Source/data/interactions/{id}.json`:

```json
{
  "id": "wm-abc123",
  "type": "webmention",
  "source": "https://other.example/post/42",
  "target": "https://my.site/articles/hello-world",
  "interactionType": "reply",
  "author": {
    "name": "Jane Doe",
    "url": "https://other.example",
    "photo": "https://other.example/photo.jpg"
  },
  "content": "Great post! I especially liked the part about...",
  "published": "2026-06-28T14:30:00Z",
  "verified": "2026-06-28T14:35:12Z",
  "verificationStatus": "verified"
}
```

Fields:
- `id`: Stable, unique ID assigned by the Worker (e.g. `wm-{hash}`, `ap-{hash}`)
- `type`: Protocol source — `"webmention"`, `"activitypub"`, `"micropub"`
- `source`: The URL that sent the interaction
- `target`: The URL on this site that received it
- `interactionType`: `"reply"`, `"like"`, `"repost"`, `"bookmark"`, `"mention"`
- `author`: Parsed h-card / ActivityPub actor (name, url, photo — all optional)
- `content`: Text/HTML content of the interaction (optional, may be truncated)
- `published`: When the source published it (ISO 8601)
- `verified`: When the Worker verified it (ISO 8601)
- `verificationStatus`: `"verified"`, `"pending"`, `"failed"`

### The flow

```
External site → Webmention/AP → Worker inbox (D1)
                                      │
                                      ▼
                              Verify (async queue)
                                      │
                                      ▼
                              Snapshot to git ─────────► Source/data/interactions/
                              (on verify, or periodic)     │
                                                           ▼
                                                    Astro build reads
                                                    interactions → renders
                                                    on the target page
```

### Design principles

1. **Git-canonical, D1-operational.** D1 is the live operational store (fast
   lookup, queue management). Git is the canonical archive. They stay in sync
   via a snapshot step — D1 → JSON → git commit → push. If they diverge, git
   wins (the snapshot is idempotent and overwritable).

2. **One file per interaction.** Not a monolithic `interactions.json`. This
   keeps git diffs clean (one new file per new interaction), avoids merge
   conflicts, and lets Astro's glob loader enumerate them efficiently.

3. **Verified only.** Only interactions that pass Webmention verification or
   ActivityPub signature validation are snapshotted to git. Pending/failed
   interactions stay in D1 for retry but do not enter the repo.

4. **Content is truncated.** The snapshot stores a summary of the interaction
   content (first ~500 chars), not the full remote page. This keeps the repo
   lean, avoids storing other people's full posts, and is sufficient for
   rendering a comment thread.

5. **Author data is a snapshot.** The `author` object is a frozen point-in-time
   copy of the sender's h-card / AP actor at verification time. It is not
   live-updated — if the sender changes their name/photo, the old values persist
   in the snapshot. This is standard IndieWeb practice.

### How the snapshot enters git (implemented, V-3.4 / #362)

As built, the pull runs app-side rather than Worker-side — the Worker never
gains git credentials or push access; it stays a read-only D1 store, matching
every other `Source/`-writing path in this app (#72: the app's local working
copy is hydrated from the repo and pushed back to it, not the container). This
mirrors #587's `InboxSubmissionSync`/`InboxKVClient` precedent exactly, swapping
KV for D1:

1. `WebmentionInboxD1Client` queries the Worker's shared per-site D1 database
   (`SiteSettings.provisionedWorkerResources.d1DatabaseID`) directly over
   Cloudflare's D1 HTTP API — `SELECT … FROM webmentions ORDER BY verified_at
   DESC`, the *full current inbox*, not just what's new since last time.
2. `ReceivedInteractionSync.makeInteraction` maps each row to `ReceivedInteraction`.
3. `ReceivedInteractionCommitter` reconciles `Source/data/interactions/` against
   that set: writes new/changed files, deletes files whose interaction is no
   longer present, and is a true no-op (no git call at all) when nothing
   changed — full-set reconciliation is what makes deletion (see below) work
   without a separate "since last snapshot" cursor.
4. Commits in one batch: `chore: snapshot {n} received interactions` (or
   `chore: remove {n} received interactions` for a deletion-only reconcile).

Triggered once per site-open (`PreviewModel.open(site:)`), alongside
`InboxSubmissionSync` — not a cron job, not yet exposed as an on-demand UI/App
Intent action (both remain open follow-ups if a longer gap between opens turns
out to matter in practice).

### What about deletion?

If a sender deletes their webmention (sends a 410/404 on re-verification), the
Worker's `InboxStore.remove` drops the D1 row, and the next reconcile removes
the corresponding file from git (full-set reconciliation, not a soft-delete
marker: the file's id simply stops appearing in the queried set).

If the site *owner* wants to hide an interaction (moderation), they delete the
JSON file from their repo. The Worker's D1 record is unaffected (it's operational
data), but the interaction no longer renders on the static site. A future
moderation UI (V-5.3, #370) could add a `moderation` field to the schema instead
of file deletion.

### Astro consumption

`Source/data/interactions/` is loaded by Astro's glob loader at build time.
The page template for each content entry queries interactions where
`target` matches the entry's canonical URL, groups by `interactionType`, and
renders them (replies as a comment thread, likes/reposts as facepile counts).

This is static — the interaction display updates on next build, not in real time.
Real-time display is a future enhancement (WebSocket from the Worker to the
page, or a client-side fetch to the Worker's API).

## Swift schema

The `ReceivedInteraction` type in `Sources/AnglesiteCore/ReceivedInteraction.swift`
is the canonical Swift representation of this schema. It is:

- `Codable` — round-trips through the JSON format described above
- `Sendable` — safe for concurrent use
- `Equatable` — for diffing snapshots
- `Identifiable` — `id` is the stable interaction ID

The `gitPath` computed property returns the relative path within `Source/` where
the interaction should be stored (e.g. `"data/interactions/wm-abc123.json"`).

`InteractionType` provides two display-category helpers:
- `isComment` — true for `.reply` (renders in the threaded comment section)
- `isFacepile` — true for `.like` and `.repost` (renders as avatar facepile)
