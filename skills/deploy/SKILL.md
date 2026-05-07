---
name: deploy
description: "Build, security scan, and deploy to Cloudflare Workers"
allowed-tools: Bash(npm run build), Bash(npm run deploy *), Bash(npm run preview *), Bash(npm run ai-linkcheck *), Bash(npm run ai-a11y *), Bash(npm run ai-a14y *), Bash(npm run ai-perf *), Bash(npx wrangler *), Bash(grep *), Bash(find dist/ *), Bash(gh *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git checkout *), Bash(git merge *), Bash(git branch *), Bash(kill *), Write, Read, mcp__cloudflare__accounts_list, mcp__cloudflare__set_active_account, mcp__cloudflare__search_cloudflare_documentation
disable-model-invocation: true
---

Build, scan, and deploy the site to Cloudflare Workers (Static Assets). On first deploy, this also handles Cloudflare account creation, Wrangler authentication, and domain configuration.

The site deploys via Wrangler: `npm run deploy` builds the site (`astro build`) and publishes the resulting Worker + static assets to Cloudflare. The `draft` branch is still pushed to GitHub on every deploy as an off-site backup, but it is no longer the trigger for a preview build — preview deploys use `wrangler versions upload` instead.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — why Cloudflare Workers Static Assets (free CDN, Wrangler CLI, at-cost domains; supersedes Pages)
- [ADR-0007 Pre-deploy scans](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0007-mandatory-pre-deploy-scans.md) — why every deploy is gated by PII, token, script, and Keystatic scans with no override
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics is allowed
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — why the Cloudflare account belongs to the owner
- [ADR-0012 Verify first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0012-verify-before-presenting.md) — why build must succeed before scans and deploy
- [ADR-0013 GitHub backup](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0013-github-backup.md) — why GitHub is required for backup and issue tracking
- [ADR-0016 Accessibility audits](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0016-accessibility-audits.md) — why the deploy gate is opt-in and warn-only-friendly
- [ADR-0017 Agent readability audits](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0017-agent-readability-audits.md) — why the a14y deploy gate is driven by `AGENTIC_CRAWLERS` intent rather than a separate opt-in flag
- [ADR-0018 Performance budgets](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0018-performance-budgets.md) — why the perf gate ships warn-only with static asset budgets and an opt-in Lighthouse upgrade path

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

## Step 2a — SEO audit (non-blocking)

Run the SEO audit from `scripts/seo.ts` against the built output in `dist/`. This uses the same functions as `/anglesite:seo`:

1. Crawl all HTML files in `dist/` and run `auditPage()` on each
2. Run `auditSite()` for duplicate title/description detection
3. Run `validateSitemap()` against the sitemap XML
4. Run `auditRobotsTxt()` on `dist/robots.txt`

**Critical issues** (missing titles, missing descriptions) pause the deploy. Present them to the owner with one-shot fix options. After fixes, rebuild and re-scan.

**Warnings and Nice-to-haves** are non-blocking. Log them to `seo-report.md` in the project root and briefly mention to the owner: "I found a few SEO improvements you can make later — they're saved in seo-report.md."

If the owner passes `--skip-seo`, skip this step and log a timestamped note to `seo-report.md`: `SEO audit skipped on YYYY-MM-DD HH:MM`.

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
npm run ai-a11y -- --report a11y-report.md
```

The script exits with severity-aware codes (`1` for WCAG 2.1 AA errors, `2` for warnings, `0` for clean). When the gate is on:

- **Errors (exit 1)** pause the deploy. Present each violation with its suggested fix, offer to apply the fixes, then rebuild and re-run.
- **Warnings (exit 2)** are mentioned to the owner but do not block: "I found a few accessibility improvements you can make later — they're saved in a11y-report.md."

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

Read `${CLAUDE_PLUGIN_ROOT}/skills/copy-edit/SKILL.md` and follow it in non-interactive deploy context. This scans all content pages for clarity, tone consistency, and missing CTAs.

**No issues block the deploy.** Write findings to `copy-edit-report.md` in the project root and briefly mention to the owner: "I found a few copy improvements you can make later — they're saved in copy-edit-report.md."

If the owner passes `--skip-copy`, skip this step.

## Step 2c — Performance budget (warn-only)

Run the performance budget audit against the built site:

```sh
npm run ai-perf -- --report perf-report.md --trend perf-trend.json --warn-only
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

The script writes:

- `perf-report.md` — human-readable per-page table (committed alongside `seo-report.md`, `a11y-report.md`)
- `perf-trend.json` — rolling history (last 30 runs) used by `/anglesite:stats` to surface regressions

**1.1 ships warn-only.** Findings never block the deploy. Mention the result to the owner in plain language ("All pages within budget" or "Two pages over the JS budget — saved to perf-report.md"), then continue. Once defaults are tuned (1.2), `PERF_WARN_ONLY=false` will let owners opt into a hard gate.

### Optional: LCP and CLS via Lighthouse

If `PERF_LCP_CLS=true` is set in `.site-config`, also run Lighthouse against the preview server. This requires `npm install -D lighthouse` (one-time). Start the preview server, run the audit, then stop the server:

```sh
npm run preview -- --port 4321 &
```

Wait a couple of seconds for it to come up, then run the audit:

```sh
npm run ai-perf -- --report perf-report.md --trend perf-trend.json --lighthouse --url http://localhost:4321 --warn-only
```

Then kill the background preview process.

If the owner passes `--skip-perf`, skip this step entirely.

## Step 2.5 — Preview (first deploy only)

If this is the first deploy, offer a choice:

Tell the owner: "Your site is ready to go online. Would you like to:"
- **Preview first** — "Put it on a private link so you can check it before anyone else sees it"
- **Go live** — "Publish it right away"

Before proceeding with either choice, run through the pre-publish education checklist from `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 5 ("Pre-Publish Checklist"). For each item (`PREPUB_PURPOSE` through `PREPUB_GAPS`), check `.site-config` for the `EDUCATION_<KEY>=shown` flag — only surface items the owner hasn't seen. Present them as a quick check-in, not a gate: "Before we go live, a few quick things worth checking..." Write the flags to `.site-config` after surfacing.

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

Tell the owner: "Once we connect Cloudflare in the next step, your preview will be at a link like `draft.YOUR-PROJECT.pages.dev`. Let's set that up now."

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

Ask: "Do you want a custom domain for your website — like www.yourbusiness.com — or is the .pages.dev address fine for now?"

If they want to skip, that's fine. They can add a domain later by running `/anglesite:deploy` and asking about it.

If they want a custom domain, surface the domain education prompts from `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 2 ("Domain Setup"). Check `.site-config` for each `EDUCATION_<KEY>=shown` flag. Share `DOMAIN_VS_WEBSITE`, `DOMAIN_RENEWAL`, `EMAIL_NOT_AUTOMATIC`, and `TLD_AND_SEO` as a natural aside before diving into options — this is the richest single moment for education. Write the flags to `.site-config` after.

Then determine the right path. Ask: "Do you already own a domain, or do you need to buy one?"

### Option A — Buy a new domain

Before searching, read `${CLAUDE_PLUGIN_ROOT}/docs/domain-guide.md` and check the owner's `BUSINESS_TYPE` in `.site-config`. The right TLD depends on who they are — co-ops should consider .coop, nonprofits should consider .org, environmental orgs should consider .eco. Some mission-aligned TLDs aren't available on Cloudflare; if the best TLD for this owner requires an external registrar, help them register there first and then point nameservers to Cloudflare (Option C below). See the domain guide for the full recommendation table.

Tell the owner: "Let's search for a domain name. Cloudflare sells domains at cost — no markup, no surprise renewals."

Open the Cloudflare domain registration page: `https://dash.cloudflare.com/?to=/:account/domains/register`

Walk them through:
1. Search for their desired domain name
2. Pick a TLD — recommend based on the domain guide and their business type, not just price
3. Complete purchase (requires payment method on Cloudflare account)
4. Wait for registration to complete (usually instant)

### Option B — Transfer an existing domain to Cloudflare

Tell the owner: "We can move your domain to Cloudflare so everything is in one place. Cloudflare charges only the registry cost — usually cheaper than other registrars."

Walk them through:
1. At their current registrar: unlock the domain and get the transfer authorization code (sometimes called EPP code or auth code)
2. Open the Cloudflare transfer page:
   Open the Cloudflare transfer page: `https://dash.cloudflare.com/?to=/:account/domains/transfer`
3. Enter the domain and auth code
4. Confirm transfer and pay (extends registration by 1 year)
5. Approve the transfer confirmation email from the current registrar

Tell the owner: "Transfers can take up to 5 days, but usually finish within a few hours. Your website will keep working during the transfer."

### Option C — Point an existing domain (keep current registrar)

Tell the owner: "We can point your domain at Cloudflare without moving it. Your domain stays where it is, but Cloudflare will handle the DNS."

Open the Cloudflare domains page: `https://dash.cloudflare.com/?to=/:account/domains`

Walk them through:
1. Click "Add a domain" (or "Add a site")
2. Enter their domain name
3. Choose the Free plan
4. Cloudflare will show two nameserver addresses
5. At their current domain registrar, change nameservers to the two Cloudflare addresses (usually under "DNS settings" or "Nameservers")

Tell the owner: "That's the only step I can't do for you — it has to be done where you bought the domain. Propagation usually takes minutes but can take up to 48 hours."

### Option D — Use a subdomain of an existing Cloudflare zone

If the domain is a subdomain (e.g., `shop.example.com`) and the parent zone (`example.com`) is already on Cloudflare, the buy/transfer/point steps don't apply. Skip straight to Step 5 — the custom domain just needs a CNAME record added to the existing zone.

Tell the owner: "Since your parent domain is already on Cloudflare, we just need to connect this subdomain to your site. I'll do that in the next step."

### After domain setup — save and update local HTTPS

Save the domain to `.site-config` using the Write tool (update the existing file, adding `SITE_DOMAIN=example.com`).

If `DEV_HOSTNAME` in `.site-config` doesn't already end with the chosen domain, update it:

1. Update `DEV_HOSTNAME=SITE_DOMAIN.local` in `.site-config` using the Write tool (e.g., `DEV_HOSTNAME=pairadocs.farm.local`)
2. Tell the owner: "I need to update your local preview to use your new domain name. The setup script will generate a new certificate — you may need to enter your password again."

```sh
npm run ai-setup
```

The setup script detects the hostname change, generates a new certificate, and updates the hosts file.

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

## Step 6 — First deploy: Show analytics

Tell the owner: "Cloudflare automatically tracks how many people visit your site — no cookies, completely private. You can check anytime."

Open the analytics dashboard: `https://dash.cloudflare.com/?to=/:account/web-analytics`

Explain what they'll see: page views, visitor count, where visitors come from (Google, social media, direct links), and which pages get the most traffic. Suggest checking monthly.

Remind them of the goals they shared during `/anglesite:start`: "You said you wanted [goal]. Once you've been live for a few weeks, check analytics to see if visitors are finding the pages that matter — like your [menu/services/portfolio] page."

### Post-publish education

After the first successful deploy, surface the post-publish education from `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 6 ("Post-Publish Success Message"). Check `.site-config` for each `EDUCATION_<KEY>=shown` flag before surfacing. Share `SEO_TIMELINE`, `INDEXING_DELAY`, and `DISTRIBUTION` — the owner is most receptive right after launch, and these set realistic expectations. Write the flags to `.site-config` after.

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
