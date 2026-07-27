# `.anglesite` iCloud sync via `git bundle`

**Status:** Superseded by
[`2026-07-21-icloud-git-sync-design.md`](../superpowers/specs/2026-07-21-icloud-git-sync-design.md) — its split-repo
layout + `SyncEngine` design replaces the `BundleSync` actor described below outright. `BundleSync`
shelled out to `/usr/bin/git`, which cannot execute at all under the MAS App Sandbox (#640), so it
was never shippable; it was deleted in #879. This document is kept for history only.
**Issue:** #283 — "the `.anglesite` package should use `git bundle` internally so it can sync via iCloud between Macs."
**Date:** 2026-06-21

## Problem

A `.anglesite` package is a directory whose `Source/` subdirectory is a live git repo (see CLAUDE.md
"Site identity"). Users want to keep a package in iCloud Drive and have it follow them between Macs.

Putting a **live `.git` directory** in iCloud Drive does not work reliably:

- A repo is thousands of small files — loose objects, packs, `refs/`, `index`, `logs/`. iCloud syncs
  files independently and out of order; a peer can observe a packfile before the ref that names it, or
  an `index` that points at objects not yet downloaded.
- Concurrent edits on two Macs produce iCloud conflict copies (`HEAD 2`, `index 2`), which git cannot
  interpret — the repo silently corrupts.
- iCloud's eviction / "Optimize Mac Storage" can dataless-fault objects out from under git.

## Approach: a single-file bundle as an iCloud-mediated remote

`git bundle` packs an entire repository (history + selected refs) into **one opaque file**. iCloud
syncs a single file atomically and reliably. So the unit that travels through iCloud is a bundle, not
the repo:

```
Foo.anglesite/
├── Info.plist            # marker (stable UUID)
├── Source/               # the live git repo — local working copy
│   └── .git/             # NOT the sync unit (stays a normal local repo)
└── Config/
    └── sync/
        └── source.bundle # ← the iCloud-synced artifact (AnglesitePackage.syncBundleURL)
```

The bundle behaves like a **git remote whose transport is a file in iCloud**:

- **`writeBundle` (push):** regenerate `source.bundle` from `Source/` with `git bundle create
  --branches --tags HEAD`. We bundle local branches + tags + the default branch — not `--all`, which
  would also pack local-only remote-tracking refs. The write is skipped when the on-disk bundle's
  heads + tags already match the repo (compared via `git bundle list-heads` vs `git show-ref`), so an
  idle site generates **no iCloud churn**. The new bundle is written to a sibling temp, `git bundle
  verify`'d, then swapped into place under `NSFileCoordinator` (the documented way to mutate an iCloud
  item) so a peer never reads a torn file.
- **`importBundle` (pull):** `git fetch` the bundle into `refs/remotes/icloud/*` (non-destructive),
  then **fast-forward only**. A fresh peer Mac whose `Source/` has no repo yet is `git init`'d and
  checked out from the bundle. A branch that has **diverged** from the bundle, or is **ahead** of it,
  is reported — never auto-merged or rewound. This is the same safety contract as `git pull --ff-only`.

`Config/` already holds app-owned per-site state and is excluded from the `Source/` git repo, so the
bundle rides along in iCloud with the package while staying out of the user's git history.

## Why not put the bundle in `Source/`?

`Source/` is the externally-editable git repo (`cd`, VS Code, CLI all descend into it). A binary
bundle there would either be tracked (bloating history with a packfile that duplicates that history)
or need `.gitignore` upkeep. `Config/` is the natural home for app-owned sync state.

## What landed in Phase 1

- `AnglesitePackage.syncDirectoryURL` / `syncBundleURL` — single source of truth for the bundle path.
- `BundleSync` actor (AnglesiteCore) — `writeBundle`, `importBundle`, `verify`, all driven through an
  injected `GitRunner` (default: `ProcessSupervisor`), mirroring `BackupCommand`. Stateless: every
  decision is derived from the repo + bundle, so there's no sync-state file to keep consistent.
- `BundleSyncTests` — fakes the `git` subprocess and covers write (refuse non-repo / empty, create,
  no-op-when-unchanged), verify, and import (missing, dirty-tree refusal, fast-forward, up-to-date,
  local-ahead, diverged, fresh-peer init).

## Next increments (not in this PR)

1. **App wiring.** Trigger `importBundle` on site open (`SiteStore.record` / window open) and
   `writeBundle` after a successful `BackupCommand`/deploy and on app background. Surface
   `.diverged` / `.localAhead` in the UI rather than resolving silently.
2. **Conflict UX.** When a branch diverges, offer the user a deliberate resolution (open the two tips,
   or create a merge/rebase branch) — out of scope for the fast-forward-only v1.
3. **Eviction hardening.** Ensure the bundle is materialized (not dataless) before reading via
   `NSFileCoordinator` / `startDownloadingUbiquitousItem` when iCloud has evicted it.
4. **Scheduling.** Debounce `writeBundle` so rapid edits coalesce into one bundle write.
