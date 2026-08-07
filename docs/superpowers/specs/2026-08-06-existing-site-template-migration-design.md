# Existing sites: versioned, conflict-safe template file migrations

**Date:** 2026-08-06
**Status:** Approved — ready for an implementation plan
**Issue:** [#745 — Existing sites: versioned, conflict-safe template file migrations](https://github.com/Anglesite/Anglesite/issues/745)

## Problem

`Resources/Template/` is copied into a site once, at scaffold time. #1053 (`TemplateScriptsSync`)
already keeps a site's `scripts/` files current after that — but it optimizes for the common case
(the app knows the right answer, apply it) and explicitly punts on three things that matter for
*existing* sites specifically:

- A site never opened since #1053 shipped has no recorded baseline. On first encounter,
  `TemplateScriptsSyncChecker` today *assumes* the site's current content is untouched and
  silently refreshes it to the template's — a documented, deliberate pre-1.0 risk ("the affected
  population is small"). This issue closes that gap: a legacy file that turns out to be hand-edited
  must never be silently overwritten, even on first encounter.
- `SECURITY_TXT_MODE` (#743) has never been written for a site scaffolded before it existed. Every
  such site runs on `resolveSecurityTxtMode`'s implicit inference forever, and its
  `public/.well-known/security.txt` — if hand-authored before the marker/ownership system existed —
  has no way to be classified as generated-vs-manual. `edge-artifacts.ts:172`'s own comment names
  this issue by number as the owner of that backfill.
- `.gitignore` has no update path for an existing site at all; template lines added after a site's
  scaffold (e.g. `public/.well-known/security.txt`) never reach it.

## Relationship to `TemplateScriptsSync` (#1053) and `DependencySync`

This is **not** a third, independent mechanism. It extends `TemplateScriptsSync`'s existing
baseline/checker/applier plumbing (`TemplateScriptsBaseline`, `TemplateScriptsSyncChecker`,
`TemplateScriptsSyncApplier`) with the specific gaps above, and adds two capabilities neither prior
mechanism has: a `.gitignore` migration step, and committing successful `Source/` changes to git.
`DependencySync` (`package.json` only) is untouched — this issue does not extend it, per its own
scope note.

The one deliberate behavior change to already-shipped code: **a `scripts/` file with no recorded
baseline that doesn't match the template is no longer silently refreshed.** This directly reverses
#1053's documented "assume untouched" trade-off, on purpose. Because #1053 already runs on every
site-open, the true never-baselined population is small and shrinking by the time this ships — a
one-time classification (prompt, or a Preserve default in noninteractive flows) is proportionate.
No historical-hash-across-releases registry is needed to make this safe; see "Data model" below for
why.

## Scope: the four migration kinds

1. **App-owned script files** (`edge-artifacts.ts`, `csp.ts`, `pre-deploy-check.ts`, everything
   `TemplateScriptsManifest.appOwnedRelativePaths` already enumerates) — reuses #1053's
   checker/applier unchanged, except for the legacy-classification fix above.
2. **`SECURITY_TXT_MODE` backfill + legacy `security.txt` classification** — new: a config-key
   write plus a generated-artifact ownership decision, neither of which #1053 handles (it only
   syncs script *source*, not generated output or `.site-config` keys).
3. **`.gitignore` migration** — new, but reuses `SiteActions.ensureImportGitignore`'s exact
   additive-only pattern (presence-checked by line, header comment, never rewrites unrelated
   content), coupled to the security.txt classification (see below).
4. **Git commit + runtime refresh of the above** — new integration point. Neither `DependencySync`
   nor `TemplateScriptsSync` commits anything today; both leave `Source/` changes in the working
   tree.

`src/` (user content) and the pre-deploy *envelope* version (#742's `ScanReport.version`, which has
no migration path by design — a version mismatch is a hard "update the app" error, not migratable
state) are out of scope, matching #1053's own boundary.

## Data model

No new historical-hash registry. Two small additions:

**`Config/existing-site-migration-pending-commit.json`** — a durable list of relative paths this
mechanism wrote but hasn't yet confirmed committed. App-owned, `Config/`-only (never in `Source/`),
same placement rationale as `Config/dependency-baseline.json` and
`Config/template-scripts-baseline.json`. This is the only piece of new state needed for
resumability — see "Apply" below for why a bigger transaction log isn't warranted.

```json
{ "pendingPaths": ["scripts/edge-artifacts.ts", ".gitignore", ".site-config"] }
```

**No new state for `SECURITY_TXT_MODE`.** The key's own presence in `.site-config` (git-tracked,
in `Source/`, read by `resolveSecurityTxtMode`) *is* the "already migrated" marker — re-running the
checker is a no-op once the key exists. Reusing the artifact that already carries the decision,
rather than a second `Config/`-side record of it, avoids the two ever disagreeing.

**Existing `TemplateScriptsBaseline`/`TemplateScriptsDivergence` types are reused as-is** for
script files, including the newly-legacy-unclassified case — no new "kind" of divergence, just a
different path into the same queue (see Detection below).

## Detection

### Script files (extends `TemplateScriptsSyncChecker`)

Steps 1, 2, 4, 5 of the existing detection algorithm (design doc `2026-07-28-template-scripts-
refresh-design.md`) are unchanged. **Step 3 changes:**

- **Before:** no baseline recorded → assume the site's current content is untouched → set
  `baselineHash = siteHash` → immediately matches step 4's "unmodified since baseline" condition →
  silent refresh, same pass.
- **After:** no baseline recorded → still record a provisional `baselineHash = siteHash` (so
  `resolve()` has an entry to update, preserving the checker's existing invariant that "a baseline
  entry always exists before a divergence is queued") but do **not** treat it as reconciled. Queue
  it into `divergences` alongside genuinely-hand-edited files. The owner (or, noninteractively, the
  Preserve default) decides exactly as they would for a real hand-edit.

Byte-identical-to-template files are unaffected either way — they never enter step 3.

### `security.txt` (new: `SecurityTxtModeMigration`)

Runs once per site, gated on `SECURITY_TXT_MODE` being absent from `.site-config` (idempotency
marker, see Data model). Given the current on-disk `public/.well-known/security.txt` (if any),
current `SECURITY_CONTACT`, and current `SITE_URL`:

1. **No file, no contact configured** → nothing to migrate; leave `SECURITY_TXT_MODE` unset (the
   existing inference already resolves this correctly and there's nothing to adopt or preserve).
2. **File exists and is already marker-owned** (`isSecurityTxtMarkerOwned`) → the site already ran
   under #743's model somehow without the key being set explicitly (e.g. manually deleted) — just
   backfill `SECURITY_TXT_MODE=generated`. No content change, no classification needed.
3. **File exists, not marker-owned** → classify against the *pre-#743* generator's exact output
   shape, reconstructed from `edge-artifacts.ts` as of commit `71301584^`:
   ```
   Contact: {single contact URI}
   Expires: {one year out, UTC midnight}
   Canonical: {SITE_URL, or the literal fallback "https://example.com" if unset}/.well-known/security.txt
   ```
   Compute what that old generator would emit from the site's **current** `SECURITY_CONTACT`
   (first usable contact only — the old format never supported a list) and `SITE_URL`. Compare the
   `Contact:` and `Canonical:` lines exactly; `Expires:` is inherently time-variant, so only its
   presence and ISO-8601 shape are checked, not its value.
   - **Exact match** → **adopt silently, no decision asked**: this is positively Anglesite's own
     historical output, the same "app knows the right answer" situation as an unmodified `scripts/`
     file refreshing without a prompt (§Script files above) — asking would contradict the "app
     advises, doesn't delegate" principle for a case it can already resolve on its own.
   - **Any mismatch** (different contact, extra/missing lines, hand-formatting, or no file at all
     with a contact configured elsewhere) → genuine ambiguity: an **Adopt/Preserve decision**,
     interactively, or defaulted to **Preserve** in a noninteractive flow. Adopt remains available
     as an explicit owner override even though the app couldn't confirm the match itself.
4. **No file, contact configured** → nothing to classify (no legacy content exists); backfill
   `SECURITY_TXT_MODE` from the existing inference (`generated`, since a contact is present) so the
   site stops depending on `resolveSecurityTxtMode`'s fallback going forward.

Only case 3's mismatch outcome ever asks — every other outcome (cases 1, 2, 4, and case 3's exact
match) is unambiguous and applies silently, consistent with `TemplateScriptsSync`'s "advises,
doesn't delegate" philosophy for anything the app can actually resolve on its own. This also closes
the loop with the issue's own acceptance criterion that an unmodified legacy site upgrades
automatically — an exact-match legacy `security.txt` is exactly that case.

### `.gitignore`

Purely a function of the security.txt outcome, not a separate detection pass:

- **Adopt** → ensure `public/.well-known/security.txt` is present in `.gitignore` (additive,
  `SiteActions.ensureImportGitignore`'s exact pattern — header comment, presence-checked by line,
  never touches unrelated content).
- **Preserve** → the file must become "normally git-trackable." If `.gitignore` already excludes
  it (e.g. inherited from an older template era where the line existed unconditionally), **remove
  that one line**. This is a deliberate, narrow exception to the additive-only rule used everywhere
  else in this design and in `SiteActions.ensureImportGitignore` — justified because "Preserve
  makes the file trackable" is false if it silently stays ignored. No other line is ever touched or
  removed.

## Apply

1. Silent-safe script actions (create/refresh, including a legacy file that turned out to match)
   apply immediately — unchanged from #1053.
2. The combined decision queue — script divergences (hand-edited or newly-unclassified-legacy) plus
   the security.txt Adopt/Preserve choice, when case 3 above applies — resolves either through one
   UI pass (interactive) or an automatic Preserve default (noninteractive; see "Noninteractive
   flows" below).
3. Each accepted write is verified as actually-landed before its provenance is recorded — re-read
   the file after writing and only mark it reconciled if the content matches what was intended,
   mirroring `DependencySyncApplier`'s "baseline only what lands" pattern (#1108) applied here to
   script/security.txt writes instead of `package.json`.
4. `.site-config`'s `SECURITY_TXT_MODE` is written via the existing `SiteConfigFile.upsert` helper
   (line-level, preserves unrelated content and ordering).
5. `.gitignore` is updated per the rule above.
6. The exact set of relative paths that changed this pass (a subset of `scripts/*`, `.site-config`,
   `.gitignore`, `public/.well-known/security.txt`) is written to
   `Config/existing-site-migration-pending-commit.json`, then committed in one call to the existing
   `InboxSubmissionCommitter.processGitCommitBatch(sourceDirectory, paths, message)` — the same
   primitive every other `*Committer` in `AnglesiteCore` uses to stage and commit a specific path
   set. On success, the pending-commit record is cleared.

### Resumability without a transaction log

Every file write is independently atomic (`.write(atomically: true)` / `.atomic` option, matching
every other applier in this codebase) and independently durable — a crash between two file writes
leaves the finished one reconciled and the unfinished one still detected as pending on the next
open, exactly like #1053 today. The one new risk window is between "all writes landed" and "commit
succeeded." `Config/existing-site-migration-pending-commit.json` closes exactly that window: every
site-open checks it first, before running the checker, and retries the commit for those exact paths
(verifying via git status that they're still actually dirty — if something else already committed
them, the list just clears). This is proportionate to the actual risk — a small idempotent retry
queue, not a general journal — and mirrors how #1053 itself achieves resumability by making each
step independently durable rather than wrapping the whole pass in a transaction.

### Partial failures

If a file write fails, it's skipped (existing per-file error handling in `TemplateScriptsSyncApplier`
already does this) and retried on the next pass — no different from today. If the **commit** fails
after successful writes, the migration is **not** rolled back: the files are genuinely and
correctly migrated, just uncommitted, which is recoverable (the same "`Source/` is a real git repo"
recovery story #1053 already relies on). It stays on the pending-commit list and is surfaced as a
finding (see below) rather than silently retried forever with no signal.

## Noninteractive flows

`SiteOperations.swift` (the headless App Intents/Shortcuts/Siri path) runs this migration too, not
just `SiteWindowModel.loadAndStart()` — today neither `DependencySync` nor `TemplateScriptsSync`
runs there at all, so a site only ever operated on via Shortcuts would never get migrated otherwise.

In this context there is no sheet to show. Every item in the decision queue defaults to **Preserve**
automatically: script divergences keep the owner's file untouched, and an unclassifiable
`security.txt` gets `SECURITY_TXT_MODE=manual` without being rewritten. Nothing is silently claimed
as Anglesite-owned. The result is surfaced as a finding on `SiteOperations`'s result type, following
the existing `.domainConfigDrift(findings)` precedent on `DeployCommand.Result` — a new case (or an
additional finding folded into that one, decided during implementation based on how tightly
"migration" and "domain drift" findings should be kept separate) reports which files have
unresolved ownership, so a Shortcuts-triggered deploy doesn't drop this silently.

## Runtime refresh

Both call sites already run this migration *before* starting the site's runtime
(`SiteWindowModel.loadAndStart()` calls it before `preview.open(site:)`; `SiteOperations` runs its
own operation-scoped runtime after its setup phase), so the common case needs no explicit restart —
the first boot simply picks up the migrated files. The one case that does need one: if
`PreviewModel.state == .ready` for this site already (e.g. a pending-commit retry firing while a
window is already open), call the existing `PreviewModel.restartDevServer()` after a successful
commit.

## UX

A separate, single-decision sheet mirroring `DependencyUpdateModel`'s shape (one whole decision,
not a per-row list) rather than folding into `ScriptSyncModel` — at most one `security.txt` exists
per site, so there's never a list to manage, and the two mechanisms already have different accept
semantics (script refreshes are already-applied-by-default with only genuine hand-edits surfaced;
this is a single yes/no). Sequenced after the script-sync sheet, shown only for case 3's mismatch
outcome (the exact-match outcome never reaches a sheet at all — it applies silently), framed in
consequences per the existing "advises, doesn't delegate" principle — e.g.:

> "This site publishes a security.txt Anglesite didn't generate. Adopt it so Anglesite keeps it
> current going forward, or leave it as yours to maintain."

with **Adopt** / **Preserve** actions, mirroring the script-divergence sheet's **Update this
file** / **Keep my version** pair.

## Non-goals / explicitly deferred

- `src/` — unchanged, still out of scope (per #1053).
- The pre-deploy envelope version (#742) — no migration path exists or is added; an unsupported
  version remains a hard "update the app" error by design.
- File removals/renames on the template side — #1053's existing known gap, not touched here.
- A historical-hash-across-every-release registry for script files — considered and rejected; the
  Preserve-by-default fallback for an unclassified legacy file is sufficient and far cheaper to
  build and maintain than a registry that every future template change would need to keep current.

## Testing

Follows the established black-box, temp-dir, no-mocking pattern shared by
`DependencySyncChecker/ApplierTests` and `TemplateScriptsSyncChecker/ApplierTests`.

- **Checker:** clean site (nothing to do), legacy file matching template (silent refresh, unchanged
  from today), legacy file *not* matching template (now a divergence, not a silent overwrite),
  already-baselined hand-edit (unchanged from #1053), `security.txt` matching the old shape exactly
  (Adopt), `security.txt` not matching (Preserve), no file/no contact (no-op), already marker-owned
  (mode backfill only).
- **Applier:** writes verified-landed before baselining (mirroring #1108's guard), `.site-config`
  upsert preserves unrelated keys, `.gitignore` add-on-Adopt and remove-on-Preserve (and leaves
  unrelated lines untouched in both directions).
- **Resumability:** interrupted after writes but before commit — pending-commit list retried and
  cleared on next run; re-running a fully-committed migration is a no-op.
- **Commit failure:** writes land, commit fails — files stay migrated, pending-commit entry
  persists, a finding is produced.
- **Noninteractive:** every queued decision defaults to Preserve with no prompt; a finding is
  produced naming the unresolved files.
