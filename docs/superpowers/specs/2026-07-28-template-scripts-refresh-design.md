# Refreshing a site's `scripts/` after scaffold

**Date:** 2026-07-28
**Status:** Approved — ready for an implementation plan
**Issue:** [#1053 — Refresh a site's template files after scaffold — stale scripts/ never update](https://github.com/Anglesite/Anglesite-app/issues/1053)

## Problem

`Resources/Template/` is copied into a site **once**, at scaffold time (`scripts/scaffold.sh`'s
single `rsync -a`), and nothing ever refreshes it afterward. Every change to the template
therefore reaches new sites only — existing sites keep whatever they were born with, indefinitely.

This matters most for `scripts/`, which is app-owned build and security machinery rather than
user content:

- `PreDeployCheck` runs the **site's own** copy of `scripts/pre-deploy-check.ts` before every
  deploy. A site scaffolded a year ago runs a year-old security gate and gains none of the checks
  added since — the gate can't be *bypassed*, but it can silently be *outdated*, which reaches the
  same place more slowly. (`PreDeployCheck.swift:169`'s "is the site's `scripts/pre-deploy-check.ts`
  up to date?" is the only existing acknowledgement that this failure mode is real.)
- Features can silently no-op. #991 (PR #1036) moved the AI-crawler signals from `.site-config`
  into `src/data/licensing.json`'s `usage` block and rewrote `scripts/edge-artifacts.ts` to read
  the new shape. A pre-#991 site's old `edge-artifacts.ts` still reads the retired `.site-config`
  keys, so the new Website Settings ▸ Licensing facet writes a block its build never reads — a
  settings control that appears to work and does nothing. Verified on an existing local site: zero
  occurrences of `readLicensingUsage` in its `scripts/edge-artifacts.ts`.
- It generalizes: the same shape applies to every future `scripts/` change, quietly splitting the
  installed base into "sites that have it" and "sites that don't," with no signal to the owner and
  no way for us to tell which is which.

## Guiding principle

From the issue discussion: **the app advises; it does not delegate the decision.** Anglesite's
users are not people who will adjudicate a three-way merge or a conflict marker — they came here to
publish a website. `scripts/` is app-owned in practice (a site owner did not write
`pre-deploy-check.ts` and has no reason to be consulted about whether it should be current), so it
refreshes on the app's terms by default. The one place a question is warranted is when the app
*can't* safely apply its own answer — an owner has edited a `scripts/` file and the template moved
on past it — and even then the question is phrased about consequences to their site, not about git
or file diffs.

`src/` (layouts, components, pages) is genuinely user-owned content and is **out of scope** here —
it needs its own answer in a future issue.

## Scope: what counts as "`scripts/`"

Exactly the file set `scaffold.sh`'s `rsync` actually lands in a scaffolded site today: everything
under `Resources/Template/scripts/` **except** `scripts/scaffold.sh`, `scripts/themes.ts`,
`scripts/themes.json`, and `*.test.ts` files directly inside `scripts/` (scaffold's existing
exclude list, `Resources/Template/scripts/scaffold.sh:40-46`).

This set is computed by walking the template's `scripts/` tree in Swift — a new
`TemplateScriptsManifest.appOwnedRelativePaths(templateRoot:)` helper owns the exclude list as a
single source of truth for the refresh mechanism. It does not re-parse or replace `scaffold.sh`'s
own rsync excludes; the two lists are intentionally kept in the same shape (documentation by
duplication is how this already works between `scaffold.sh` and everything else that references
template paths, e.g. `TemplateRuntime.swift`, `ThemeCatalog.swift`).

**Known non-goal, called out rather than silently inherited:** `scripts/*.test.ts` only matches
direct children of `scripts/` in rsync's pattern syntax (a pattern containing a slash is anchored
to the transfer root), so `scripts/embeds/*.test.ts` and `scripts/embeds/fixtures/*` are *not*
actually excluded by the current `scaffold.sh` and do land in scaffolded sites today. This design
treats "whatever `scaffold.sh` copies today" as ground truth and keeps refreshing it as a unit,
quirk included, rather than fixing the anchoring bug as a side effect of this issue. A follow-up
can tighten the rsync exclude separately.

## Data model: `Config/template-scripts-baseline.json`

A new `TemplateScriptsBaseline` type, JSON-backed in `Config/` (app-owned, never in the site's git
repo — same placement rationale as `Config/dependency-baseline.json`), one entry per app-owned
relative path:

```json
{
  "files": {
    "scripts/pre-deploy-check.ts": {
      "baselineHash": "sha256:<hash of the template content this file was last synced from>",
      "acknowledgedTemplateHash": "sha256:<hash the owner explicitly chose to skip, if any>"
    }
  }
}
```

`baselineHash` is what the site's file looked like the last time this mechanism successfully
reconciled it (either at scaffold time, retroactively backfilled, or after a refresh/acknowledged
divergence). `acknowledgedTemplateHash` is only present after an owner picks "keep my version" for
a divergent file — it records *which* template version they declined, so the prompt doesn't
re-fire until the template file changes again past that point.

This is a **separate mechanism from `Config/dependency-baseline.json` and does not share the
`.site-config` `ANGLESITE_VERSION` stamp** that gates `DependencySyncChecker`'s fast path. Reusing
that stamp would be unsafe here: accepting a dependency-update offer bumps `ANGLESITE_VERSION` to
the running app version even on a site whose `scripts/` files were never inspected: a second
mechanism gated on the same stamp would then believe it's already reconciled and skip forever.
Keeping the two baselines independent avoids that coupling entirely.

## Detection: `TemplateScriptsSyncChecker`

Pure, static, non-throwing — same shape as `DependencySyncChecker.check`. For each app-owned
relative path (`templateHash` = hash of the template's current content, `siteHash` = hash of the
site's current content if the file exists, `baseline` = the recorded entry if any):

1. **Site doesn't have the file** (template added a new script since this site scaffolded) →
   queue a silent **create**. No prompt — pure addition, nothing of the owner's to lose.
2. **`templateHash == siteHash`** → nothing to do. If the baseline entry is missing or stale,
   backfill it as housekeeping (no file write, `Config/`-only).
3. **No baseline entry recorded yet** (every pre-existing site, the day this ships) → initialize
   `baselineHash = siteHash` as part of this same check. This makes "first encounter" always read
   as *unmodified relative to itself* in step 4 below, so a legacy site's current file — which may
   be stale but was never hand-edited — silently refreshes to the template on this one-time
   backfill pass. This is the behavior that fixes the `edge-artifacts.ts`/`BLOCK_AI` case described
   in Problem above.

   **Explicit trade-off:** a legacy site that genuinely *did* hand-edit a `scripts/` file has that
   edit silently overwritten the first time this mechanism runs against it, because there is no
   way to distinguish "stale" from "customized" without a prior baseline. It is git-recoverable
   (`Source/` is guaranteed to be a git repo per `AnglesitePackage`), and the issue's own notes
   accept this: "pre-1.0, the affected population is small — probably just local test sites."
   Documented here rather than assumed silently.
4. **`baselineHash == siteHash` but `templateHash` differs** → unmodified since last sync, and the
   template moved on → queue a silent **refresh**; the applier bumps `baselineHash` to the new
   `templateHash`.
5. **`baselineHash != siteHash`** (the owner edited it) **and `templateHash` differs from both** →
   genuine divergence.
   - If `acknowledgedTemplateHash == templateHash`: already asked and answered for this exact
     template version — skip silently.
   - Otherwise: queue for the divergence prompt (§Divergence UX).

**Note on checker purity:** unlike `DependencySyncChecker` (which never writes anything —
`DependencySyncApplier` owns every write), `TemplateScriptsSyncChecker` performs the `Config/`-only
baseline bookkeeping in steps 2 and 3 itself (backfilling a missing entry, initializing a
first-encounter baseline) rather than returning it as a queued action. That bookkeeping never
touches the site's own `Source/` files and needs no owner consent, so folding it into the checker
avoids inventing a third no-op "action" kind purely to satisfy a purity convention that doesn't
otherwise buy anything here. `TemplateScriptsSyncApplier` remains the only thing that ever writes
under `Source/scripts/`, matching the create/refresh/divergence queue exactly.

## Apply: `TemplateScriptsSyncApplier`

Writes template content verbatim over the site's file (or creates it for new files), then updates
the baseline entry for that path. Never touches `package.json`, the lockfile, or
`.site-config`/`ANGLESITE_VERSION` — this mechanism is scoped entirely to `scripts/` file content
and its own baseline file.

## Divergence UX

A single sheet, shown only when the queue from detection step 5 is non-empty — most site opens
produce an empty queue and no UI appears at all. One row per divergent file, framed in
consequences rather than git/diff terms, e.g. for `pre-deploy-check.ts`:

> "This site's security check has been customized. An update is available with checks it doesn't
> include yet."

with two actions per row:

- **Update this file** — overwrites the owner's version with the template's (git-recoverable, per
  the issue discussion's resolution that `Source/` being a real git repo is sufficient recovery —
  no extra sibling backup file).
- **Keep my version** — leaves the file untouched, records `acknowledgedTemplateHash` so the same
  divergence isn't re-asked until the template changes again.

A new presentation-layer `ScriptSyncModel` (in `AnglesiteApp`) mirrors `DependencyUpdateModel`'s
shape — holds the queued items and a completion continuation the caller awaits.

## Wiring

Runs from the same place `DependencySyncChecker` runs today — `SiteWindowModel.loadAndStart()` —
guarded the same way (`TemplateRuntime.bundledURL()` and `AppVersion.current()` both present), as
an independent step:

1. Silent creates/refreshes (detection steps 1 and 4) are applied immediately, unconditionally, no
   UI.
2. If step 5 queued any divergences, show the sheet and await the response the same way the
   existing dependency-offer sheet is awaited, sequenced after it (dependency sheet, if any, then
   script-divergence sheet, if any) rather than merged into one combined UI — the two mechanisms
   have different accept semantics (dependency offers are opt-in bumps for everything queued;
   script refreshes are already-applied-by-default with only the exceptions surfaced).

## Non-goals / explicitly deferred

- `src/` (layouts, components, pages, content) — a separate question per the issue; not touched by
  this design.
- A pre-deploy warning for the one residual case where an owner picked "keep my version" on
  `pre-deploy-check.ts` itself specifically (their security gate stays intentionally outdated by
  their own choice) — worth a follow-up issue, not bundled into this one. Per the issue discussion,
  if `scripts/` is otherwise always current, the previously-floated "stale-gate warning" backstop
  becomes unnecessary for every case except this one.
- Fixing the `scripts/*.test.ts` rsync anchoring quirk in `scaffold.sh` (§Scope).
- Documenting "the app advises; it does not delegate" as a standing principle in
  `AGENTS.md`/`CLAUDE.md` (the issue discussion calls this out as broader than #1053 and worth
  capturing there) — a small, low-risk documentation addition alongside this PR's code, not a
  design decision in its own right.

## Testing

Follows `DependencySyncChecker`/`Applier`'s existing test pattern: temp-dir black-box tests, no
mocking, asserting on resulting file/JSON contents.

- `Tests/AnglesiteCoreTests/TemplateScriptsSyncCheckerTests.swift` — new file appears (silent
  create), unmodified site file with template drift (silent refresh queued), legacy site with no
  baseline (backfill-and-refresh-once behavior from step 3), genuine divergence (queued for
  prompt), already-acknowledged divergence at the same template hash (skipped), divergence at a
  *new* template hash after a prior acknowledgement (re-queued).
- `Tests/AnglesiteCoreTests/TemplateScriptsSyncApplierTests.swift` — writes template content over
  site file, creates missing file, updates baseline entry, records `acknowledgedTemplateHash` on
  "keep my version".
- A `SiteWindowModel`-level wiring test for the new hook, since the survey found no existing
  dedicated test for the analogous `DependencySyncChecker` call site either — this design adds one
  rather than leaving both hooks untested at that layer.
