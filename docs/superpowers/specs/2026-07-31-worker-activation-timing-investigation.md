# Investigation: timing hazards for moving worker activation to `Source/anglesite.json`

**Date:** 2026-07-31
**Issue:** [#1172 — anglesite.json: move worker activation intent to Source/ (with fallback)](https://github.com/Anglesite/Anglesite/issues/1172)
**Status:** Investigation complete, informs the implementation in the same PR

Per the owner decision recorded in the parent investigation doc
(`docs/superpowers/specs/2026-07-31-domain-config-in-git-investigation.md` §7.3): "investigate
timing issues further during implementation and keep a fallback to the current `Config/`-based
behavior." This doc records that investigation before describing the wiring it justifies.

## 1. Where `activeWorkerIDs` lives and is touched today

`SiteSettings.activeWorkerIDs` (`Sources/AnglesiteCore/SiteConfigStore.swift:45`) is read and
written through `SiteConfigStore`, an actor scoped to `Config/settings.plist`. Every call site
constructs its **own** `SiteConfigStore` instance — the actor provides no cross-instance
serialization, so two concurrent read-modify-write cycles against the same file race the plist
directly:

- Reads: `WorkerActivation.effectiveActiveIDs` callers — `DeployModel.swift:527-528`,
  `SiteOperations.swift:90-91`, `PlistEditorModel.swift:868-870`.
- Writes: `PlistEditorModel.setWorkerActive` (`PlistEditorModel.swift:889-891`, the Workers
  Settings tab toggle), `DeployCoordinator.persistProvisionedResources`
  (`DeployCoordinator.swift:149-159`, the GUI post-deploy write), `SiteOperations.swift:139-144`
  (the headless post-deploy write).

`provisionedWorkerResources` (`SiteConfigStore.swift:56`) is the contrast case: it stays in
`Config/` permanently (account-scoped resource identity, #709), never moves to `anglesite.json`.

## 2. GUI deploy path (`DeployModel.runDeploy`)

1. `DeployModel.swift:527-528` — **one** snapshot read of `Config/settings.plist`, held for the
   entire deploy (build + provision + Cloudflare calls: real wall-clock seconds-to-minutes).
2. `DeployCoordinator.planWorkerActivation` computes the effective set from that snapshot.
3. `SocialWorkerProvisionCommand.provision` writes the host `Source/wrangler.toml` at several
   points, culminating in `WorkerComposition.generateWranglerToml`
   (`SocialWorkerProvisionCommand.swift:543`).
4. When a container runtime is active, `ContainerDeployExecutor.run` re-syncs that host
   `wrangler.toml` into the guest's boot-time clone immediately before the `.wrangler` step
   (`DeployExecutor.swift:158-178`, the #1084 fix) — an explicit acknowledgment that the guest's
   one-time `git clone` (`ContainerizationControl.swift:100-125`) is otherwise stale for any
   uncommitted host write.
5. `DeployCoordinator.persistProvisionedResources` (`DeployCoordinator.swift:149-159`) builds its
   update from the **step-1 snapshot**, not a fresh read, and saves.

Steps 1 and 5 are two independent, unsynchronized plist read/writes separated by the whole
deploy. Nothing locks `Config/settings.plist` between them today, and this doc doesn't change
that — it only adds a second file (`Source/anglesite.json`) with the same shape of hazard.

## 3. Headless deploy path (`SiteOperations.deployWithWorkerComposition`)

Runs **on the host**, inside `SiteAccess.withScopedAccess` (`SiteOperations.swift:87-147`) — it
reads `Config/settings.plist` directly (`SiteOperations.swift:90-91`), the same as the GUI path.
It is *not* the "container can't see `Config/`" case; that gap is structural, not this call
site's problem. What it *does* lack is a populated `SiteContentGraph` (headless — no window open
to build one) and a fresh worker-catalog fetch, so it resolves `WorkerDescriptor` data from
`WorkerCatalogFetcher.cachedCatalog()` (PR #829) rather than the network. That workaround is about
catalog **descriptor** data (bindings/routes), not the activation-id source `#1172` moves — the
two are orthogonal, and this change doesn't touch the catalog-cache workaround.

The genuinely `Config/`-blind boundary is the container **guest**: its `git clone` of `Source/`
happens once at boot (`ContainerizationControl.swift:100-125`) and never sees `Config/` at all.
Today this doesn't cause a bug because the **host** always computes activation and pushes the
result (`wrangler.toml`) across the boundary (§2 step 4) — the guest never independently resolves
`activeWorkerIDs`. Moving the declared source into `Source/anglesite.json` doesn't change *who*
resolves activation (still the host, in both deploy paths); it changes *which file* the host reads
it from, so that a future genuinely-remote trigger (no local Mac host in the loop at all) has a
chance of working, since `anglesite.json` is the one activation-relevant file already inside the
git clone the remote side would have.

## 4. Workers Settings tab toggle (`PlistEditorModel.setWorkerActive`)

`PlistEditorModel.swift:883-905` does a read-modify-write of `Config/settings.plist`, saves
immediately, then calls `onActiveWorkersChanged(settings)`
(`SiteWindowModel.swift:1077-1079` → `PreviewModel.activeWorkersChanged`,
`PreviewModel.swift:504-506`) which **only** restarts a live local `wrangler-dev` preview session
(`PreviewModel.swift:501-503`, "No-op for non-container runtimes"). It does not touch
`wrangler.toml` and does not trigger a redeploy — the next real deploy re-reads `Config/` fresh at
`DeployModel.swift:527-528`.

## 5. Existing staleness idiom

`FileDocumentIO.externalChange(at:lastKnownModificationDate:...)`
(`Sources/AnglesiteCore/FileDocumentIO.swift:45-70`) is the codebase's one "is disk newer than my
baseline" primitive — a strict `current > last` mtime comparison, with a documented HFS+
1-second-granularity caveat. **Neither `SiteConfigStore` nor `DomainConfigStore` has any
staleness logic today** — `DomainConfigStore.save` only guards the `version` field from being
lowered by a merge (§ "Unlike every other field, `version`..."), which is schema-version
protection, not a freshness check.

Reusing raw file mtimes for this fallback would be misleading: `anglesite.json` also holds
`domain`/`dns`/`edge`/`email` sections that change far more often than `workers.active` (a DNS
record add touches the same file), so the whole-file mtime is a poor proxy for "is the `workers`
declaration itself current." A value comparison against a recorded sync marker is used instead
(§7) — no clock/mtime-granularity dependency, and it self-heals on the next successful
write-through.

## 6. Concrete hazard scenarios

**a. GUI deploy vs. headless deploy running concurrently.** Both paths independently
read-then-await-then-write `Config/settings.plist` through unsynchronized `SiteConfigStore`
instances (§1). Whichever finishes last silently overwrites the other's
`lastDeployedWorkerIDs`/`provisionedWorkerResources`. Pre-existing hazard, unrelated to this
slice's `workers.active` move — noted for completeness, not addressed here.

**b. Mid-deploy Workers-tab toggle.** `persistProvisionedResources` derives its update from the
deploy's pre-deploy snapshot. A `setWorkerActive` toggle that lands between the snapshot and the
post-deploy save gets its `activeWorkerIDs` write silently reverted the moment the deploy's
success handler persists — even though the toggle already reported success to the owner.
Pre-existing; moving the declared source to `anglesite.json` doesn't fix this (a deploy still
plans from a point-in-time resolution), but it also doesn't make it worse, since the resolution
in §7 is computed once per deploy exactly like today's `Config/` read is.

**c. Stale container clone.** Not reachable today (§3) because the host always resolves
activation and pushes `wrangler.toml` across. It becomes reachable only if a *future* deploy
trigger reads `anglesite.json` from inside the guest's own clone rather than being told by a live
host — out of scope for this slice, which keeps activation resolution host-side in both existing
deploy paths.

**d. `wrangler.toml` regen racing a hand edit of `anglesite.json`.** `DomainConfigStore.save` does
an unlocked read-merge-write of the whole file. An owner's hand edit to `workers.active` and a
concurrent write-through (Settings tab toggle, or the deploy-time sync in §7) each read-merge-write
independently; whichever saves second wins for the `workers` key. This is the general
`DomainConfigStore` concurrent-writer hazard already implicit in #1169/#1170/#1171 — not
introduced by this slice — and is why the fallback (§7) treats a `Config/`/`anglesite.json`
mismatch as "trust `Config/`, don't fail and don't silently deploy a reduced set" rather than
trying to resolve the conflict.

## 7. Resulting design (implemented in this PR)

- **Resolution is a value comparison, not a timestamp one.** `SiteSettings` gains
  `activeWorkerIDsMigratedToAnglesiteJSON: [String]?` — the `Config/` value that was successfully
  written into `anglesite.json`'s `workers.active` the last time the write-through ran. At deploy
  time, `DeployCoordinator.resolveActiveWorkerIDs` prefers the `anglesite.json` declaration only
  when: the file parses, `workers.active` is declared, AND `Config/`'s *current* `activeWorkerIDs`
  still equals that recorded snapshot. Any other case (unparsable file, never declared, or
  `Config/` has moved since the last successful sync — write-through failed, or something wrote
  `Config/` directly without going through it) falls back to `Config/`, matching the issue's
  "absent, unparsable, or older than the `Config/` state it migrated from" wording without
  depending on filesystem mtimes (avoids the HFS+ granularity caveat in §5, and self-heals on the
  next successful write-through rather than requiring manual recovery).
- **Write-through happens at toggle time**, not deploy time:
  `DeployCoordinator.syncWorkerActivationToAnglesiteJSON` runs inside
  `PlistEditorModel.setWorkerActive`, mirroring `CustomDomainAttachCommand.persistDomainIntent`'s
  load-modify-save-best-effort shape. `Config/` is written first (existing behavior, unchanged);
  the `anglesite.json` write and the sync-marker update are both best-effort (`try?`) so a
  git-tracked-file write failure (e.g. `Source/` unwritable) never blocks the toggle the owner
  already saw succeed — it just leaves the resolver on the `Config/` fallback until the next
  successful toggle.
- **Both deploy paths resolve through the same function.** `DeployCoordinator.planWorkerActivation`
  calls `resolveActiveWorkerIDs` before computing `WorkerActivation.effectiveActiveIDs`, so
  `DeployModel.runDeploy` and `SiteOperations.deployWithWorkerComposition` can't drift (same
  mirrored-warning idiom #708/#744 already established for `missingDescriptorWarning`).
