# Anglesite Comprehensive Audit — Findings & Fix Plan

**Date:** 2026-03-30
**Scope:** All 38 skills, template files, agent instructions, 15 ADRs, docs, scripts, server code, tests
**Dimensions:** Voice, logical consistency, functionality
**Findings:** 17 critical, 33 major, 52 minor

---

## Critical (17) — Breaks functionality or violates core principles

### Security

| # | Location | Issue |
|---|---|---|
| C1 | `scripts/pre-deploy-check.sh` | `eval "$SCRIPT_GREP"` executes dynamically constructed string with values from `.site-config`. Command injection vector on every `git push`. |
| C2 | domain skill | `CF_API_TOKEN` saved to `.site-config` in plain text. Start skill commits via `git add -A`, deploy pushes to GitHub. Token ends up in remote repo. The project's own token scan (ADR-0007) should block this, creating a circular failure. |

### Build-breaking template issues

| # | Location | Issue |
|---|---|---|
| C3 | `template/src/pages/lab/index.astro` | Calls `getCollection('experiments')` but no `experiments` collection exists in `content.config.ts` or `keystatic.config.ts`. Crashes at build time. |
| C4 | `template/scripts/setup.ts` | `saveProjectDir()` references `CONFIG_FILE` which is never declared. `ReferenceError` at runtime. |
| C5 | `template/src/pages/search.astro` | Imports from `astro-pagefind/components` but `astro-pagefind` is not in `package.json`. Build failure. |
| C6 | `template/src/pages/contact.astro` | Turnstile script from `challenges.cloudflare.com` blocked by CSP in `public/_headers` which only allows `'self'` + `cloudflareinsights.com`. Also affects `review.astro`. |

### Skills that cannot execute their own steps

| # | Location | Issue |
|---|---|---|
| C7 | start skill | Missing `Bash(git add *)` and `Bash(git commit *)` in `allowed-tools`. Git operations in Step 4 will be blocked. |
| C8 | add-store skill | `allowed-tools` has only `Write, Read, Edit, Glob` — no `Bash`. Entire webhook deployment section (`npx wrangler deploy/secret put`) is unexecutable. Also references non-existent `worker/ecommerce-webhook-worker.js`. |
| C9 | stats skill | Instructs saving credentials with `Write` tool, but `Write` is not in `allowed-tools`. Cannot persist API credentials as instructed. |
| C10 | backup skill | Uses `git checkout` but only has `Bash(git status/add/commit/push/log/diff *)`. Checkout commands blocked. Also references non-existent `scripts/backup-summary.ts`. |
| C11 | experiment skill | Frontmatter **misspells** `user-invocable` (should be `user-invokable`). Also missing `allowed-tools` entirely — every tool call requires manual override. |
| C12 | copy-edit skill | `allowed-tools: Read, Glob` but skill writes `copy-edit-report.md` and edits content files. Needs `Write`/`Edit`. |
| C13 | buy-button & lemon-squeezy skills | Both missing `Bash(npm run build)` but instruct running it for verification. |

### Platform violations

| # | Location | Issue |
|---|---|---|
| C14 | check skill | `Bash(dscacheutil *)` in `allowed-tools` — macOS-only command explicitly forbidden in CLAUDE.md's cross-platform rules. |
| C15 | deploy & domain skills | `Bash(open *)` in `allowed-tools` — macOS-only. Domain skill body even says "Never open the Cloudflare dashboard" while permitting `open`. |

### Missing guard / broken reference

| # | Location | Issue |
|---|---|---|
| C16 | check skill | Missing `disable-model-invocation: true`. Only user-facing skill without it — model can auto-invoke health audits. |
| C17 | seo skill | References `${CLAUDE_PLUGIN_ROOT}/docs/seo.md` which does not exist. |

---

## Major (33) — Would confuse users or produce wrong results

### Phantom references (files/scripts that don't exist)

| # | Location | Issue |
|---|---|---|
| M1 | stats skill | References `scripts/analytics-summary.ts` and `scripts/tldraw-helpers.ts` — neither exists |
| M2 | template docs | `webmaster.md` and `security.md` reference `/anglesite:fix` — no such skill (should be `/anglesite:check`) |
| M3 | ADR-0010 | References `/anglesite:fix` skill |
| M4 | template/design-system.md | Describes `tokens.css`/`design.json`/`DESIGN.md` pipeline but `BaseLayout.astro` imports `global.css`, not `tokens.css` |
| M5 | newsletter skill | References `worker/subscribe-worker.js` for deployment but never provides the Worker source code |
| M6 | CLAUDE.md | Lists `marketplace.json` in structure tree — file does not exist |

### Version & count mismatches

| # | Location | Issue |
|---|---|---|
| M7 | Root CLAUDE.md | Version says `0.16.1`, actual is `0.16.4` |
| M8 | Root CLAUDE.md | Says "34 skills (15 user-facing, 19 model-only)" — actual is 38 (16 + 22) |
| M9 | Root CLAUDE.md | Says `docs/platforms/` has "13 files" — actual is 19 |
| M10 | Root CLAUDE.md | Says `docs/smb/` has "70 files" — actual is 67 |
| M11 | CHANGELOG.md | No entries for 0.15.1 through 0.16.4. Many skills have no changelog record. |
| M12 | README.md | Skills table lists 11 — missing `add-store`, `booking`, `seo`, `search`, `photography` |
| M13 | ADR-0015 | Status is `proposed` but Pagefind is already implemented and shipping |

### Cross-skill inconsistencies

| # | Location | Issue |
|---|---|---|
| M14 | og-images vs design-interview | OG images reads `--color-primary`, design interview generates `--color-brand`. Owner's brand color won't propagate to OG images. |
| M15 | syndicate skill | Hardcodes `src/content/posts/<slug>.mdx` but Keystatic produces `.mdoc` files |
| M16 | content.config.ts vs keystatic.config.ts | `sendNewsletter` field exists in Zod schema but not in Keystatic config — users can never set it via CMS |
| M17 | template docs | `content-guide.md` and `architecture.md` say content is `.mdx` — it's actually `.mdoc` |
| M18 | ADR-0002 | Also says `.mdx` instead of `.mdoc` |
| M19 | ADR-0008 | Says "with one exception" then lists **seven** exceptions |

### Skills with insufficient permissions

| # | Location | Issue |
|---|---|---|
| M20 | optimize-images | No `Write` or `Edit` — can't update file references after optimization |
| M21 | creative-canvas | No `Bash(npm run build)` — can't verify build after adding npm packages and Astro files |
| M22 | design-interview | No `Bash(npm run *)` for Step 10, no `Edit` for Step 6 |
| M23 | newsletter skill | Has `Bash(npx wrangler *)` but no `Edit` — can't update CSP or blog frontmatter |
| M24 | deploy skill | Step 7 says run `gh auth login` but `Bash(gh *)` not in allowed-tools |

### Undocumented or misclassified skills

| # | Location | Issue |
|---|---|---|
| M25 | paddle skill | Exists in `skills/paddle/` but completely absent from CLAUDE.md, README, and CHANGELOG |
| M26 | photography skill | Missing `disable-model-invocation: true` and `EXPLAIN_STEPS` check — inconsistent with all other user-facing skills |
| M27 | start skill | Tells owner they can run `/anglesite:design-interview` but that skill has `user-invokable: false` |

### Template issues

| # | Location | Issue |
|---|---|---|
| M28 | BaseLayout.astro | `<link rel="apple-touch-icon">` references non-existent `apple-touch-icon.png` — 404 on every page |
| M29 | template/docs/indieweb.md | Claims `h-feed` markup exists on blog listing page — it doesn't |
| M30 | template/docs/security.md | Claims honeypot field exists on every form — none of the forms have it |
| M31 | template/docs/newsletter-sending.md | Documents Ghost integration — Ghost is referenced nowhere else in the project |
| M32 | template/docs/accessibility.md | References `pa11y` and `html-validate` — neither in `package.json` |
| M33 | themes skill | Says "8 themes" but defines 9. Studio theme has no tldraw color mapping. Grid described as "4x2" but layout is 5+4. |

---

## Minor (52) — Style, voice, nitpicks, improvement opportunities

### Voice inconsistencies
- photography skill uses emoji in headers; no other user-facing skill does
- syndicate skill uses emoji prefixes in output templates; inconsistent with overall voice
- convert skill Step 8 tells owner to "run `npm run dev`" — developer jargon for non-technical users
- deploy skill suggests "Sign in with Apple" for Cloudflare — unavailable to non-Apple users
- stats skill walks owner through 7 sub-steps of Cloudflare dashboard navigation — heavy for non-technical user
- booking skill exposes CLI flags (`--provider=cal|calendly --username=<slug>`) to non-technical owners

### Stale/inaccurate references
- import & convert skills hardcode `AI_MODEL=Claude Opus 4.6` instead of dynamic model name
- import skill embeds `${CLAUDE_PLUGIN_ROOT}` path in dialogue text meant for the owner
- start skill hardcodes `ANGLESITE_VERSION=0.16.3` in example (actual: 0.16.4)
- BaseLayout.astro comment cites version `0.9.0`
- AGENTS.md references `anglesite.config.json` which is never generated
- template/CLAUDE.md missing `search`, `add-store` from commands table
- CLAUDE.md structure tree has wrong paths for wix import scripts (missing `wix/` subdirectory)
- ADR-0001 through ADR-0012 all have placeholder date `2025-01-01`
- CHANGELOG entries for AGENTS.md removal (0.9.0) contradict current template state (files exist)
- Paddle skill references `vendors.paddle.com` — Paddle migrated to `dashboard.paddle.com`
- snipcart skill hardcodes CDN version `v3.7.1` with no update mechanism
- lemon-squeezy states "now part of Stripe" — may become stale
- server/index.mjs hardcodes version `"1.0.0"` instead of reading from manifests
- pre-deploy-check.sh claims "4 mandatory checks" but performs 5

### Structural inconsistencies
- update skill has no "Architecture decisions" section (all peers do)
- 7 of 9 model-only skills in group A lack `EXPLAIN_STEPS` check (only animate has it)
- 5 of 8 model-only skills in group A have no `.site-config` existence guard
- convert skill has "For each post in BLOG_POSTS:" duplicated
- backup skill always pushes to `draft` branch with no configuration option
- new-page skill is unusually sparse (41 lines) compared to peers
- buy-button step numbering inconsistent between Path A/B and shared Step 4
- snipcart price `4500` not explained as cents
- experiment skill's 500-impression threshold contradicts its "no fixed sample sizes" Bayesian approach
- ADR-0013 uses different format than all other ADRs
- start skill has redundant cost disclosure in Step 0 and Step 8
- check skill references `docs/indieweb.md` without guard for import/convert sites

### Functional edge cases
- contact skill uses interactive `npx wrangler secret put` — may not work in Claude Code tool environment
- Worker rate limiters use in-memory Map — doesn't persist across Cloudflare isolates
- `public/_headers` CSP missing `frame-src` for OpenStreetMap embeds used in location page
- photography skill saves to `content/PHOTOGRAPHY.md` instead of `src/content/`
- seo skill writes `seo-report.md` to project root with no `.gitignore` entry
- GEMINI.md `@AGENTS.md` syntax may not function for automated Gemini CLI ingestion
- pre-deploy-check.sh phone regex uses `\s` which is non-POSIX ERE
- pack-plugin.sh omits `scripts/update.sh` and `server/` from zip — distributed plugin has broken update and missing MCP server
- release.ts pushes unconditionally without branch guard
- wix-extract.js CLI entry point sets `process.exitCode = 1` as side effect during test imports
- vitest config alias `./config.js` could silently redirect unrelated imports

---

## Systemic Patterns

Three recurring themes across the entire audit:

1. **`allowed-tools` drift** — At least 12 skills list steps they cannot execute because the required tools aren't in their frontmatter. This is the single highest-impact class of bug.

2. **`.mdx` vs `.mdoc` confusion** — The project uses Markdoc (`.mdoc`) but at least 5 locations still say `.mdx`. This likely reflects an early decision that was changed.

3. **Phantom references** — Scripts, files, and skills that are referenced but don't exist. At least 8 instances. These accumulated as features were added but cross-references weren't updated.
