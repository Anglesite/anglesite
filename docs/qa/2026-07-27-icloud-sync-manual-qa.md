# iCloud Git Sync Manual QA Checklist

**Issue:** [#881](https://github.com/Anglesite/Anglesite/issues/881) — iCloud sync P5: app wiring, conflict UX, manual QA doc
**Epic:** [#876](https://github.com/Anglesite/Anglesite/issues/876)
**Design:** [`docs/superpowers/specs/2026-07-21-icloud-git-sync-design.md`](../superpowers/specs/2026-07-21-icloud-git-sync-design.md)
**Status:** **NOT YET RUN.** CI and `swift test` exercise `SyncEngine`, `SyncScheduler`, and
`SyncConflictResolver` against local fixtures and a faked `VersionStore` (real `NSFileVersion`
conflict versions can't be manufactured in CI). This checklist is the only coverage of the real
multi-Mac iCloud path and must be run by hand on real hardware before this feature is considered
release-ready.

## Purpose

Verify that a `.anglesite` package kept in iCloud Drive:

- Syncs its git history between two Macs on the same iCloud account via the single-file
  `Config/sync/source.bundle` artifact (never the live `.git`, which is excluded via `.nosync`).
- Reconciles true concurrent edits (not just sequential handoff) through the automatic merge path,
  and surfaces genuine textual conflicts through the non-blocking banner + resolution sheet rather
  than silently corrupting or losing anything.
- Recovers cleanly from offline edits, eviction ("Optimize Mac Storage"), and app backgrounding.
- Produces **zero** sync activity for a package that isn't in iCloud Drive at all.

## Preconditions

- Two Macs signed into the **same iCloud account**, both with iCloud Drive enabled and this app's
  container included in "Documents & Data" for iCloud Drive (Settings ▸ Apple ID ▸ iCloud ▸ iCloud
  Drive ▸ Apps Using iCloud Drive — enable this app if the toggle is available; MAS apps use their
  own iCloud container automatically once entitled).
- Both Macs running a build of this branch (or a release that includes #881), signed consistently
  enough that both can open the same `.anglesite` package.
- A test `.anglesite` package created in the default iCloud Drive save location, so
  `ICloudSyncEligibility.isEligible(package:)` is `true` on both Macs. Confirm eligibility
  indirectly: the sync status icon appears in the site window's toolbar at all (it renders nothing
  for a non-iCloud package).
- A stable network connection on at least the Mac performing each write, for the "offline edit"
  case use macOS's own airplane-mode-equivalent (Wi-Fi off) rather than pulling the physical cable,
  so iCloud's own resync behavior is exercised realistically.
- Patience: iCloud Drive propagation between two Macs is typically seconds but can occasionally
  take minutes; do not treat a slow-but-eventual sync as a failure unless noted otherwise below.

## How to observe sync state during this checklist

- **Toolbar icon** (`SiteToolbarItemID.sync`, `SyncStatusView`): a small cloud glyph in the site
  window's toolbar. Hover/click for the current status (`Not yet synced`, `Syncing…`, `Synced`,
  `Waiting for iCloud…`, `N files need attention`, or a failure reason).
- **Conflict banner**: a non-blocking orange bar at the top of the site window's content area,
  shown only while a `SyncConflict` is pending. It never blocks editing — you should be able to
  keep clicking around the site with the banner showing.
- **Debug pane** (⌥⌘D, or View ▸ Show Debug Pane if enabled): `sync:push`, `sync:pull`,
  `sync:bootstrap` log lines record every push/pull/bootstrap/merge this app performs, including
  the specific commit range and merged-tip sources — the fastest way to confirm *what actually
  happened* without guessing from UI state alone.
- **Finder**: `Foo.anglesite/Config/sync/source.bundle` is the single synced artifact; its iCloud
  status (cloud/checkmark/download badge in Finder, or "Right-click ▸ Get Info") reflects whether
  it's fully downloaded on this Mac. `Foo.anglesite/Config/repo.nosync/` never uploads — Finder
  should never show a cloud badge on it. `Foo.anglesite/Config/conflicts/` holds quarantined
  working-tree conflict copies, if any.

---

## 1. Sequential handoff

Baseline case: edit on Mac A, close, edit on Mac B — no true concurrency.

| Step | Action | Expected outcome |
|---|---|---|
| 1.1 | On Mac A, create a new site (or open an existing iCloud-hosted one) and make a content edit. | Toolbar sync icon shows `Syncing…` shortly after the edit auto-commits (via `BackupCommand`), then `Synced`. |
| 1.2 | Quit Anglesite on Mac A (or just close the site window). | No error; `source.bundle` exists in `Config/sync/` and has a recent modification time. |
| 1.3 | On Mac B, open the same site (via File ▸ Open Recent, or Finder double-click once the package has synced down). | The site opens with Mac A's edit already present — no manual pull step needed. Sync icon reads `Synced` (or briefly `Syncing…` → `Synced`) shortly after open. |
| 1.4 | Make a different content edit on Mac B, then reopen the site on Mac A (without touching it in between). | Mac A picks up Mac B's edit on open. No conflict banner — this is a clean fast-forward, not a merge. |

**Pass criteria:** every edit round-trips exactly once, no conflict ever appears, and Debug Pane
`sync:pull` lines show `fastForwarded`, never `merged` or `conflicted`, for this whole section.

## 2. Simultaneous edit (true concurrency)

The core scenario #881 is required to handle: both Macs editing *while online* at close to the same
time.

| Step | Action | Expected outcome |
|---|---|---|
| 2.1 | With the same site open in windows on **both** Macs simultaneously, edit **different pages** on each Mac within the same ~1 minute window. | Both Macs' edits auto-commit (`BackupCommand`) and push (debounced) independently. |
| 2.2 | Wait ~30s–2min for iCloud to propagate both writes, watching the sync icon on both Macs. | Both Macs eventually show `Synced` with **both** edits present — Debug Pane `sync:pull` shows a `merged` line (non-overlapping edits three-way-merge cleanly), never `conflicted`. No banner appears. |
| 2.3 | Now edit **the same page, same content region** on both Macs within the same window (a genuine textual collision — e.g. both retype the same paragraph differently). | Both writes push. On whichever Mac's `pull()` runs against the *other's* now-diverged history, the toolbar icon turns to `N files need attention` and the orange banner appears: "This site was edited on two Macs — N files need attention." |
| 2.4 | Confirm the banner does **not** block editing: keep navigating/editing other pages while it's showing. | All other editing works normally; only pushing *this branch* is paused (Debug Pane may show `sync:push` logging a pause, or simply no new `pushed` lines for this branch until resolved). |
| 2.5 | Click "Resolve…" on the banner (or the toolbar icon's popover). | The resolution sheet opens, listing the conflicted file(s) with a segmented "This Mac / Other Mac" picker per file and an "Open Both…" link. |
| 2.6 | Use "Open Both…" for the conflicted file. | Finder opens showing two files ("This Mac — …" / "Other Mac — …") with each side's actual content, for comparison. |
| 2.7 | Choose a side (This Mac or Other Mac) for every conflicted file, then click Apply. | The sheet closes with no error; the toolbar icon returns to `Syncing…` then `Synced`. Debug Pane shows a resolution merge commit and a subsequent successful push. |
| 2.8 | Open the site on the *other* Mac and pull (open the window, or wait for the next automatic pull). | The other Mac converges to the same resolved content — no repeat conflict, no banner. |

**Pass criteria:** the conflict is detected, never silently auto-resolved or rewound (both Macs'
edits are individually recoverable from git history even before resolving — spot check with
`git log --all --oneline` inside `Source/` if you have shell access to the live repo via a VS Code
window, since `/usr/bin/git` doesn't run inside the sandboxed app itself), and after resolving,
both Macs converge to the identical chosen content.

## 3. Offline edit + reconnect

| Step | Action | Expected outcome |
|---|---|---|
| 3.1 | On Mac A, turn off Wi-Fi (or otherwise fully disconnect from the network). | App keeps working normally — editing is fully local. |
| 3.2 | Make several edits while offline. Confirm auto-commits still happen (`BackupCommand` operates on the local repo, no network needed). | Sync icon shows `Syncing…` → (no network) it should settle on either `Synced` (if a prior push already reflected current state and there's nothing new to push, unlikely) or a failure/waiting state — note exactly what it shows; expected is that a push attempt either times out gracefully or the icon reflects "couldn't sync" without crashing or hanging the UI. |
| 3.3 | Meanwhile, edit the **same site** from Mac B (online) — a few different edits, ideally not overlapping Mac A's paths for this step (overlap is covered in §2). | Mac B syncs normally. |
| 3.4 | Reconnect Mac A's Wi-Fi. | Within a short window, the debounced push (background/backup/deploy trigger, or the next site-open pull) resumes. Sync icon transitions through `Syncing…` to `Synced`, having merged Mac B's edits made while Mac A was offline. |
| 3.5 | Verify both Macs' offline-period edits are present on both Macs afterward. | No edits lost; a `merged` line appears in Debug Pane rather than a silent drop. |

**Pass criteria:** no edits made while offline are lost, and reconnecting doesn't require any
manual action from the user (no explicit "sync now" button exists by design — reconnection alone
should be enough, though opening/reopening the site window is an acceptable manual nudge to note
if automatic reconnection sync doesn't fire promptly).

## 4. Eviction ("Optimize Mac Storage")

Exercises `VersionStore.materialize`'s eviction-handling path (`waitingForICloud`) against a real,
not faked, ubiquitous item.

| Step | Action | Expected outcome |
|---|---|---|
| 4.1 | On Mac B (not currently editing this site), enable "Optimize Mac Storage" for iCloud Drive (System Settings ▸ Apple ID ▸ iCloud ▸ iCloud Drive), or manually evict the file: Finder ▸ right-click `source.bundle` ▸ "Remove Download". | The Finder badge on `source.bundle` shows the cloud-download (not-yet-downloaded) icon. |
| 4.2 | On Mac A, make an edit and let it push. | Push succeeds normally (push doesn't require the *local* copy to be materialized before overwriting it — confirm no crash/hang). |
| 4.3 | On Mac B, open the site (forcing a pull against the evicted local artifact). | Toolbar icon shows `Waiting for iCloud…` briefly while `startDownloadingUbiquitousItem` materializes the file, then proceeds to pull normally and shows `Synced` with Mac A's edit present. If materialization takes unusually long, confirm the UI stays responsive (not blocked) and eventually settles rather than hanging indefinitely. |
| 4.4 | Repeat with a large-ish site history (many commits) if practical, to see whether the timeout (`SyncEngine`'s default `materializeTimeout`, 15s) is ever hit on a slow connection. | If it times out, the UI should show a clear "waiting for iCloud" state rather than a confusing generic failure — note whether the copy is legible and actionable. |

**Pass criteria:** eviction never crashes, hangs indefinitely, or silently fails; the user always
sees either progress or an explicit "waiting for iCloud" state, per the mac-assed-app-spec's
requirement that a blocking operation always show a clear operation/status.

## 5. Non-iCloud site: zero activity (sanity check)

| Step | Action | Expected outcome |
|---|---|---|
| 5.1 | Create or open a `.anglesite` package **outside** iCloud Drive (e.g. on an external volume, or with iCloud Drive Desktop & Documents folders off and the package saved elsewhere). | The sync status toolbar icon does not appear at all (not even as a disabled/idle state) — `SyncStatusView` renders nothing when `SyncModel.isEligible` is `false`. |
| 5.2 | Watch the Debug Pane while using this site normally (editing, backing up, deploying). | No `sync:push`/`sync:pull`/`sync:bootstrap` log lines ever appear for this site. |
| 5.3 | Confirm `Config/sync/` is never created for this package. | No `Config/sync/source.bundle` file exists on disk for a site that was never in iCloud. |

**Pass criteria:** a local-only site shows zero sync-related UI, zero sync-related log activity,
and zero sync-related files on disk — matching #881's acceptance criteria verbatim.

---

## Recording results

When this checklist is run, replace **Status: NOT YET RUN** above with the date, the two Macs'
macOS/Xcode/app build identifiers, and a pass/fail per section (1–5) with notes on any deviation
from the expected outcomes — particularly exact timings observed for iCloud propagation (§1–2),
offline reconnect latency (§3), and eviction/materialization latency (§4), since these are the
dimensions most likely to need tuning (`SyncScheduler`'s push debounce interval,
`SyncEngine`'s `materializeTimeout`) once exercised against real iCloud rather than the faked
`VersionStore` the automated test suite uses.
