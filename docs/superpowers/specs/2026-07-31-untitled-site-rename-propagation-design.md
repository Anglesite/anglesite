# Propagate site rename into SITE_NAME/CF_PROJECT_NAME for untitled sites

Issue: [#1182](https://github.com/Anglesite/Anglesite/issues/1182). Follow-up to [#1071](https://github.com/Anglesite/Anglesite/issues/1071) / [#1183](https://github.com/Anglesite/Anglesite/pull/1183) (the new-site chooser that scaffolds every site as "Untitled").

## Problem

The template chooser scaffolds every new site with `SITE_NAME=Untitled` and `CF_PROJECT_NAME=untitled` in `.site-config` (`SiteScaffolder.appendSiteConfig`). `SiteStore.setDisplayName` — the only path that renames a site today — writes just a `Config/settings.plist` display-name override; it never touches `.site-config` or `wrangler.toml`. Consequences:

- First publish lands at `untitled.<account>.workers.dev` even after the owner renamed the site in the UI, because `DeployCoordinator.resolveWorkerSiteName` deliberately prefers an already-stored `CF_PROJECT_NAME` over re-deriving from the display name (the #740 precedence rule — never re-derive over an established name).
- `IntegrationPlanner` and `BrandVoiceGuidance` read `SITE_NAME` from `.site-config` and substitute the literal string "Untitled" into PWA manifests and brand-voice prompts.

## Decision: propagate at rename time, not at first publish

Two seams were considered:

1. **Rename-time** (chosen): hook `SiteStore.setDisplayName`. Single call site, and safe by construction — a virgin site (no Cloudflare resources provisioned yet) can have its project slug changed freely.
2. **First-publish**: hook `DeployCommand` right before `persistWorkerProvisioned`. Would catch every case regardless of when the rename happened, but the worker-name resolution logic is duplicated between `DeployCoordinator` (GUI) and `SiteOperations` (headless/Intents) — both would need the same fix.

Rename-time was chosen for its single seam and because it covers the realistic flow (owners rename the jarring "Untitled" placeholder well before their first deploy). A site renamed *after* it has already deployed under "untitled" is a different, already-handled case: `WorkerNameRename` (collision-triggered, explicit user action via the conflict sheet) is the existing mechanism for changing a project name post-deploy, and it intentionally leaves `SITE_NAME` untouched. A first-publish safety net is explicitly deferred, not part of this change.

## Design

### New helper: `UntitledSitePropagation`

A new `AnglesiteCore` type, `UntitledSitePropagation.propagateIfUntitled(newDisplayName:siteDirectory:fileManager:)`. Sibling to `WorkerNameRename`, not built on top of it — `WorkerNameRename` is the post-deploy, collision-triggered flow (its own test asserts `SITE_NAME` is left alone); this is a distinct pre-deploy flow that updates both `SITE_NAME` and `CF_PROJECT_NAME`.

**Guard conditions** (all must hold, else silent no-op):

1. Neither `CF_WORKER_DEPLOYED` nor `CF_WORKER_PROVISIONED` is present in `.site-config` — no Cloudflare resources (D1/KV/R2, all named from the current project slug in `WorkerComposition.generateWranglerToml`) exist yet to break.
2. `SITE_NAME` still matches the scaffold-time pattern: exactly `"Untitled"` or `"Untitled N"` (matching `NewSiteWizardModel.untitledName`'s output).
3. `CF_PROJECT_NAME` still equals `SiteSlug.derive(from: SITE_NAME)` — nothing has hand-customized the project name since scaffold.

**On pass:** derive `newSlug = SiteSlug.derive(from: newDisplayName)`, validate with `WorkerComposition.isValidSiteName`, then best-effort:

- Rewrite `wrangler.toml`'s `name = "..."` line (same line-level, non-regenerating approach as `WorkerNameRename.apply`, to avoid dropping provisioned feature config — though by guard #1 there shouldn't be any yet).
- `SiteConfigFile.upsert` both `SITE_NAME` and `CF_PROJECT_NAME` in `.site-config`.

All writes are `try?`. Renaming a site's display name is a frequent, low-stakes action (a text field commit) and must never fail because this propagation couldn't complete — mirrors the best-effort idiom already used by `DeployCoordinator.syncWorkerActivationToAnglesiteJSON`.

### Call site: `SiteStore.setDisplayName`

Call `UntitledSitePropagation.propagateIfUntitled` for a real (non-clearing) rename, **before** the existing `guard settings.displayName != override else { return existing }` no-op check — not after. Today that guard would skip propagation entirely on a repeat call with the same name (e.g., if a previous attempt silently failed to write `.site-config` for some reason). Since the guards inside `propagateIfUntitled` make it cheap and idempotent, attempting it on every call is safe and self-healing.

### Out of scope

- `anglesite.json` has no site-name field today; not adding one here (`DomainConfig`'s schema stays as-is).
- `WorkerDashboardLinks`' existing use of a display-name-derived slug instead of `CF_PROJECT_NAME` for dashboard/analytics links — a separate, pre-existing bug (already wrong after any #740 collision-rename too).
- `IntegrationPlanner`'s duplicate hand-rolled `SITE_NAME` parser (vs. `SiteConfigFile.value`) — pre-existing duplication, unrelated to this fix.
- A first-publish safety net for sites renamed after their first deploy.

## Testing

- New `UntitledSitePropagationTests.swift`: fires and rewrites both files when virgin + untitled; no-ops when `CF_WORKER_DEPLOYED`/`CF_WORKER_PROVISIONED` present; no-ops when `SITE_NAME` was already customized; no-ops when `CF_PROJECT_NAME` was hand-customized away from its derived value; no-ops gracefully when `wrangler.toml`/`.site-config` is missing.
- Extend `SiteStoreTests.swift`'s `setDisplayName` coverage with an end-to-end case: scaffold an untitled site, rename it, assert `.site-config` now has the new `SITE_NAME`/`CF_PROJECT_NAME` and `wrangler.toml` has the new `name`.
