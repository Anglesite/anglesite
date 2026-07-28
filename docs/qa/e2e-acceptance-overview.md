# End-to-End QA Acceptance Run — Overview

**Tracking issue:** [#706](https://github.com/Anglesite/Anglesite/issues/706) — record all evidence there.
**Scope:** the core owner journey, first launch through first publish, as four sequential parts:

| Part | Doc | Journey |
|---|---|---|
| 1 | [e2e-acceptance-1-initial-launch.md](e2e-acceptance-1-initial-launch.md) | Initial launch (fresh install, no prior state) |
| 2 | [e2e-acceptance-2-new-website.md](e2e-acceptance-2-new-website.md) | Create a new website |
| 3 | [e2e-acceptance-3-basic-edits.md](e2e-acceptance-3-basic-edits.md) | Basic edits on the website |
| 4 | [e2e-acceptance-4-publish-cloudflare.md](e2e-acceptance-4-publish-cloudflare.md) | Publish to Cloudflare (no custom domain) |

**Target:** the `Anglesite` scheme (single sandboxed Mac App Store target). Run the parts **in order on the same machine and the same site** — each part's exit state is the next part's precondition.

## Shared preconditions

- Apple Silicon Mac, macOS 26+ (macOS 27+ for the Siri AI probes to report green).
- Xcode 27+ / Swift 6.4 toolchain; `xcodegen generate` run in the checkout.
- Container boot artifacts provisioned (`scripts/vendor-container-image.sh` with `ANGLESITE_PLUGIN_SRC` set, plus `scripts/vendor-container-kernel.sh`) — see [local-container-runtime-smoke-test.md](local-container-runtime-smoke-test.md) §Artifact Provisioning. A checkout without them fails every preview by design (`UnavailableSiteRuntime`).
- `scripts/copy-plugin.sh` run so `Resources/plugin/` is populated.
- A build signed with `Resources/Anglesite.entitlements` (ad-hoc Debug is fine — the virtualization entitlement is unrestricted).
- Network access (guest `npm install`, wrangler).
- For Part 4: a Cloudflare account the tester controls, with no pre-existing token in Keychain or `CLOUDFLARE_API_TOKEN` in the environment.

## Fresh-state reset (before Part 1)

1. Quit Anglesite.
2. Delete the app container: `~/Library/Containers/io.dwk.anglesite/` (sandboxed builds keep Application Support, preferences, and `recents.json` there). For non-container state, also check `~/Library/Application Support/Anglesite/`.
3. Remove the Cloudflare token from Keychain (Keychain Access → search "Anglesite" / "Cloudflare") and ensure `CLOUDFLARE_API_TOKEN` is not exported in the launch environment.
4. Move aside any existing `~/Sites/*.anglesite` packages (or use a Sites-root override pointed at an empty directory).

## Evidence to record

For each part: commit SHA + build config, macOS/Xcode versions, PASS/FAIL per matrix row, wall-clock timings where a case asks for them, and screenshots of any FAIL plus the Debug-pane log excerpt.

## Issue map

### Blockers — code fixes landed; Part 4 still needs a manual re-run to confirm

- **#701 — scaffolded sites have no deployable wrangler config.** Fixed: `SiteScaffolder` now renders `Source/wrangler.toml` at scaffold time via `WorkerComposition.generateWranglerToml` with a slugified, per-site-unique `name`, and writes the matching `CF_PROJECT_NAME` into `.site-config`. The old `worker/wrangler.toml.template` has been removed.
- **#702 — app deploy never writes `SITE_URL`.** Fixed on a rolling basis: `DeployCommand.deploy` persists `SITE_URL` (the workers.dev URL discovered from wrangler's own output) into `.site-config` after every successful deploy, unless a custom `DOMAIN`/`SITE_DOMAIN` is already set. Because the build that ships with a given deploy already ran before that deploy's URL is known, a site's first deploy still carries `https://example.com`; the second deploy onward carries the real host.

### Open issues this run verifies (closable on PASS with evidence)

- **#586** — navigator content commands manual GUI verification → Part 3, cases 6–9.
- **#491** — Component Editor slice-1 manual GUI smoke → Part 3, case 10.
- **#656** — MAS-sandboxed GUI smoke of SwiftGit2 content ops (#649) → Part 3 run on a sandboxed build (this target is sandboxed, so the same pass counts; record git evidence).

### Open issues adjacent, not required

- **#81 / #617** — the real-signed App Store variant of this run and Phase 10.1 closeout; this run on ad-hoc Debug signing is the rehearsal.
- **#616** — distribution-grade pinned container artifacts; dev vendoring suffices for this run.
- **#679 / #680** — keyboard-only pass and Mac-assed polish audit; overlap Part 1/3 surfaces but have their own checklists.
- **#654 / #655** — GitHub publish / backup transport under sandbox: out of scope (Part 3 notes Backup is excluded from the minimal loop).

### Smaller gaps observed while authoring (filed)

- **#703** — Fixed: wizard "Set this up later" copy and the analytics-host fallback now say `<slug>.workers.dev`, matching the actual deploy target.
- **#704** — `DeployCommand.extractDeployedURL` anchors on wrangler's `Published` output line; a wrangler output-format change turns a successful deploy into "wrangler exited cleanly but no deployed URL was found".
- **#705** — `ComponentEditorView` header comment still says "Read-only (slice 1)" though slice-2 style writes shipped.
- No `representedURL`/proxy-icon wiring was found on the site window; verify in Part 2 case 9 and fold into #680 if missing (noted on #680).
