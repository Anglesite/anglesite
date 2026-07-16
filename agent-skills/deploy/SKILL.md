---
name: deploy
description: "Build, security scan, and deploy to Cloudflare Workers"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22). Deploy/provisioning steps require a Cloudflare account and Wrangler."
allowed-tools: Bash(npm run build), Bash(npm run deploy *), Bash(npm run preview *), Bash(npm run ai-linkcheck *), Bash(npm run ai-a11y *), Bash(npm run ai-a14y *), Bash(npm run ai-perf *), Bash(npm run ai-webmention-send *), Bash(npx wrangler *), Bash(grep *), Bash(find dist/ *), Bash(gh *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git checkout *), Bash(git merge *), Bash(git branch *), Bash(kill *), Write, Read, mcp__cloudflare__accounts_list, mcp__cloudflare__set_active_account, mcp__cloudflare__search_cloudflare_documentation
metadata:
  author: "David W. Keith"
  version: "1.6.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
---

Build, scan, and deploy the site to Cloudflare Workers (Static Assets). On first deploy, this also handles Cloudflare account creation, Wrangler authentication, and domain configuration.

The site deploys via Wrangler: `npm run deploy` builds the site (`astro build`) and publishes the resulting Worker + static assets to Cloudflare. The `draft` branch is still pushed to GitHub on every deploy as an off-site backup, but it is no longer the trigger for a preview build — preview deploys use `wrangler versions upload` instead.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](references/docs/decisions/0003-cloudflare-workers-hosting.md) — why Cloudflare Workers Static Assets (free CDN, Wrangler CLI, at-cost domains; supersedes Pages)
- [ADR-0007 Pre-deploy scans](references/docs/decisions/0007-mandatory-pre-deploy-scans.md) — why every deploy is gated by PII, token, script, and Keystatic scans with no override
- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics is allowed
- [ADR-0011 Owner ownership](references/docs/decisions/0011-owner-controls-everything.md) — why the Cloudflare account belongs to the owner
- [ADR-0012 Verify first](references/docs/decisions/0012-verify-before-presenting.md) — why build must succeed before scans and deploy
- [ADR-0013 GitHub backup](references/docs/decisions/0013-github-backup.md) — why GitHub is required for backup and issue tracking
- [ADR-0016 Accessibility audits](references/docs/decisions/0016-accessibility-audits.md) — why the deploy gate is opt-in and warn-only-friendly
- [ADR-0017 Agent readability audits](references/docs/decisions/0017-agent-readability-audits.md) — why the a14y deploy gate is driven by `AGENTIC_CRAWLERS` intent rather than a separate opt-in flag
- [ADR-0018 Performance budgets](references/docs/decisions/0018-performance-budgets.md) — why the perf gate ships warn-only with static asset budgets and an opt-in Lighthouse upgrade path

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Interpreting Cloudflare errors

If any `wrangler` command (build, login, versions upload, deploy) returns an error, or if Cloudflare-side behavior surfaces during a deploy step (custom domain not attaching, SSL stuck, account validation mismatch, Workers limit hit), call `mcp__cloudflare__search_cloudflare_documentation` with the error code, error message, or the symptom in plain words (e.g., "wrangler 10021", "Workers script size limit", "custom domain pending SSL"). Read the result before suggesting a fix — Cloudflare's wrangler error catalog and Workers limits change over time, and stale advice wastes the owner's time. If nothing useful comes back, say so to the owner rather than guessing.

This applies anywhere a Cloudflare-side step fails in this skill — not only the auth-error path in Step 7.

## Step 0 — First deploy: Cloudflare account

If this is the first time running `/anglesite:deploy`, the owner needs a Cloudflare account.

Tell them: "To put your website on the internet, we need a free Cloudflare account. It's where your site will live — fast and free."

Ask: "Do you already have a Cloudflare account, or should we create one?"

If they need one, tell them to open the sign-up page in their browser: `https://dash.cloudflare.com/sign-up`

Walk them through: click "Sign in with Apple", approve, done. Wait for confirmation before continuing.

Skip this step entirely on subsequent deploys.

## Step 1 — Build

Tell the owner: "I'm building your website — turning your posts and pages into the files that go online."

```sh
npm run build
```

If the build fails, explain what went wrong in plain language and fix it before proceeding.

## Step 2 — Mandatory privacy and security scan

Run the automated security scan:

```sh
npm run predeploy
```

This checks PII (emails, phone numbers), API tokens, third-party scripts, Keystatic admin routes, OG images, and the maintenance log. If any blocking check fails, it exits with code 1 and prints what went wrong. Fix the issues before proceeding.

The maintenance log is **warn-only** — it never blocks a deploy. The script reads `MAINTENANCE_MONTHLY_LAST`, `MAINTENANCE_QUARTERLY_LAST`, and `MAINTENANCE_ANNUAL_LAST` from `.site-config` and warns once any stamp is older than its grace window (35, 100, or 380 days). If any warning fires, surface it to the owner in plain language after the build — for example: "It's been about three months since your last health check — want me to run `/anglesite:check` before we publish?" — and let them decide whether to pause or continue. See `docs/webmaster.md` → Maintenance schedule.

If the site intentionally publishes a contact email (e.g., a `mailto:` link in the footer), tell the owner you'll add it to the allowlist so it doesn't block future deploys. Add to `.site-config`:

```
PII_EMAIL_ALLOW=me@example.com
```

Multiple emails are comma-separated: `PII_EMAIL_ALLOW=info@example.com,hello@example.com`

Similarly, if the site publishes phone numbers (business line, crisis hotlines), add them:

```
PII_PHONE_ALLOW=555-123-4567,1-800-662-4357
```

Numbers are matched by digits, so formatting differences don't matter.

Then re-run `npm run predeploy` to confirm it passes.

### IndieWeb endpoints (if `/anglesite:indieweb` is set up)

`/auth`, `/micropub`, `/media`, and `/webmention` are **intentional public routes** served by the site Worker — the scans expect them and never flag them. Two things the scan does enforce on an IndieWeb site:

- **Secrets stay secret.** `TOKEN_SIGNING_KEY` and `GITHUB_TOKEN` must be secret bindings (`npx wrangler secret put …` on the Worker, `gh secret set …` for the Actions workflow) — never literals in source, `worker/`, or the wrangler configs. The token scan blocks the deploy if either appears committed; rotate the leaked value first, then move it to the secret store.
- **DPoP-only is by design.** The Micropub endpoint requires a DPoP proof on every request and binds the token subject to the configured `me` (`INDIEWEB_ME`). Bearer-only Micropub clients — including micropub.rocks' default flow — won't authenticate. That's intentional security posture, not a deploy regression: never "fix" 401s from bearer clients by weakening the endpoint. See `references/docs/platforms/dwk-workers.md`.

## Step 2a — SEO audit (non-blocking)

Run the SEO audit from `scripts/seo.ts` against the built output in `dist/`. This uses the same functions as `/anglesite:seo`:

1. Crawl all HTML files in `dist/` and run `auditPage()` on each
2. Run `auditSite()` for duplicate title/description detection
3. Run `validateSitemap()` against the sitemap XML
4. Run `auditRobotsTxt()` on `dist/robots.txt`

**Critical issues** (missing titles, missing descriptions) pause the deploy. Present them to the owner with one-shot fix options. After fixes, rebuild and re-scan.

**Warnings and Nice-to-haves** are non-blocking. Log them to `reports/seo-report.md` (the `reports/` directory is gitignored — regenerated on demand, never committed) and briefly mention to the owner: "I found a few SEO improvements you can make later — they're saved in reports/seo-report.md."

If the owner passes `--skip-seo`, skip this step and log a timestamped note to `reports/seo-report.md`: `SEO audit skipped on YYYY-MM-DD HH:MM`.

## Step 2a½ — Link check (opt-in gate)

Read `LINK_CHECK_DEPLOY` from `.site-config`. If set to `true`, run the link checker against the built site:

```sh
npm run ai-linkcheck
```

If broken internal links are found, pause the deploy and present them to the owner. Offer to fix or allowlist each one. After fixes, rebuild and re-check.

**This gate is off by default.** Only runs when the owner has opted in via `.site-config`:

```
LINK_CHECK_DEPLOY=true
```

Orphaned pages and redirect chains are always non-blocking (info-level). Broken external links are non-blocking even when the gate is enabled — external sites may be temporarily down.

If the owner passes `--skip-linkcheck`, skip this step.

## Step 2a¾ — Accessibility audit (opt-in gate)

Read `A11Y_GATE` from `.site-config`. If unset or `false`, skip this step (the full accessibility audit still runs in `/anglesite:check`). If set to `true`, run the unified accessibility audit against the built site:

```sh
npm run ai-a11y
```

The script writes the report to `reports/a11y-report.md` (the `reports/` directory is gitignored — regenerated on demand) and exits with severity-aware codes (`1` for WCAG 2.1 AA errors, `2` for warnings, `0` for clean). When the gate is on:

- **Errors (exit 1)** pause the deploy. Present each violation with its suggested fix, offer to apply the fixes, then rebuild and re-run.
- **Warnings (exit 2)** are mentioned to the owner but do not block: "I found a few accessibility improvements you can make later — they're saved in reports/a11y-report.md."

**Warn-only mode for sites mid-remediation.** If `A11Y_WARN_ONLY=true` is set in `.site-config` (or the owner passes `--warn-only`), the audit always exits `0` regardless of findings, but the report is still written. Use this when a legacy site is being brought up to standard so deploys aren't blocked while the backlog clears.

**This gate is off by default.** Only runs when the owner has opted in via `.site-config`:

```
A11Y_GATE=true
A11Y_WARN_ONLY=false
```

If the owner passes `--skip-a11y`, skip this step.

For the audit to use the full pa11y/axe-core checkers (not just heuristics), the owner needs them installed once: `npm install -D pa11y` or `npm install -D @axe-core/playwright playwright`. Tell them this once when they enable the gate.

## Step 2a⅞ — Agent readability gate (a14y)

Read `AGENTIC_CRAWLERS` from `.site-config`. The default (when unset) is `allow` — Anglesite's default stance is that sites are open to humans *and* agents.

- **`allow`** — a14y runs as a deploy gate. Inviting agentic crawlers and then ignoring how readable the site is to them is incoherent; the score is enforced.
- **`block`** — the owner has declared agentic crawlers shouldn't read this site. Skip this step entirely. (`/anglesite:check` still runs a14y informationally — useful for reference even when blocked, but never blocks deploy.)

Translate the choice for the owner the first time you encounter a site where it isn't set: "Your site is open to AI agents (search summaries, chat browsers, content mappers). I'll check that they can actually read it before each deploy. If you'd rather block agentic crawlers entirely, set `AGENTIC_CRAWLERS=block` in `.site-config` and I'll skip this check."

## Step 2a-webmention — Send webmentions (conditional on Webmention being enabled)

Read `INDIEWEB_WEBMENTION` from `.site-config`. If not `true`, skip this step entirely — the site has no Webmention endpoint set up (`/anglesite:indieweb`).

If `true`, run the build-time webmention sender against the built output:

```sh
npm run ai-webmention-send
```

This scans blog posts and notes for outbound links in their content, discovers each target's Webmention endpoint, and sends one — closing the loop with the site's own receiving endpoint (ADR-0020) instead of leaving sending to a third-party tool. Each (post, link) pair is attempted once, ever; state is tracked in `webmention-sent.json` at the project root. Never blocks the deploy — it only logs a summary line (e.g. "3 sent, 12 already sent, 1 no endpoint"). If `webmention-sent.json` changed, it needs to be committed along with any other site changes so the next deploy doesn't re-attempt the same pairs.

### When the gate runs

a14y audits a live URL, so the build needs to be served. Use the preview server (it serves `dist/` from Step 1):

```sh
npm run preview -- --port 4321 &
```

Wait a couple of seconds for it to come up, then run the audit against it:

```sh
npm run ai-a14y -- --url http://localhost:4321 --json
```

Then stop the preview server (kill the background process).

Apply the same severity logic as the a11y gate:

- Exit code `0` — clean, proceed
- Exit code `1` — score below `A14Y_FAIL_UNDER` (or below a14y's default threshold). Pause the deploy, present findings in plain English (translate rule IDs into user-visible impact), offer fixes, then rebuild and re-run.
- Exit code `127` — a14y not installed. Tell the owner once: "I need to install the a14y CLI to check agent readability. It's a one-time install." Run `npm install --save-dev a14y`, then continue.

### Warn-only mode

If `A14Y_WARN_ONLY=true` is set in `.site-config` (or the owner passes `--warn-only`), the audit always exits `0` regardless of the score, but the report is still surfaced. Use this when a site is being brought up to a healthy a14y score so deploys aren't blocked while the backlog clears.

### Threshold

`A14Y_FAIL_UNDER=80` (or any 0–100 integer) sets the minimum score the gate enforces. If unset, the gate uses a14y's CLI default. Suggest a starting threshold of `80` to the owner the first time they enable the gate, and explain it's a floor — not a target.

If the owner passes `--skip-a14y`, skip this step.

## Step 2b — Copy quality scan (non-blocking)

Read the `copy-edit` skill and follow it in non-interactive deploy context. This scans all content pages for clarity, tone consistency, and missing CTAs.

**No issues block the deploy.** Write findings to `reports/copy-edit-report.md` (the `reports/` directory is gitignored — regenerated on demand) and briefly mention to the owner: "I found a few copy improvements you can make later — they're saved in reports/copy-edit-report.md."

If the owner passes `--skip-copy`, skip this step.

## Step 2c — Performance budget (warn-only)

Run the performance budget audit against the built site:

```sh
npm run ai-perf -- --warn-only
```

This walks `dist/` and computes the JS + CSS weight referenced by each HTML page, comparing against budgets in `.site-config`:

- `PERF_BUDGET_JS` — total JavaScript per page (default `51200` bytes / 50 KB)
- `PERF_BUDGET_CSS` — total CSS per page (default `51200` bytes / 50 KB)
- `PERF_BUDGET_LCP_MS` — Largest Contentful Paint target in ms (default `2500`, only checked when Lighthouse runs)
- `PERF_BUDGET_CLS` — Cumulative Layout Shift target (default `0.1`, only checked when Lighthouse runs)

Per-template overrides match the first path segment. For example, if a `/lab/*` page uses `creative-canvas` and intentionally ships a heavier bundle, raise just that route's budget:

```
PERF_BUDGET_JS_LAB=512000
PERF_BUDGET_CSS_LAB=102400
```

The script writes both files into the gitignored `reports/` directory (regenerated on demand, never committed):

- `reports/perf-report.md` — human-readable per-page table (alongside `reports/seo-report.md`, `reports/a11y-report.md`)
- `reports/perf-trend.json` — rolling history (last 30 runs) used by `/anglesite:stats` to surface regressions

**1.1 ships warn-only.** Findings never block the deploy. Mention the result to the owner in plain language ("All pages within budget" or "Two pages over the JS budget — saved to reports/perf-report.md"), then continue. Once defaults are tuned (1.2), `PERF_WARN_ONLY=false` will let owners opt into a hard gate.

### Optional: LCP and CLS via Lighthouse

If `PERF_LCP_CLS=true` is set in `.site-config`, also run Lighthouse against the preview server. This requires `npm install -D lighthouse` (one-time). Start the preview server, run the audit, then stop the server:

```sh
npm run preview -- --port 4321 &
```

Wait a couple of seconds for it to come up, then run the audit:

```sh
npm run ai-perf -- --lighthouse --url http://localhost:4321 --warn-only
```

Then kill the background preview process.

If the owner passes `--skip-perf`, skip this step entirely.

## Step 2.5 — Preview (first deploy only)

If this is the first deploy, offer a choice:

Tell the owner: "Your site is ready to go online. Would you like to:"
- **Preview first** — "Put it on a private link so you can check it before anyone else sees it"
- **Go live** — "Publish it right away"

Before proceeding with either choice, run through the pre-publish education checklist from `references/docs/education-prompts.md` section 5 ("Pre-Publish Checklist"). For each item (`PREPUB_PURPOSE` through `PREPUB_GAPS`), check `.site-config` for the `EDUCATION_<KEY>=shown` flag — only surface items the owner hasn't seen. Present them as a quick check-in, not a gate: "Before we go live, a few quick things worth checking..." Write the flags to `.site-config` after surfacing.

If they choose **preview first**, push the `draft` branch to GitHub:

```sh
git add -A
```

```sh
git commit -m "Preview: YYYY-MM-DD HH:MM"
```

```sh
git push origin draft
```

Tell the owner: "Once we connect Cloudflare in the next step, your preview will be at a link like `draft.YOUR-PROJECT.workers.dev`. Let's set that up now."

If they choose **go live**, continue to Step 3.

On subsequent deploys, skip this step.

## Step 3 — First deploy: Authenticate Wrangler and publish

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their site name), then add `CF_PROJECT_NAME=project-name` to `.site-config` using the **Write tool** (update the existing file).

Then sync the project name into `wrangler.jsonc` so Wrangler deploys to the right Worker. Read `wrangler.jsonc`, replace the `"name": "..."` line with the chosen `CF_PROJECT_NAME`, and write the file back. The scaffolded default is `"anglesite-site"` and must be replaced before the first deploy.

Tell the owner: "Now I'll connect this project to your Cloudflare account. A browser window will open — sign in with the same Cloudflare account you set up in Step 0, then approve Wrangler's access."

Authenticate Wrangler (one-time, opens a browser):

```sh
npx wrangler login
```

If the environment can't open a browser (e.g., Claude Cowork without a desktop), fall back to an API token: tell the owner to open `https://dash.cloudflare.com/profile/api-tokens`, click **Create Token**, choose the **Edit Cloudflare Workers** template, and paste the token. Save it as `CLOUDFLARE_API_TOKEN` in their shell or in a `.dev.vars` file (gitignored). Wrangler will pick it up automatically.

### Pick the right Cloudflare account

Owners who use Cloudflare for both personal and work projects (agencies, freelancers, side projects) often have access to multiple accounts. Don't rely on whatever `wrangler whoami` happens to return — pick the account explicitly so future deploys can't silently land in the wrong place.

Call `mcp__cloudflare__accounts_list` to enumerate the accounts the owner can deploy to.

- **One account** — use it. No need to ask.
- **Multiple accounts** — present a numbered picker with each account's name and ID, e.g.:

  ```
  Which Cloudflare account should this site live in?
  1. Jane Smith (personal) — abc123…
  2. Smith Studio LLC (business) — def456…
  ```

  Wait for the owner to choose, then call `mcp__cloudflare__set_active_account` with the chosen account ID.

Save the chosen account ID to `.site-config` using the **Write tool** (update the existing file, adding `CLOUDFLARE_ACCOUNT_ID=<id>`). All subsequent deploys validate against this value.

If the owner chose **preview first** in Step 2.5, upload a preview version (does not promote to production):

```sh
npx wrangler versions upload
```

Wrangler prints a preview URL of the form `https://<hash>-<project>.<account>.workers.dev`. Share it with the owner and wait for their approval before continuing.

Once approved (or if they chose **go live**), publish the production version:

```sh
npm run deploy
```

This runs `npm run build && wrangler deploy`. The site is live at `CF_PROJECT_NAME.<account>.workers.dev`.

Tell the owner: "Your website is live! Anyone can visit it at `CF_PROJECT_NAME.<your-account>.workers.dev` — and we'll attach your custom domain in the next step."

On subsequent deploys, skip to Step 7.

## Step 4 — First deploy: Domain setup

Ask: "Do you want a custom domain for your website — like www.yourbusiness.com — or is the .workers.dev address fine for now?"

If they want to skip, that's fine. They can add a domain later by running `/anglesite:deploy` and asking about it.

Read `references/skills/deploy/domain-setup.md` and follow the
instructions to buy, transfer, point, or reuse a domain, then save
`SITE_DOMAIN` and update local HTTPS.

## Step 5 — First deploy: Connect custom domain to the Worker

Once the domain is on Cloudflare (purchased, transferred, or pointed), attach it to the Worker via the Cloudflare dashboard.

Tell the owner: "I'm opening the Cloudflare dashboard so we can connect your domain to your website."

Open the Worker's settings → Domains & Routes page: `https://dash.cloudflare.com/?to=/:account/workers/services/view/CF_PROJECT_NAME/production/domains`

(Replace `CF_PROJECT_NAME` with the actual value from `.site-config`.)

Walk them through:
1. Click "Add" → "Custom Domain"
2. Enter their domain (e.g., `www.example.com` or `example.com`)
3. Click "Add Custom Domain"
4. Cloudflare auto-creates the CNAME (or AAAA for an apex) and provisions a free SSL certificate (usually within minutes)

Tell the owner: "Done — Cloudflare is connecting your domain and setting up SSL. This usually takes a minute or two."

Save `SITE_DOMAIN` to `.site-config` if not already saved.

Update the site configuration (astro.config.ts reads `SITE_DOMAIN` from `.site-config` automatically, so no manual edit needed):

- `public/robots.txt`: add `Sitemap: https://SITE_DOMAIN/sitemap-index.xml`
- `docs/cloudflare.md`: note the domain and DNS setup

Rebuild and redeploy with the correct URLs:

```sh
npm run deploy
```

```sh
git add -A
```

```sh
git commit -m "Add custom domain: SITE_DOMAIN"
```

```sh
git push origin draft
```

Tell the owner: "Your website is now live at your custom domain! SSL is handled automatically."

Tell the owner: "Try pasting your website URL into a text message or social media post draft — you should see a nice preview card with your site name and description. If it doesn't look right, we can adjust the preview image and description."

## Step 6 — First deploy: Wire up Web Analytics

The site is live, but the Cloudflare Web Analytics beacon won't fire until `CF_WEB_ANALYTICS_TOKEN` is written into `.site-config` and a build picks it up. **Doing this now means launch-week traffic (usually the most interesting traffic) actually gets recorded** — if we wait until the owner asks for `/anglesite:stats`, the beacon misses days or weeks of real visitors.

Read `CF_WEB_ANALYTICS_TOKEN` from `.site-config`. If it's already set, skip this step entirely — the beacon is wired up.

Tell the owner: "Now let's turn on Cloudflare's privacy-friendly analytics so visitors get counted from day one. It's free, cookieless, no GDPR banner needed. The beacon is already in your site code — we just need to enable it on the Cloudflare side and copy a public site tag back."

Open the Web Analytics dashboard: `https://dash.cloudflare.com/?to=/:account/web-analytics`

Walk them through:
1. Click **Add a site**
2. **Hostname** — enter the site's live hostname:
   - If `SITE_DOMAIN` is in `.site-config`, use that (e.g., `www.example.com`)
   - Otherwise, use the `CF_PROJECT_NAME.<account>.workers.dev` URL Wrangler printed in Step 3
3. Leave the "Enable on this site" toggle off (the beacon is injected by the layouts, not by Cloudflare's auto-injector — leaving it off prevents a double beacon)
4. Click **Done**
5. Cloudflare shows a JS snippet that looks like `<script ... data-cf-beacon='{"token":"abc123..."}'></script>`. Copy the **token value only** — the 32-character hex string between `"token":"` and `"}'`

Tell the owner: "Paste the token here. It's safe to share — every visitor sees it in your site's HTML anyway. It's not an API key."

Once they paste it, validate the shape (32 hex characters) and save it to `.site-config` with the Write tool by adding `CF_WEB_ANALYTICS_TOKEN=<value>`. Do not paste the token into chat from your side and do not write it anywhere outside `.site-config`.

If the owner declines or wants to skip, tell them: "No problem — you can wire it up later by running `/anglesite:stats` and it'll walk you through the same steps. Just know that any traffic before then won't be counted."

### Rebuild and redeploy so the beacon goes live

The layouts inject the beacon at build time, so the site needs one more deploy with the token in place. Reuse the publish flow:

```sh
npm run deploy
```

Tell the owner: "Your site is now reporting real-browser pageviews to Cloudflare Web Analytics. The first numbers usually show up within a few minutes."

### Where to read the numbers

"You can check anytime two ways:"

- `/anglesite:stats` — plain-language summary right here in chat (page views, top pages, busiest day, referrers)
- Dashboard for richer charts: `https://dash.cloudflare.com/?to=/:account/web-analytics`

Remind them of the goals they shared during `/anglesite:start`: "You said you wanted [goal]. Once you've been live for a few weeks, check analytics to see if visitors are finding the pages that matter — like your [menu/services/portfolio] page."

### Post-publish education

After the first successful deploy, surface the post-publish education from `references/docs/education-prompts.md` section 6 ("Post-Publish Success Message"). Check `.site-config` for each `EDUCATION_<KEY>=shown` flag before surfacing. Share `SEO_TIMELINE`, `INDEXING_DELAY`, and `DISTRIBUTION` — the owner is most receptive right after launch, and these set realistic expectations. Write the flags to `.site-config` after.

## Step 7 — Deploy

### Validate the active Cloudflare account

Before running `wrangler deploy`, confirm the active account still matches what was chosen in Step 3. Read `CLOUDFLARE_ACCOUNT_ID` from `.site-config`, then call `mcp__cloudflare__accounts_list` and check which account is currently active.

- **Match** — proceed.
- **Mismatch** — abort with a clear message. Don't silently re-point the deploy. Tell the owner: "Heads up — your active Cloudflare account is `<active-name>` (`<active-id>`), but this site was set up to deploy to `<configured-name>` (`<configured-id>`). I'll switch the active account back before publishing." Then call `mcp__cloudflare__set_active_account` with the configured ID and continue. If switching fails, stop and surface the error rather than guessing.
- **`CLOUDFLARE_ACCOUNT_ID` not set** (older sites set up before this check) — call `mcp__cloudflare__accounts_list`. If exactly one account is returned, save it to `.site-config` and continue. If multiple, run the picker from Step 3 once, then continue.

Commit all changes on `draft`:

```sh
git add -A
```

```sh
git commit -m "Publish: YYYY-MM-DD HH:MM"
```

Push `draft` to GitHub (off-site backup):

```sh
git push origin draft
```

Publish to Cloudflare via Wrangler:

```sh
npm run deploy
```

This rebuilds the site (`astro build`) and runs `wrangler deploy`, which uploads the Worker and the static assets in `dist/` to Cloudflare. The deploy is atomic — visitors keep seeing the previous version until the new one is fully uploaded.

Then mirror the publish to `main` (kept for off-site backup parity, no longer triggers a build):

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

If `wrangler deploy` fails with an auth error, run `npx wrangler login` to refresh credentials, then retry.

If the GitHub push fails (e.g., auth expired), tell the owner: "I couldn't back up to GitHub — let's fix the connection." Run `gh auth login --web` to re-authenticate, then retry.

Tell the owner: "Your changes are live! They'll appear on the site in about a minute."

### Post-deploy summary — where to look if something breaks

Each helper Worker (contact, forms, subscribe, membership, ecommerce, review) ships with `[observability]` enabled, so failed invocations are retained as logs in the Cloudflare dashboard. If a worker was deployed in this run, surface the matching logs URL so the owner has a single click to debug a "the form isn't working" report later.

Read `CLOUDFLARE_ACCOUNT_ID` from `.site-config` and substitute into:

```
https://dash.cloudflare.com/<account-id>/workers/services/view/<worker-name>/production/observability/logs
```

For each helper Worker that exists in `worker/` (look up the `name = "..."` field), include one line in the summary:

- contact form → `contact-form`
- custom forms → `forms-handler`
- newsletter signup → `newsletter-subscribe`
- members area → `anglesite-membership`
- store order tracker → `ecommerce-webhooks`
- review form → `review-form`

Frame it plainly: "If a [feature] submission ever fails, you can see the error here: <URL>. Logs are kept for a few days." Don't dump all six links if the site only uses one — only list workers actually deployed.
