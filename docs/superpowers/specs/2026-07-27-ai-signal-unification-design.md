# Unifying the AI-crawler signals into the content licensing model

**Date:** 2026-07-27
**Status:** Approved — ready for an implementation plan
**Issue:** [#991 — Unify the three AI-crawler signals into the content licensing model](https://github.com/Anglesite/Anglesite-app/issues/991)
**Phase:** 2 of the [Really Simple Licensing spike](2026-07-26-really-simple-licensing-spike.md) §Phasing. Phase 1 shipped in [#981](https://github.com/Anglesite/Anglesite-app/pull/981) (`652724c9`).

## Problem

A site expresses intent about AI crawlers in three independently-editable places, and nothing
stops them contradicting each other:

| Signal | Emitted as | Nature | Stored in |
|---|---|---|---|
| `BLOCK_AI` | `Disallow: /` for 17 named agents in `robots.txt` | access control, unconditional | `.site-config` |
| `CONTENT_SIGNALS` | `Content-Signal: search=…, ai-input=…, ai-train=…` | preference, unconditional | `.site-config` |
| `licensing.json` | schema.org `license`, mf2 `u-license`, `rel="license"` | **conditional** — "you may, *if* you attribute" | `src/data/licensing.json` |

Checking boxes in today's Crawlers facet produces incoherent sites: `BLOCK_AI=true` emits
`Disallow: /` for GPTBot while the licensing policy grants attribution-based reuse, and
`Content-Signal: ai-train=no` disagrees outright with a permissive content license. Phase 3 would
advertise both from the same `robots.txt`.

This phase makes the first two **derived projections** of one policy, so the contradiction between
them is unrepresentable rather than merely discouraged.

## Model

`licensing.json` gains a site-wide `usage` block beside phase 1's `default` and `collections`:

```json
{
  "default": { "url": "https://creativecommons.org/licenses/by/4.0/", "name": "CC BY 4.0" },
  "collections": { "photos": null },
  "usage": { "search": "yes", "aiInput": "no", "aiTrain": "no", "blockAICrawlers": true }
}
```

Each purpose is `"yes"`, `"no"`, or absent (unspecified). `blockAICrawlers` is the enforcement
toggle described below.

Usage is **site-wide**, not per-collection. `robots.txt` addresses the whole origin: a
`Content-Signal` directive is scoped to a `User-agent` group, not a path, and the blocklist is a
whole-site `Disallow: /`. Per-collection usage would be unprojectable today. Phase 3's RSL
`<content url>` patterns are the first thing that could express it, and the block sits inside the
same document, so adding a per-collection layer later needs no second move.

### Normalization clamps rather than trusts

`normalizeUsage` extends phase 1's `normalizePolicy` convention — unrecognized keys and values are
dropped rather than passed through, matching how `normalizeContentSignal` already treats a typo'd
config value. It also enforces one cross-field rule:

> `blockAICrawlers: true` survives only when `aiInput` **and** `aiTrain` are both `"no"`.
> Otherwise it is forced to `false` and the build logs a note.

That is what makes "permits AI training but `Disallow`s GPTBot" unrepresentable in a hand-edited
file, not only in the UI. Both the TypeScript resolver and the Swift store apply the same clamp,
so neither writer can produce a document the other would reject.

### Two derived projections

`scripts/edge-artifacts.ts` reads `src/data/licensing.json` instead of the two `.site-config` keys:

| Projection | Rule |
|---|---|
| `Content-Signal: search=…, ai-input=…, ai-train=…` | One `key=value` pair per specified purpose, in that order. Unspecified purposes are omitted; the directive is omitted entirely when all three are. Byte-identical to today's output for the same intent. |
| `Disallow: /` for the 17 named agents | Emitted when `blockAICrawlers` is true. The agent list is unchanged (`aiCrawlers` in `edge-artifacts.ts`, maintained from darkvisitors.com). |

`search=no` still never blocks a traditional search engine. It is a preference directive; the
blocklist names AI agents only, as it does today.

### Why enforcement stays a toggle

Blocking is *stronger* than signalling, not contradictory: a site can coherently say "please don't
train on this" without also refusing the crawler at `robots.txt`, and that stance is a real one —
the 17-agent list mixes training crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended) with
live-answer agents (ChatGPT-User, PerplexityBot), so a blanket `Disallow` also costs the site its
presence in AI-assistant citations.

The constraint that matters is that the blocklist never exceed what the permissions deny. Gating
the toggle on `aiInput = aiTrain = "no"` enforces exactly that while preserving the signal-only
stance. Two alternatives were considered and rejected:

- **Fully derived, no toggle** — denial always blocks. Removes the signal-only stance, and would
  need a per-agent purpose taxonomy that is genuinely ambiguous for several entries (Bytespider,
  Amazonbot) and that Anglesite would then have to maintain.
- **Per-purpose blocklist plus toggle** — the same taxonomy with the gate on top. Most precise,
  but two concepts for the user to hold and the taxonomy's maintenance cost stands.

## License ↔ usage coherence

The licensing policy is *conditional*; usage permissions are *unconditional*. Relating them means
reading license semantics, and the spike's §Q3 rule — Anglesite never asserts on the user's behalf
— bounds how far that can go. The relationship is therefore deliberately narrow:

- A small catalog classifies **CC0 1.0, CC BY 4.0, and CC BY-SA 4.0** as unambiguously permitting
  AI use. NC and ND variants, custom URLs, and all-rights-reserved are **not** classified — whether
  training is a "derivative" or "commercial" is a live legal question this app does not answer.
- **Pre-fill:** choosing a classified license fills only the purposes still *unspecified*, and
  never overwrites a value the user already set.
- **Warning:** a classified license paired with `aiTrain: "no"` or `aiInput: "no"` shows an inline
  note in the facet — the license already grants what the signal asks crawlers not to do. It is
  informational, not blocking: the stance is legitimate if odd, and the license is the binding half.
- Permitting *more* than an NC license requires is never flagged. It is the user's own content.

## Clean break

There is no migration. Anglesite has not shipped 1.0, so `BLOCK_AI` and `CONTENT_SIGNALS` are
deleted outright — from `scripts/scaffold.sh`'s documented keys, from `edge-artifacts.ts`, from
`CrawlerPolicyAsset.swift` (the file is removed), and from their tests. No fallback read, no
dual-source path, no stale keys that silently still work.

A site whose `.site-config` still carries the keys keeps building; the keys are simply inert, and
its `robots.txt` reverts to the default allow-all until the owner sets a policy in the new facet.
This is a behavior change to shipped settings and belongs in the PR body.

## Components

### Template (TypeScript)

| Unit | Responsibility |
|---|---|
| `src/lib/licensing.ts` | Gains the `AIUsage` type, `normalizeUsage` (including the clamp), and `usage` on `LicensingPolicy`. Stays the pure model — no robots.txt knowledge. |
| `scripts/edge-artifacts.ts` | Gains the two projections and reads `src/data/licensing.json` via `readFileSync` + `normalizePolicy`. `buildRobotsTxt` takes a `usage` argument in place of `blockAI`/`contentSignal`. `normalizeContentSignal` goes: its job was parsing a flat `KEY=value` string, which `normalizeUsage` now subsumes; rendering the directive from a normalized `AIUsage` becomes a small local helper. |

Splitting this way keeps each file's purpose intact: the *model* (parse, normalize, clamp) belongs
to `licensing.ts`; the *robots.txt rendering* belongs to the generator. `scripts/` importing
`src/lib/` has precedent in `remark-embeds.ts`.

### App (Swift)

| Unit | Responsibility |
|---|---|
| `AnglesiteCore/LicensingStore.swift` *(new)* | Reads/writes `Source/src/data/licensing.json` on the `RedirectsStore` pattern. Hand-written Codable for `collections` so the absent-key (inherit) vs explicit-null (assert nothing) distinction round-trips — load-bearing in `resolveLicense`, and blurred by Swift's default dictionary coding. Applies the same clamp as the TS side. Unrecognized keys are dropped on save, as `CrawlerPolicyAsset` already did to unknown `CONTENT_SIGNALS` sub-keys. |
| `AnglesiteCore/LicenseCatalog.swift` *(new)* | The curated license list, the `permitsAIUse` classification, the pre-fill and warning rules, and a Swift mirror of `hasSafeLicenseScheme` so the write path cannot store a `javascript:` URL that phase 1 would only have rejected at render time. Pure and portable — covered by the Linux lane. |
| `AnglesiteCore/CrawlerPolicyAsset.swift` | Deleted. |
| `AnglesiteApp/ContentLicensingTab.swift` *(new)* | The facet body, extracted rather than grown into the 817-line `PlistEditorView`. Precedent: `AddRedirectSheet.swift` and the component-editor panes. |
| `AnglesiteApp/PlistEditorView.swift` | `SettingsTab.crawlers` → `.licensing`, labeled "Licensing" ("Content Licensing" does not fit seven segments). `crawlersTab` and `contentSignalRow` move out. |
| `AnglesiteApp/PlistEditorModel.swift` | The four `crawlerPolicy*` properties become `licensing*`, plus a `licensingLoadFailed` guard. Dirty-facet registration, tab-switch autosave, and `saveAll` follow. |

The curated catalog: All rights reserved (no license), CC0 1.0, CC BY 4.0, CC BY-SA 4.0,
CC BY-NC 4.0, CC BY-ND 4.0, CC BY-NC-SA 4.0, CC BY-NC-ND 4.0, and Custom URL.

`licensingLoadFailed` mirrors `redirectsLoadFailed`: unlike `.site-config` keys, `licensing.json`
is hand-authored, so a parse failure must block the save rather than let it overwrite per-collection
rules the app could not read.

### Facet layout

Three sections in `ContentLicensingTab`:

1. **Site default license** — a picker over the catalog, plus a URL field when Custom is chosen,
   validated against the scheme guard.
2. **Per collection** — 11 rows (`notes`, `articles`, `photos`, `albums`, `bookmarks`, `replies`,
   `likes`, `announcements`, `events`, `reviews`, `blog`), each *Use site default* / *Assert
   nothing* / a catalog license. The four non-asserting collections label their inherit state
   "Asserts nothing by default", making phase 1's invisible rule visible.
3. **AI usage** — the three existing purpose pickers (Unspecified / Allow / Disallow), plus the
   gated "Refuse these crawlers in robots.txt" toggle, disabled with an explanatory help string
   until both AI purposes are Disallow. The coherence note renders here.

## Data flow

```
        ContentLicensingTab  ──writes──▶  LicensingStore ──▶ Source/src/data/licensing.json
                 ▲                            (clamp)                    │
                 └──────reads───────────────────┘                        │
                                                                         ▼
                                                          licensing.ts · normalizePolicy
                                                                    (clamp)
                                                                         │
                            ┌────────────────┬───────────────┬───────────┴─────────┐
                            ▼                ▼               ▼                     ▼
                     schema.org        mf2 u-license   <link rel="license">   edge-artifacts.ts
                      `license`         (layouts)        (BaseLayout)                │
                                                                     ┌───────────────┴─────────┐
                                                                     ▼                         ▼
                                                              Content-Signal            17-agent
                                                               directive                Disallow
```

## Error handling

- **Malformed `licensing.json`** — the TS reader falls back to the empty policy (assert nothing,
  no usage), matching phase 1's behavior when the file is absent. The Swift store surfaces the
  parse error in the facet and sets `licensingLoadFailed`, refusing to save over it.
- **Clamped `blockAICrawlers`** — `normalizeUsage` stays a pure value function, so the note is
  emitted by `edge-artifacts.ts`'s `main()`, which compares the raw `blockAICrawlers` value against
  the normalized one and logs when they differ. A hand-editor learns why their toggle did not take
  effect, in the same build-log style as `planMTAStsPolicy`'s notes.
- **Unsafe license URL** — rejected at write time by `LicenseCatalog`'s scheme guard with an inline
  message, and again at read time by phase 1's `toLicenseRef`.
- **Save failure** — the existing per-facet error label, as for redirects.

## Testing

| Suite | Coverage |
|---|---|
| `src/lib/licensing.test.ts` | `normalizeUsage`: unknown keys/values dropped, absent vs `"no"`, and the `blockAICrawlers` clamp in each of its three failing combinations. |
| `scripts/edge-artifacts.test.ts` | Reshaped `buildRobotsTxt`: directive omitted when no purpose is set, pair order, blocklist gated on the toggle, clamp note, and the existing `Sitemap:` record-separation behavior still holding. |
| `Tests/AnglesiteCoreTests/LicensingStoreTests.swift` *(new)* | Round-trip; absent key vs explicit null preserved; malformed file throws; unsafe URL rejected; clamp applied on save. |
| `Tests/AnglesiteCoreTests/LicenseCatalogTests.swift` *(new)* | Classification; pre-fill touches only unspecified purposes; warning fires only for a classified license against a denial. |
| `Tests/AnglesiteAppTests/PlistEditorModelLicensingTests.swift` | Replaces `PlistEditorModelCrawlerPolicyTests`: load, dirty tracking, save, the load-failed save guard. |
| `Tests/AnglesiteAppTests/PlistEditorModelDirtyFacetsTests.swift` | Updated for the renamed facet. |
| `Tests/AnglesiteCoreTests/SiteScaffolderTests.swift` | `BLOCK_AI` assertion removed. |
| `Tests/AnglesiteCoreTests/CrawlerPolicyAssetTests.swift` | Deleted. |

Full runs before the PR: `swift test`, the Debug app build, the template's `node:test` suites, and
an `xcstringstool sync` for the new UI strings per `CONTRIBUTING.md`.

## Documentation

- `Resources/Template/README.md` — document `usage` in the licensing section phase 1 added.
- `scripts/scaffold.sh` — remove the `BLOCK_AI` / `CONTENT_SIGNALS` key comments.
- [The spike spec](2026-07-26-really-simple-licensing-spike.md) — mark phase 2 shipped.
- The PR body carries the behavior-change note; the repo has no changelog file.

## Out of scope

- **RSL itself** — phase 3. This design only leaves room for it: `usage` is the block its
  `<permits>`/`<prohibits>` will project from, and `licensing.json` is where its per-path patterns
  would live.
- **Per-collection usage permissions** — unprojectable until RSL exists (see Model).
- **Copyright holder and contact** — the spike lists them on the policy, but they are site-identity
  scalars that belong in `.site-config`, and nothing in phase 2 projects them. Phase 3's
  `<copyright>` element is their first consumer.
- **`pre-deploy-check.ts` conformance rules** — the clamp makes the contradiction unrepresentable
  at build time, so there is nothing left for the gate to catch.
