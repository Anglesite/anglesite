# V-3.2: Micropub Server — Worker Composition + Provisioning

**Date:** 2026-07-23
**Status:** Proposed
**Part of:** #360 (V-3.2), #337 (V-3 tracking), #334 (pivot epic)
**Precedent:** #887 + #896 (V-3.1 Webmention receive, same two-part shape)

---

## Goal

Compose `@dwk/micropub` into the per-site Cloudflare Worker so a Micropub client
(a blog editor app, a bookmarklet, `micropub.rocks`) can create/update/delete
posts and upload media to a site, mirroring exactly how V-3.1's webmention
receiver landed: a Worker-composition slice that degrades gracefully when
unprovisioned, plus the provisioning wiring (wrangler.toml generation,
Cloudflare resource creation) to actually make it usable.

**Explicitly out of scope for this design** (their own follow-up issues, same
posture as webmention leaving the git-sync to #362):

- **The content-sync bridge** — turning a Micropub-created post (mf2 source
  row in `MICROPUB_DB`) into a typed content file under `Source/` so
  "app-edit and Micropub-post are one operation on the repo." This needs its
  own design spike (which content type each mf2 post-type maps to, real-time
  vs on-open sync, `@dwk/micropub`'s stored schema vs `content.config.ts`'s
  Zod schema) — the same class of problem that's still blocking #362 for
  webmention's received-interaction snapshot.
- **A Settings UI toggle** for activating Micropub. `SiteSettings.activeWorkerIDs`
  has no UI writer for *any* worker today (webmention included), so this
  isn't a regression — just staying consistent with the current state.
- **A live `micropub.rocks` conformance run.** Like webmention.rocks, this
  needs a real deployed, provisioned site — a manual verification step for
  you to run once this ships, not something scriptable here.

---

## Background: what's already there

`docs/specs/2026-06-29-c1-indieweb-content-model-decision.md` and
`c2-workers-integration-seam.md` already establish the integration model this
follows: each `@dwk/*` package is a `createXxx({ baseUrl, ... })` factory
composed into `Resources/Template/worker/worker.ts`, with bindings generated
by `WorkerComposition.generateWranglerToml` and resources created by
`SocialWorkerProvisionCommand`. V-3.1 (#887 + #896) is the direct precedent:

- `Resources/Template/worker/worker.ts` composes `@dwk/webmention`'s
  `/webmention` route + queue consumer, degrading to `503` when
  `WEBMENTION_QUEUE`/`WEBMENTION_INBOX`/`SITE_URL` aren't bound.
- `WorkerComposition.generateWranglerToml` special-cases
  `hasWebmentionReceive` (keyed off the catalog id `"webmention"`, not a
  generic resource flag) to emit the `WEBMENTION_INBOX` D1 binding (reusing
  the site's shared `{site}-social` database, the same one `AUTH_DB` binds),
  the `WEBMENTION_QUEUE` producer/consumer blocks, and a `SITE_URL` var.
  `webmentionWorkerID`/`indieauthWorkerID` are documented as deliberate
  exceptions to the generic `resources.needsD1/needsKV/needsR2` flags,
  because those specific binding *names* are part of each package's public
  composition contract, not something a boolean flag can express.
- `SocialWorkerProvisionCommand` creates the Cloudflare Queue via `wrangler
  queues create`, gated on an explicit per-site Workers-Paid-plan
  acknowledgment (`DeployModel` parks the deploy and shows a confirmation
  sheet).

Micropub needs the same three things — worker composition, wrangler.toml
generation, resource provisioning — plus one thing webmention didn't need:
a cross-worker **dependency**. The published catalog now declares
`micropub.requires == ["indieauth"]`, and nothing in the app currently reads
or acts on that field.

## Prerequisite fix: `WorkerDescriptor.Resources` decoding

Before any of the above can work, there's a decode mismatch to fix. The live
`catalog.json` (`https://raw.githubusercontent.com/davidwkeith/workers/main/catalog.json`)
now publishes `resources` as a **typed array** for every entry, including the
already-shipped `webmention`/`indieauth`:

```json
"resources": [
  { "type": "d1", "binding": "AUTH_DB" },
  { "type": "secret", "binding": "TOKEN_SIGNING_KEY" }
]
```

`WorkerDescriptor.Resources` (`Sources/AnglesiteCore/WorkerCatalog.swift`)
currently only decodes the legacy flat shape:

```json
"resources": { "needsD1": true, "needsKV": true, "needsR2": false }
```

Decoding an array where a keyed object is expected throws a
`DecodingError.typeMismatch`, which fails `WorkerCatalogReader.parse` for the
*entire* manifest — and per `WorkerCatalogFetcher`'s documented degrade path
(network/parse failure → last good disk cache → empty catalog, never throws
to callers), this silently resolves to an **empty catalog** on any machine
that has never successfully cached a pre-schema-change copy. `SiteOperations`'
headless deploy path (`deployWithWorkerComposition`) reads catalog data only
from that on-disk cache (`cachedWorkerCatalog()`), so this isn't a
theoretical gap — it's the actual data source real provisioning reads
descriptor/route-claim data from today.

**Fix:** give `Resources` a custom `init(from decoder:)` that tries the new
typed-array shape first (`needsD1`/`needsKV`/`needsR2` become `true` iff the
array contains an entry whose `type` is `"d1"`/`"kv"`/`"r2"` respectively —
`"secret"`/`"queue"` entries are ignored, matching how those are already
handled by `WorkerComposition`'s hardcoded per-worker blocks, not generic
flags) and falls back to decoding the legacy flat-object shape if the array
decode fails, so the existing `WorkerCatalogTests`/`WorkerActivationTests`
fixtures (which construct the old shape directly) keep working unmodified.
The stored properties, the public memberwise initializer, and every
`WorkerComposition.swift` call site are unchanged — `encode(to:)` keeps
synthesizing automatically since only `init(from:)` is hand-written. This is
a decode-compatibility fix, not a `Resources` API change.

---

## Design

### 1. `worker/worker.ts` — compose `@dwk/micropub`

Import `createMicropub` and route `/micropub` (GET/POST) and `/media` +
`/media/*` (POST/GET) to it, following `hasWebmentionReceive`'s exact
degrade-gracefully pattern: if `MICROPUB_DB`, `AUTH_DB`, `MEDIA`, or
`TOKEN_SIGNING_KEY` aren't all bound, respond `503` instead of letting
`@dwk/micropub` throw its own loud startup error. Pin
`@dwk/micropub@^0.1.0-beta.4` in `workers-version.json` (mirrors how
`@dwk/webmention@0.1.0-beta.3` was pinned in #887). Tests added to
`worker/worker.test.ts` under the `@cloudflare/vitest-pool-workers` pool,
covering: `/micropub` create (201 + Location), `/micropub` degrade (503),
`/media` upload (201/202) and degrade (503), and that `q=config`/`q=source`
round-trip through the bound `MICROPUB_DB`.

### 2. `WorkerDescriptor.requires` — model the new dependency field

Add `public let requires: [String]?` to `WorkerDescriptor` (optional,
`decodeIfPresent`, defaults to `nil` for the many entries — indieauth
included — that don't declare it, so this is fully backward-compatible with
existing fixtures).

### 3. `WorkerActivation.effectiveActiveIDs` — resolve `requires` transitively

After computing the existing active set (component-tied ∪ settings-activated
requested-and-known), do one more pass: for every active descriptor with a
non-empty `requires`, union in those ids too, provided they're present in
`catalog` (an id `requires` names but that isn't in the catalog is dropped —
same "never invents" posture `effectiveActiveIDs` already documents for
component-tied workers). Iterate to a fixed point with a visited-set guard
so a future catalog entry with a `requires` cycle can't infinite-loop —
today's catalog has none, this is defense-in-depth, not a currently-reachable
case. This means turning on `"micropub"` in `SiteSettings.activeWorkerIDs`
automatically makes `"indieauth"` active too, so `WorkerComposition` sees
`hasIndieauth == true` and emits `AUTH_DB`/`TOKEN_SIGNING_KEY` without the
user needing to separately toggle IndieAuth on.

### 4. `WorkerComposition.generateWranglerToml` — `hasMicropub` branch

Add `micropubWorkerID = "micropub"` alongside the existing
`indieauthWorkerID`/`webmentionWorkerID` constants (same rationale: specific
binding names, not generic flags). When `workers.contains(where: { $0.id ==
micropubWorkerID })`:

- `MICROPUB_DB` — D1, reuses the shared `{site}-social` database (same
  `database_id` as `DB`/`AUTH_DB`/`WEBMENTION_INBOX` — `@dwk/micropub`
  creates its own tables on first use, no separate database or migration,
  matching the comment already on `WEBMENTION_INBOX`'s block).
- `MEDIA` — R2 bucket, `{site}-media` (falls back to the same deterministic
  naming `resources.r2BucketName` already uses for the generic `needsR2`
  path — this is the same bucket name whether reached via `needsR2` or the
  micropub-specific branch, since a site only ever needs one media bucket).

`AUTH_DB`/`TOKEN_SIGNING_KEY` don't need a new branch — they already emit
whenever `hasIndieauth` is true, and step 3 guarantees IndieAuth is active
whenever Micropub is.

**Route claims:** `micropub`'s catalog routes (`/micropub` exact,
`/media` exact, `/media/` prefix) flow through the existing
`WorkerRouteClaims.activeClaims` → `generateWranglerToml(routeClaims:)` path
used for every catalog-declared route today — no new plumbing needed. But
the `/media/` prefix claim as currently published has no `specificationURL`,
which `WorkerRouteClaims.validate` requires for any `match: .prefix` claim
(only a specification can approve matching child paths). As published, this
claim would throw `ConfigError.invalidRouteClaim` and hard-fail provisioning
for every site that activates Micropub.

**Decision (revised during plan-writing):** `DeployModel.swift:514-516`
documents an existing, deliberate policy at the `WorkerRouteClaims
.activeClaims` call site — "never silently drop a claim and deploy a Worker
whose routes don't match its catalog contract." `activeClaims` throws on the
first invalid claim and both call sites (`DeployModel.swift`,
`SiteOperations.swift`) hard-fail the deploy on that error, by design. A
skip+log behavior change would weaken that policy for every worker, not just
Micropub, so this design does **not** change `activeClaims`. Instead: the
`/media/` prefix claim's missing `specificationURL` is a `catalog.json` data
bug to fix upstream (`davidwkeith/workers`, a one-line addition of a
`specificationURL` pointing at the Micropub spec's media-endpoint section) —
this app-side implementation makes no code changes for it. Until that catalog
fix ships, activating Micropub on a site will make `activeClaims` throw and
the deploy will fail with a clear "invalid route claim" reason — a correct,
loud failure per the existing policy, not a silent gap. `POST /micropub` and
`POST /media` (both *exact* claims) are unaffected either way.

### 5. `SocialWorkerProvisionCommand` — create the R2 bucket

Extend the existing `workers.contains(where: { $0.resources.needsR2 })`
branch (already present for generic R2 needs) to also fire for Micropub —
this falls out for free once `Resources.needsR2` is decoding correctly per
the prerequisite fix, since Micropub's catalog entry includes a `"type":
"r2"` resource. `MICROPUB_DB`'s D1 database reuses the same `wrangler d1
create` call already made for `AUTH_DB`/`DB` (one shared per-site database,
no new command needed — matches how `WEBMENTION_INBOX` needed none either).

---

## Data flow

```
Micropub client → POST /micropub (Bearer token)
                       │
                       ▼
        @dwk/micropub validates token against AUTH_DB
        (issued by @dwk/indieauth, DPoP-bound)
                       │
                       ▼
        writes mf2 source row to MICROPUB_DB (D1)
                       │
                       ▼
              201 Created + Location header

Media upload → POST /media (Bearer token, media scope)
                       │
                       ▼
        streamed to MEDIA (R2 bucket)
                       │
                       ▼
              201 Created + Location header (the media URL,
              referenced by a subsequent /micropub post body)
```

Nothing in this slice touches `Source/` git — the mf2 rows in `MICROPUB_DB`
are the only record of a Micropub post until the deferred content-sync
bridge exists.

## Error handling

- Unprovisioned bindings (`MICROPUB_DB`/`AUTH_DB`/`MEDIA`/`TOKEN_SIGNING_KEY`
  not all present) → `503` from the Worker, never a thrown/crashed handler.
- An invalid route claim (the `/media/` prefix gap above, until the upstream
  catalog fix ships) → deploy fails loudly with a clear reason, per
  `activeClaims`'s existing, unchanged "never silently drop a claim" policy.
- R2 bucket / D1 creation failures during provisioning surface through the
  existing `SocialWorkerProvisionCommand.Result.failed` case and the debug
  pane, same as every other provisioning step today.
- A catalog fetch/parse failure (including one the prerequisite fix doesn't
  anticipate — e.g. a third future shape) still degrades to cache → empty
  catalog, never throws to `SiteOperations`/`DeployModel` callers — this
  slice doesn't change that contract, only makes the *current* shape decode
  correctly.

## Testing

- `Resources/Template/worker/worker.test.ts` — new Micropub create/degrade
  and media upload/degrade cases (miniflare/`vitest-pool-workers`, mirrors
  `#887`'s 7 webmention-receive cases).
- `Tests/AnglesiteCoreTests/WorkerCatalogTests.swift` — `Resources` decoding
  from both the new array shape and the legacy flat shape; `requires`
  decoding (present and absent).
- `Tests/AnglesiteCoreTests/WorkerActivationTests.swift` — `requires`
  resolution (micropub → indieauth transitively activated) and the
  cycle-guard.
- `Tests/AnglesiteCoreTests/WorkerCompositionTests.swift` — the new
  `hasMicropub` TOML branch (`MICROPUB_DB`, `MEDIA`, route claims present);
  the invalid `/media/` prefix claim is skipped rather than thrown.
- `Tests/AnglesiteCoreTests/SocialWorkerProvisionCommandTests.swift` — R2
  bucket creation fires for Micropub the same way it already does for the
  generic `needsR2` case.

## Files touched

- `Resources/Template/worker/worker.ts`, `worker.test.ts`,
  `workers-version.json`
- `Sources/AnglesiteCore/WorkerCatalog.swift` (`Resources` custom decode,
  `WorkerDescriptor.requires`)
- `Sources/AnglesiteCore/WorkerActivation.swift` (`requires` resolution)
- `Sources/AnglesiteCore/WorkerComposition.swift` (`hasMicropub` branch,
  `micropubWorkerID` constant)
- `Sources/AnglesiteCore/SocialWorkerProvisionCommand.swift` (verify the
  existing `needsR2` branch covers Micropub once decoding is fixed; add a
  test, not necessarily new production code)
- Matching files under `Tests/AnglesiteCoreTests/`

## Self-review

- **Placeholders:** none — every section above describes concrete behavior,
  not a TBD.
- **Internal consistency:** the "explicitly out of scope" list at the top
  and the per-component descriptions agree (no component silently attempts
  the content-sync bridge or a UI toggle).
- **Scope:** bounded to what #887+#896 together did for webmention, plus
  the one new piece webmention didn't need (`requires` resolution) and the
  one prerequisite the live catalog now forces (`Resources` decoding). Not
  further decomposed — this matches the user-approved "Worker + provisioning
  in one slice" scope.
- **Ambiguity resolved, not left open:** the `/media/` prefix route-claim
  gap could have been silently patched app-side (hardcoding a
  `specificationURL`) or handled by weakening `activeClaims`'s existing
  "never silently drop a claim" policy; this doc picks neither — the fix is
  an upstream `catalog.json` patch, per the user's confirmed choice, and the
  app-side `activeClaims` contract is left untouched.
