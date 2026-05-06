# Deploy Workflow

Build, scan, and deploy the site to Cloudflare Pages via Git integration.

## Prerequisites

- Cloudflare account (free at <https://dash.cloudflare.com/sign-up>)
- Cloudflare Pages project connected to GitHub (set up during first `/anglesite:deploy`)
- `CF_PROJECT_NAME` set in `.site-config`
- `GITHUB_REPO` set in `.site-config`

## How it works

Cloudflare Pages is connected to the GitHub repository via Git integration. Pushing to `main` triggers a production deploy. Pushing to `draft` (or any other branch) creates a preview deploy.

## Quick deploy

```sh
npm run build
```

```sh
npm run predeploy
```

```sh
git add -A
```

```sh
git commit -m "Publish: YYYY-MM-DD HH:MM"
```

```sh
git push origin draft
```

```sh
git checkout main
```

```sh
git merge draft --no-edit
```

```sh
git push origin main
```

```sh
git checkout draft
```

## Step-by-step

### 1. Build

```sh
npm run build
```

Fix any errors before proceeding.

### 2. Security scan

```sh
npm run predeploy
```

Checks for:

- PII (emails, phone numbers) in built HTML
- API tokens in dist/, src/, public/
- Unauthorized third-party scripts (only Cloudflare Analytics allowed)
- Keystatic admin routes in production build
- Missing og:image (warning only)

Exit code 1 blocks deploy. Fix all issues before proceeding.

If the site intentionally publishes a contact email (e.g., a `mailto:` link in the footer), add it to `.site-config` so it doesn't trigger the PII scan:

```ini
PII_EMAIL_ALLOW=me@example.com
```

Multiple emails are comma-separated: `PII_EMAIL_ALLOW=info@example.com,hello@example.com`

Similarly, if the site publishes phone numbers (business line, crisis hotlines), allowlist them:

```ini
PII_PHONE_ALLOW=555-123-4567,1-800-662-4357
```

Numbers are matched by digits only, so formatting differences (dashes, dots, parens) don't matter.

### 2b. Agent readability gate (a14y)

`/anglesite:deploy` runs an agent-readability audit ([a14y.dev](https://a14y.dev)) when the owner allows agentic crawlers. The behavior is set by `AGENTIC_CRAWLERS` in `.site-config`:

```ini
AGENTIC_CRAWLERS=allow   # default — a14y is a deploy gate
AGENTIC_CRAWLERS=block   # owner has blocked agentic crawlers; a14y is informational only
```

`AGENTIC_CRAWLERS` is the single source of truth for the owner's stance and drives three surfaces:

| Surface | `allow` (default) | `block` |
|---|---|---|
| Deploy gate (a14y) | Runs as a gate; below-threshold scores pause publishing | Skipped (informational only in `/anglesite:check`) |
| `llms.txt` | Generated when the owner asks (`/anglesite:seo` Step 5) | Not generated; existing `public/llms.txt` should be deleted |
| `robots.txt` | No `Disallow` rules for agentic crawlers | Each entry in `AGENTIC_CRAWLER_BOTS` (`GPTBot`, `ClaudeBot`, `anthropic-ai`, `CCBot`, `Google-Extended`, `PerplexityBot`, `Bytespider`) gets `Disallow: /` |

When the gate is on, set the score floor with `A14Y_FAIL_UNDER` (e.g. `80`). While remediating, set `A14Y_WARN_ONLY=true` so the audit reports without blocking. The deploy skill brings up `npm run preview` automatically and tears it down after the audit.

If a14y isn't installed yet, the gate prompts a one-time install: `npm install --save-dev a14y`.

If you flip the policy, regenerate `public/robots.txt` via `generateRobotsTxt({ ..., agenticCrawlers })` from `scripts/seo.ts` and remove `public/llms.txt` if you've switched to `block`. `/anglesite:check` flags drift between the policy and these files.

### 2c. Performance budget (warn-only)

`/anglesite:deploy` runs a per-page performance budget audit on `dist/`. Defaults are 50 KB total JS and 50 KB total CSS per page; LCP and CLS are checked when Lighthouse is installed and `PERF_LCP_CLS=true` is set. All findings are warn-only in 1.1 — they're written to `perf-report.md` and a 30-run trend file (`perf-trend.json`) but never block the deploy.

Override the defaults in `.site-config`:

```ini
PERF_BUDGET_JS=51200       # bytes — total JS per page
PERF_BUDGET_CSS=51200      # bytes — total CSS per page
PERF_BUDGET_LCP_MS=2500    # ms — only checked with --lighthouse
PERF_BUDGET_CLS=0.1        # only checked with --lighthouse
```

Per-template overrides match the first path segment. A `creative-canvas` page that intentionally ships a heavy bundle can raise just its own budget:

```ini
PERF_BUDGET_JS_LAB=512000
PERF_BUDGET_CSS_LAB=102400
```

Trends surface in `/anglesite:stats` so the owner can see whether the bundle is creeping up over time. Run the audit ad-hoc:

```sh
npm run ai-perf -- --report perf-report.md
```

### 3. First-time setup

If this is the first deploy, connect Cloudflare Pages to GitHub via the dashboard:

1. Open: `https://dash.cloudflare.com/?to=/:account/pages/new/provider/github`
2. Authorize the Cloudflare GitHub app
3. Select the repository
4. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build && npm run predeploy`
   - Build output directory: `dist`
   - Production branch: `main`
5. Click **Save and Deploy**

Save `CF_PROJECT_NAME` to `.site-config`.

### 4. Deploy

Commit changes and push `draft` to GitHub (backup + preview):

```sh
git add -A
```

```sh
git commit -m "Publish: YYYY-MM-DD HH:MM"
```

```sh
git push origin draft
```

Merge to `main` and push (triggers production deploy):

```sh
git checkout main
```

```sh
git merge draft --no-edit
```

```sh
git push origin main
```

Return to working branch:

```sh
git checkout draft
```

### 5. Custom domain (first deploy)

Options:

- **Buy at Cloudflare** — at-cost pricing, no markup: <https://dash.cloudflare.com> → Domains → Register
- **Transfer to Cloudflare** — unlock at current registrar, get EPP/auth code, transfer via dashboard
- **Point existing domain** — add domain to Cloudflare, update nameservers at current registrar

After the domain is on Cloudflare, connect it to the Pages project:

1. Dashboard → Pages → your project → Custom domains
2. Add domain → Activate
3. Cloudflare auto-provisions SSL

Save `SITE_DOMAIN` to `.site-config`.

### 6. After deploy

- Check analytics: <https://dash.cloudflare.com> → Web Analytics
- Preview deploys available at `draft.CF_PROJECT_NAME.pages.dev`

## Merge conflicts

If `git merge draft` fails on `main`, there are changes on `main` that `draft` doesn't have:

```sh
git checkout draft
```

```sh
git merge main
```

Resolve any conflicts, commit, then retry the deploy.

## Security rules

- Every deploy must pass the security scan — no exceptions
- Customer PII must never appear in built HTML
- No third-party JavaScript except Cloudflare Web Analytics
- Keystatic admin routes must not be in production builds
