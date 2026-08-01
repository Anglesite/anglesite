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

1. Neither `CF_WORKER_DEPLOYED` nor `CF_WORKER_PROVISIONED` is present in `.site-config` — no Cloudflare resources (D1/KV/R2, all named from the current project slug in `WorkerComposition.generateWranglerToml`) exist yet to break. Same virginity test `DeployCommand.checkWorkerNameConflict` already uses.
2. `CF_PROJECT_NAME` still equals `SiteSlug.derive(from: SITE_NAME)` — nothing has hand-customized the project name away from what the current display name would derive.

**Revision (post-review):** an earlier draft of this guard also required `SITE_NAME` to still literally match the scaffold-time `"Untitled"`/`"Untitled N"` pattern, so only the *very first* rename away from that default would propagate — a second pre-publish rename (e.g. "Untitled" → "My Blog" → "Dave's Blog") silently stopped working, a muted recurrence of the bug this change fixes. The final review caught it; the literal-Untitled check was dropped, so every pre-publish rename keeps `CF_PROJECT_NAME` in sync now, not just the first.

**On pass:** sanitize `newDisplayName` to its first line (`.components(separatedBy: .newlines).first`), trimmed, bailing if blank — `.site-config` is a git-tracked, externally-editable file and `SiteConfigFile.upsert` does no escaping, so an unsanitized multi-line name could inject arbitrary `KEY=value` lines (caught in review; `SiteScaffolder`'s own `SITE_NAME` writer already guards this the same way). Derive `newSlug = SiteSlug.derive(from: sanitizedName)`, validate with `WorkerComposition.isValidSiteName`, then best-effort:

- `SiteConfigFile.upsert` both `SITE_NAME` and `CF_PROJECT_NAME` in `.site-config` — written **first**, since it's what `DeployCoordinator.resolveWorkerSiteName` actually reads at publish time, so a subsequent `wrangler.toml` write failure is self-correcting rather than authoritative.
- Rewrite `wrangler.toml`'s `name = "..."` line (same line-level, non-regenerating approach as `WorkerNameRename.apply`, to avoid dropping provisioned feature config — though by guard #1 there shouldn't be any yet).

All writes are `try?`. Renaming a site's display name is a frequent, low-stakes action (a text field commit) and must never fail because this propagation couldn't complete — mirrors the best-effort idiom already used by `DeployCoordinator.syncWorkerActivationToAnglesiteJSON`.

**Known blind spot (accepted, not fixed):** the virginity check only looks at `.site-config`'s own `CF_WORKER_DEPLOYED`/`CF_WORKER_PROVISIONED` markers. Since "git is the source of truth", a site's `Source/` repo can be cloned and `wrangler deploy`'d entirely outside the app, which never sets those markers — the app still reads such a site as virgin. An in-app rename would then silently re-slug `CF_PROJECT_NAME`, and because the new slug is free on the account, the existing collision check finds nothing wrong; the next in-app deploy lands on a new worker rather than the live one. This blind spot already exists elsewhere in the app's virginity handling and isn't introduced by this change, but it is newly reachable from a plain text-field rename rather than an explicit deploy action. Not worth a code change for this issue; noted for whoever next touches virginity detection.

### Call site: `SiteStore.setDisplayName`

Call `UntitledSitePropagation.propagateIfUntitled` for a real (non-clearing) rename, **before** the existing `guard settings.displayName != override else { return existing }` no-op check — not after. Today that guard would skip propagation entirely on a repeat call with the same name (e.g., if a previous attempt silently failed to write `.site-config` for some reason). Since the guards inside `propagateIfUntitled` make it cheap and idempotent, attempting it on every call is safe and self-healing.

### Out of scope

- `anglesite.json` has no site-name field today; not adding one here (`DomainConfig`'s schema stays as-is).
- `WorkerDashboardLinks`' existing use of a display-name-derived slug instead of `CF_PROJECT_NAME` for dashboard/analytics links — a separate, pre-existing bug (already wrong after any #740 collision-rename too).
- `IntegrationPlanner`'s duplicate hand-rolled `SITE_NAME` parser (vs. `SiteConfigFile.value`) — pre-existing duplication, unrelated to this fix.
- A first-publish safety net for sites renamed after their first deploy.

## Testing

- New `UntitledSitePropagationTests.swift`: fires and rewrites both files when virgin + untitled; fires again on a second pre-publish rename; no-ops when `CF_WORKER_DEPLOYED`/`CF_WORKER_PROVISIONED` present; no-ops when `CF_PROJECT_NAME` was hand-customized away from its derived value; sanitizes an embedded newline instead of injecting a `.site-config` key; no-ops when the sanitized name is blank; no-ops gracefully when `wrangler.toml`/`.site-config` is missing.
- Extend `SiteStoreTests.swift`'s `setDisplayName` coverage with an end-to-end case: scaffold an untitled site, rename it, assert `.site-config` now has the new `SITE_NAME`/`CF_PROJECT_NAME` and `wrangler.toml` has the new `name`.
