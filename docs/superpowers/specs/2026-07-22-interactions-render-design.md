# Interactions Render (V-3.4 #362, render half) — Design

**Date:** 2026-07-22
**Status:** Approved (DWK, 2026-07-22)
**Part of:** #362 (V-3.4), #337 (V-3), #334 (pivot epic)
**Builds on:** `docs/specs/2026-06-29-c3-received-interaction-canonicality.md` (C.3, Decided)

## Scope

Pulled forward ahead of the `@dwk/workers` conformance gate: the **Astro render half** of
V-3.4 only. The template reads received-interaction snapshots from `data/interactions/*.json`
in a site's `Source/` at build time and renders them under the matching content entry.

**Out of scope** (remains gated under #362): the Worker snapshot step (D1 → JSON → git
commit → push), real-time display, moderation UI (V-5.3). The render half consumes whatever
files exist in git — today that means fixtures or hand-authored files; after the gate, the
Worker's snapshots.

## Data contract

`Sources/AnglesiteCore/ReceivedInteraction.swift` is authoritative (C.3 spec §schema):
one JSON file per interaction at `data/interactions/{id}.json`, **root-level `data/`**
(sibling of `src/`), matching `ReceivedInteraction.gitPath`. This intentionally diverges
from the `src/data/profile.json` convention — the Swift contract shipped first.

The template ships an empty `data/interactions/` (`.gitkeep`) so scaffolded sites have the
landing spot and the glob resolves.

## Components

### 1. `src/lib/interactions.ts` — pure logic (the `feeds.ts` pattern)

No `import.meta.glob` in the lib (template `.test.ts` files run under
`npx tsx --test`, where Vite globs don't exist). The glob lives in the component; the lib
exports pure, unit-testable functions:

- `parseInteractions(mods: Record<string, unknown>): ReceivedInteraction[]` — takes the
  glob result, validates each file with zod (`astro/zod`) `safeParse`, mirroring the Swift
  schema: required `id` (`^[A-Za-z0-9_-]+$`), `type`, `source`, `target`,
  `interactionType`, `published`, `verified`, `verificationStatus`; optional `author`
  (`name`/`url`/`photo`), `content`. **Invalid files are skipped with a `console.warn`
  naming the file — never a build failure.** These are third-party-derived,
  user-editable files; a malformed one must not brick `astro build`.
- Only `verificationStatus === "verified"` interactions pass (defense-in-depth; the
  Worker's snapshot step already writes verified-only).
- `interactionsFor(canonicalUrl: string, all: ReceivedInteraction[]): GroupedInteractions`
  — matches `target` against the entry's canonical URL with trailing-slash-insensitive
  comparison, then groups: `comments` (reply, sorted by `published` ascending),
  `facepile.likes` / `facepile.reposts`, `mentions` (mention + bookmark). Mirrors the
  Swift `isComment` / `isFacepile` helpers.

### 2. `src/components/Interactions.astro`

- Owns the glob: `import.meta.glob("../../data/interactions/*.json", { eager: true })`
  (resolves to root-level `data/` from `src/components/`; returns `{}` when empty).
- Props: `{ canonical: string }`.
- Renders nothing at all when the page has no interactions.
- Markup (standard IndieWeb mf2): replies as `<li class="p-comment h-cite">` with
  `u-author h-card` (name, `u-url`, `u-photo`), `p-content`, `dt-published`; likes and
  reposts as avatar facepiles with counts; mentions/bookmarks as a short "mentioned by"
  line.
- **Sanitisation contract honored:** `content` renders as text only (Astro's default
  escaping / `set:text`) — never `set:html` — per the `ReceivedInteraction.swift` header.
- Avatars: `loading="lazy"`, `referrerpolicy="no-referrer"`, initials fallback when
  `author.photo` is absent.
- Scoped `<style>` using global CSS custom properties with fallbacks
  (`var(--color-text-muted, …)` etc.), matching template convention.

### 3. Layout wiring (additive only)

Mounted with the `canonical` URL each layout already computes, after `e-content`:

- `BlogPost.astro` — before the `<!-- anglesite:comments -->` anchor, so build-time
  interactions precede any injected giscus widget.
- `Hentry.astro`, `Hevent.astro`, `Hreview.astro` — after `SyndicationLinks`.

No existing classes or anchors change (several Swift suites string-match them).

## Testing

- `src/lib/interactions.test.ts` (node:test + `assert/strict`, run via
  `npx tsx --test`): valid parse round-trip, malformed file skipped with warning,
  unverified/pending skipped, target matching incl. trailing-slash variants and
  non-matching targets, grouping and comment sort order, empty input.
- Swift render smoke test (`PersonalTypeRenderSmokeTests` style): scaffold a site, write a
  fixture reply JSON targeting a post, build, assert the built post HTML contains the
  `h-cite` markup and the reply content — #362's render acceptance ("a received reply
  renders under the post") minus the git-commit half.
- Full required suites before PR: template `npm run test:worker` + `npm run build`,
  `swift test` (template-markup coupling), JS overlay untouched.

## Known interactions

- **Pre-deploy PII scanner:** rendered third-party comments can contain emails/phones and
  will flag in `pre-deploy-check.ts`. Working as designed — the gate surfaces it;
  moderation is deleting the snapshot file. No gate changes.
- **CMS loader:** interactions are not CMS content; they deliberately bypass
  `collectionLoader()` / `CMS_CONTENT_API_URL` and always come from local files.
