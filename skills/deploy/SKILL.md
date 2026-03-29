---
name: deploy
description: "Build, security scan, and deploy to Cloudflare Pages"
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(grep *), Bash(find dist/ *), Bash(open *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git checkout *), Bash(git merge *), Bash(git branch *), Write, Read
disable-model-invocation: true
---

Build, scan, and deploy the site to Cloudflare Pages. On first deploy, this also handles Cloudflare account creation, Git integration setup, and domain configuration.

Cloudflare Pages is connected to the GitHub repository. Pushing to `main` triggers a production deploy. Pushing to `draft` (or any other branch) creates a preview deploy.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-pages-hosting.md) — why Cloudflare (free CDN, Git integration, at-cost domains)
- [ADR-0007 Pre-deploy scans](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0007-mandatory-pre-deploy-scans.md) — why every deploy is gated by PII, token, script, and Keystatic scans with no override
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics is allowed
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — why the Cloudflare account belongs to the owner
- [ADR-0012 Verify first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0012-verify-before-presenting.md) — why build must succeed before scans and deploy
- [ADR-0013 GitHub backup](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0013-github-backup.md) — why GitHub is required for backup and issue tracking

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

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

This checks PII (emails, phone numbers), API tokens, third-party scripts, Keystatic admin routes, and OG images. If any blocking check fails, it exits with code 1 and prints what went wrong. Fix the issues before proceeding.

If the site intentionally publishes a contact email (e.g., a `mailto:` link in the footer), tell the owner you'll add it to the allowlist so it doesn't block future deploys. Add to `.site-config`:

```
PII_EMAIL_ALLOW=me@example.com
```

Multiple emails are comma-separated: `PII_EMAIL_ALLOW=info@example.com,hello@example.com`

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

## Step 2b — Copy quality scan (non-blocking)

Read `${CLAUDE_PLUGIN_ROOT}/skills/copy-edit/SKILL.md` and follow it in non-interactive deploy context. This scans all content pages for clarity, tone consistency, and missing CTAs.

**No issues block the deploy.** Write findings to `copy-edit-report.md` in the project root and briefly mention to the owner: "I found a few copy improvements you can make later — they're saved in copy-edit-report.md."

If the owner passes `--skip-copy`, skip this step.

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

## Step 3 — First deploy: Connect Cloudflare to GitHub

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their site name), then add `CF_PROJECT_NAME=project-name` to `.site-config` using the **Write tool** (update the existing file).

Tell the owner: "Now let's connect Cloudflare to your GitHub so your site deploys automatically whenever we publish changes."

Guide them through the Cloudflare dashboard:

1. Open in their browser: `https://dash.cloudflare.com/?to=/:account/pages/new/provider/github`

2. "Click **Connect to Git**. If GitHub asks you to authorize the Cloudflare app, click **Authorize**."

3. "Select your GitHub account, then find and select the repository for your website." (The repo name matches what's in `.site-config` as `GITHUB_REPO`.)

4. "Now we need to set the build settings:"
   - Framework preset: **Astro**
   - Build command: `npm run build && npm run predeploy`
   - Build output directory: `dist`
   - Production branch: `main`

5. "Click **Save and Deploy**. Cloudflare will build your site from GitHub — this takes about a minute."

Wait for the build to complete. If it succeeds, the site is live at `CF_PROJECT_NAME.pages.dev`.

If the owner chose "preview first" in Step 2.5, they can now see the preview at `draft.CF_PROJECT_NAME.pages.dev`. Wait for approval, then merge to `main` and push to trigger the production deploy:

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

If the owner chose "go live", the initial deploy already built from `main` — production is live.

Tell the owner: "Your website is live! Anyone can visit it at `CF_PROJECT_NAME.pages.dev`."

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

## Step 5 — First deploy: Connect custom domain to Pages

Once the domain is on Cloudflare (purchased, transferred, or pointed), connect it to the Pages project via the Cloudflare dashboard.

Tell the owner: "I'm opening the Cloudflare dashboard so we can connect your domain to your website."

Open the Pages domains page: `https://dash.cloudflare.com/?to=/:account/pages/view/CF_PROJECT_NAME/domains`

(Replace `CF_PROJECT_NAME` with the actual value from `.site-config`.)

Walk them through:
1. Click "Set up a custom domain"
2. Enter their domain (e.g., `www.example.com` or `example.com`)
3. Click "Activate domain"
4. Cloudflare auto-creates the CNAME DNS record and provisions a free SSL certificate (usually within minutes)

Tell the owner: "Done — Cloudflare is connecting your domain and setting up SSL. This usually takes a minute or two."

Save `SITE_DOMAIN` to `.site-config` if not already saved.

Update the site configuration (astro.config.ts reads `SITE_DOMAIN` from `.site-config` automatically, so no manual edit needed):

- `public/robots.txt`: add `Sitemap: https://SITE_DOMAIN/sitemap-index.xml`
- `docs/cloudflare.md`: note the domain and DNS setup

Rebuild and push to deploy with the correct URLs:

```sh
npm run build
```

```sh
git add -A
```

```sh
git commit -m "Add custom domain: SITE_DOMAIN"
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

Commit all changes on `draft`:

```sh
git add -A
```

```sh
git commit -m "Publish: YYYY-MM-DD HH:MM"
```

Push `draft` to GitHub (backup + preview):

```sh
git push origin draft
```

Merge to `main` and push (triggers production deploy via Cloudflare Git integration):

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

If the merge fails, there are changes on `main` that `draft` doesn't have. Run `git checkout draft` then `git merge main` to sync, resolve any conflicts, then retry the deploy.

If the push fails (e.g., auth expired), tell the owner: "I couldn't publish to GitHub — let's fix the connection." Run `gh auth login --web` to re-authenticate, then retry.

Tell the owner: "Your changes are live! They'll appear on the site in about a minute."
