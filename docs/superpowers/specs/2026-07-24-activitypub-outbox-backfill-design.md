# ActivityPub outbox backfill — design (#926)

- **Date:** 2026-07-24
- **Status:** Decided (DWK, 2026-07-24)
- **Issue:** [#926 — Sync existing Astro content into the ActivityPub outbox](https://github.com/Anglesite/Anglesite-app/issues/926)
- **Part of:** [#338 — V-4: Federation + reader](https://github.com/Anglesite/Anglesite-app/issues/338), follow-up scoped out of [#363 — V-4.1: ActivityPub actor](https://github.com/Anglesite/Anglesite-app/issues/363)
- **Related:** [`docs/superpowers/specs/2026-07-23-activitypub-actor-design.md`](2026-07-23-activitypub-actor-design.md) (#363), [`Sources/AnglesiteCore/SocialPublishPlan.swift`](../../../Sources/AnglesiteCore/SocialPublishPlan.swift) (#356, the closest existing precedent), [`Sources/AnglesiteCore/POSSESyndicationLog.swift`](../../../Sources/AnglesiteCore/POSSESyndicationLog.swift) (idempotency-ledger precedent)

## 1. The problem

#363 wired *new* Micropub-created posts into the ActivityPub outbox as they're created — a runtime request-path fan-out (`fanOutMicropubCreateToActivityPub` in `Resources/Template/worker/worker.ts`). It does nothing for a site's *existing* content: posts published before ActivityPub was ever turned on, or authored directly in `Source/` rather than through a Micropub client. For those, the outbox stays empty, so a Mastodon user who follows an established site sees nothing until the owner's next Micropub post — not the site's actual history.

**The blocking discovery that shaped this design:** `@dwk/activitypub`'s outbox Durable Object has no "quiet insert." Every path into it (`POST <actor>/outbox`, `POST <actor>/publish`) immediately fans out a delivery to every current follower, and neither path accepts a caller-supplied `published` timestamp — both hardcode `new Date().toISOString()`. A literal backfill against today's package would notification-blast every historical post to whoever follows the site *today*, and — because the outbox's `OrderedCollection` is paged by insertion `seq`, not by the AS2 `published` field — would very likely display out of chronological order too.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Blast-radius problem | **Request an upstream `@dwk/workers` change** (quiet insert + preserved `published`) rather than shipping against today's package or narrowing scope to dodge the problem. Mirrors the V-5 Stage 2 pattern: file upstream, gate this app-side work on it landing in a release. |
| D2 | Backfill scope | **Full back-catalog**, not a capped recent-window — matches the issue's literal acceptance criterion ("the federated history reflects what's actually on the site"). |
| D3 | Content collections (v1) | **11 of 12** — `blog`, `articles`, `notes`, `replies`, `bookmarks`, `likes`, `photos`, `albums`, `events`, `announcements`, `reviews`. `members` is excluded: it's roster data (who joined), not a publishable post, and federating "X joined" as a public Note is a different kind of thing than the rest of this feature. |
| D4 | AS2 type mapping | **Note or Article only**, never a custom AS2 type — most fediverse clients (Mastodon included) render Note/Article reliably and often show nothing useful for anything else. See §4 for the per-collection table. |
| D5 | Enumeration seam | **Filesystem walk** (extends `SocialPublishPlan`'s pattern), not the CMS-aware `getCollection`/`feeds.ts` seam. CMS-mode sites (`CMS_CONTENT_API_URL` set) are **out of scope for v1** — the walk silently finds nothing there. Matches the existing frontier: POSSE syndication (the closest analogous feature) doesn't support CMS-mode either. |
| D6 | Trigger | **Every deploy, ledger-gated** — runs in `DeployCoordinator.runPostDeploySequencing` (the same slot as `WebSubPublishPing`/`syndicate()`), skipping anything already recorded. Cheap no-op on repeat deploys; automatically picks up posts authored directly in `Source/` on any later deploy, with no separate "first activation" code path needed. |
| D7 | Idempotency | **New ledger**, `Config/activitypub-outbox.json`, keyed by canonical URL — not a reuse of `POSSESyndicationLog` (different concept: outbound copies to other platforms vs. this site's own outbox history), but the same record-before-continue crash-safety shape. |
| D8 | Object content | **Plain-text excerpt** (~500 chars, matching `ReceivedInteraction`'s truncation precedent), not full rendered HTML — avoids needing a markdown-to-HTML renderer in Swift. `url` on the AS2 object links to the full canonical page. |

## 3. Upstream request (`davidwkeith/workers`)

Filed as [`davidwkeith/workers#451`](https://github.com/davidwkeith/workers/issues/451) (mirroring how `davidwkeith/workers#376` was filed for V-5 Stage 2's Group-actor hosting), asking `@dwk/activitypub`'s outbox DO for:

1. **Quiet insert** — a flag on `#publish`/`#publishPost` (or a distinct backfill-only entry point) that inserts into the `outbox` table without enqueueing delivery to current followers (`#enqueueDelivery`/the alarm-armed background fan-out in `object.ts`'s `#publish`).
2. **Preserve caller-supplied `published`** — `#asOutboxActivity` currently spreads caller input *before* overwriting `id`/`actor`/`published` with literals (`object.ts`), silently discarding any backdated timestamp. Backfill needs the real historical date to reach the AS2 object.
3. **Nice-to-have, not blocking v1** — order the outbox `OrderedCollection` by the already-stored-but-unused `published_at` column instead of insertion `seq`. Without this, an old post discovered in a *later* deploy (e.g. added to `Source/` after newer real-time posts already synced) can display out of chronological order relative to those newer posts. This is an edge case within an edge case; accepted as a known limitation if the upstream maintainer doesn't want to change collection ordering semantics. Oldest-first processing within a single backfill run (§6) still gets the common case right regardless.

This app-side work (§4–§7) is gated on this landing in a tagged `@dwk/workers` release, per the same "conformant beta is sufficient" policy the pivot epic (#334) already established — concretely, on `Resources/Template/package.json`'s `@dwk/activitypub` pin being bumped to a version that includes it, in the same PR that implements §4–§7. There is no runtime feature-detection: an app build only ever ships `ActivityPubOutboxBackfill` once its own template dependency includes the capability, so there is no code path where the flag could be sent to an older, un-upgraded package and silently ignored (which would defeat the point — an ignored flag still blasts followers).

## 4. Content enumeration + AS2 mapping

`OutboxBackfillPlan` (new, `Sources/AnglesiteCore/`) mirrors `SocialPublishPlan.walk()`: reads `Source/src/content/{blog,articles,notes,replies,bookmarks,likes,photos,albums,events,announcements,reviews}` directly off disk, parses frontmatter via the existing `Frontmatter.parse`, and applies the same `draft`/future-dated-entry filter `SocialPublishPlan` already uses. Canonical URL derivation reuses the same `/<collection>/<slug>/` scheme.

| Collection(s) | AS2 kind | Notes |
|---|---|---|
| `blog`, `articles` | `Article` | Longer-form; both schemas have a title + body. |
| `notes`, `replies` | `Note` | `replies` sets `inReplyTo` from its `inReplyTo` frontmatter field. |
| `bookmarks`, `likes` | `Note` | Target expressed as plain text in `content` (e.g. "Liked: <url>"), not a native AS2 `Like` activity — the target usually isn't a resolvable AP object with an actor, so a real `Like` activity doesn't apply cleanly. |
| `photos`, `albums` | `Note` + `attachment` | Image(s) as AS2 `attachment` entries. |
| `events`, `announcements`, `reviews` | `Note` | Plain-text summary (title/date/location for events; review text/rating as text) — not a custom AS2 type, per D4. |
| `members` | *(excluded)* | See D3. |

Object body (`content`): a ~500-char plain-text excerpt of the post body (D8), `url` pointing at the full canonical page.

## 5. Idempotency ledger

```swift
struct ActivityPubOutboxLedger: Codable {
    struct Entry: Codable {
        let canonicalURL: String
        let activityID: String   // the id the DO returned
        let syncedAt: Date
    }
}
```

Stored at `Config/activitypub-outbox.json` (app-owned, never in git — same tier as `POSSESyndicationLog`'s `Config/posse-syndication.json`). `contains(canonicalURL:)` gates each entry before sync. A successful outbox insert is recorded to the ledger *before* moving to the next entry, matching `POSSESyndicationLog`'s crash-safety ordering: if the app dies mid-run, the next deploy resumes cleanly without re-posting anything already accepted.

## 6. Sync execution

New `ActivityPubOutboxBackfill` (`Sources/AnglesiteCore/`), shaped like `WebSubPublishPing`: `Sendable`, an injectable `Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)`, best-effort (never throws out of the pipeline).

Flow:
1. Gated on `activitypubProvisioned` — same computed check `DeployModel.swift` already does for `websubProvisioned` (`workers.contains(where: { $0.id == WorkerComposition.activitypubWorkerID })`).
2. Build the plan via `OutboxBackfillPlan`, filter out anything already in the ledger (§5), **sort remaining entries oldest-`publishDate`-first**.
3. For each: read `AP_PUBLISH_TOKEN` from `SecretStore` (`SecretAccounts.activityPubPublishToken(siteID:)`, already provisioned by `ActivityPubKeyProvisioning`), POST to the deployed site's `/users/site/outbox` with the quiet-insert flag and the backdated `published`; record the response's activity id to the ledger before continuing.
4. Wired into `DeployCoordinator.runPostDeploySequencing` as a fourth step, after `syndicate()`. A failure on one entry is logged and skipped — it never blocks the rest of the backfill or the deploy itself, matching `sendWebmentions()`/`syndicate()`/`notifySubscribers()`'s existing best-effort contract.

Explicitly out of scope for v1 (no existing precedent handles these for #363 either, so this isn't a new gap):
- **Edits after backfill** — no `Update` activity on a content change; the ledger only tracks "was this ever synced," not content-hash staleness.
- **Deletions** — no `Delete`/tombstone activity when a post is removed from `Source/`.
- **CMS-mode sites** — silently backfill nothing (D5).

## 7. Testing

- `OutboxBackfillPlanTests` — frontmatter walk, draft/future-date filtering, per-collection AS2 kind mapping (§4 table), excerpt truncation. Pure, no I/O, same style as `SocialPublishPlanTests`.
- `ActivityPubOutboxLedgerTests` — record/contains/persistence round-trip, mirroring `POSSESyndicationLogTests`.
- `ActivityPubOutboxBackfillTests` — injected `Transport`, asserts oldest-first ordering and ledger-skip behavior on a repeat run, mirroring `WebSubPublishPingTests`.
- No `Resources/Template/worker/worker.ts` changes are needed for this piece — the outbox behavior change lives entirely upstream in `@dwk/activitypub`; this app only ever calls the existing `/outbox` route, so there's no new Worker route to test at the template level.

## Target architecture invariants

- A follower who follows an established site today never receives a notification storm from that site's *historical* content — quiet insert is a hard prerequisite, not an optimization.
- Backfill is idempotent and crash-safe: interrupting a deploy mid-backfill never re-posts an already-synced entry on the next run.
- Backfill never blocks or fails a deploy — errors are logged and skipped per-entry.
- CMS-mode sites are a documented, silent no-op for this feature, not a crash or a partial/incorrect backfill.
- `members` content is never federated by this feature.
