---
name: deploy
description: "Build, security scan, and deploy to Cloudflare Pages"
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Bash(grep *), Bash(find dist/ *), Bash(open *), Bash(git add *), Bash(git commit *), Write, Read
disable-model-invocation: true
---

Build, scan, and deploy the site to Cloudflare Pages. On first deploy, this also handles Cloudflare account creation and domain setup.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](docs/decisions/0003-cloudflare-pages-hosting.md) — why Cloudflare (free CDN, Wrangler CLI, at-cost domains)
- [ADR-0007 Pre-deploy scans](docs/decisions/0007-mandatory-pre-deploy-scans.md) — why every deploy is gated by PII, token, script, and Keystatic scans with no override
- [ADR-0008 No third-party JS](docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics is allowed
- [ADR-0011 Owner ownership](docs/decisions/0011-owner-controls-everything.md) — why the Cloudflare account belongs to the owner
- [ADR-0012 Verify first](docs/decisions/0012-verify-before-presenting.md) — why build must succeed before scans and deploy

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt — tell the owner what you're about to do and why in plain English. If `false`, proceed without pre-announcing tool calls.

## Step 0 — First deploy: Cloudflare account

If Wrangler has never been authorized (first time running `/anglesite:deploy`), the owner needs a Cloudflare account first.

Tell them: "To put your website on the internet, we need a free Cloudflare account. It's where your site will live — fast and free."

Ask: "Do you already have a Cloudflare account, or should we create one?"

If they need one, tell them you're opening the sign-up page:

Open the sign-up page in their browser: `https://dash.cloudflare.com/sign-up`

Walk them through: click "Sign in with Apple", approve, done. Wait for confirmation before continuing.

Then tell them: "The first time we publish, your browser will open asking you to authorize the connection between your computer and Cloudflare — just click Authorize."

Skip this step entirely on subsequent deploys.

## Step 1 — Build

Tell the owner: "I'm building your website — turning your posts and pages into the files that go online."

```sh
npm run build
```

If the build fails, explain what went wrong in plain language and fix it before proceeding.

## Step 2 — Mandatory privacy and security scan

Run ALL of these checks. A failure in any check blocks deployment. No exceptions.

### PII scan
```sh
grep -rn '@' dist/ --include='*.html' | grep -v 'charset' | grep -v 'viewport' | grep -v '@astro'
grep -rnE '\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}' dist/ --include='*.html'
```
If either returns results, STOP. Customer data has leaked into the built site.

### Token scan
```sh
grep -rnE '(pat[A-Za-z0-9]{14,}|sk-[A-Za-z0-9]{20,})' dist/ src/ public/
```
If this returns results, STOP. An API token is exposed.

### Third-party scripts
```sh
grep -rn '<script[^>]*src=' dist/ --include='*.html' | grep -v 'cloudflareinsights' | grep -v '_astro'
```
If this returns results, STOP. Unauthorized external JavaScript.

### Keystatic not in build
```sh
find dist/ -path '*keystatic*' -type f
```
If this returns results, STOP. Admin routes leaked into production.

## Step 2.5 — Staging preview (first deploy only)

If this is the first deploy, offer a choice:

Tell the owner: "Your site is ready to go online. Would you like to:"
- **Preview first** — "Put it on a private link so you can check it before anyone else sees it"
- **Go live** — "Publish it right away"

If they choose **preview first**, continue below. If they choose **go live**, skip to Step 3.

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their site name), then add `CF_PROJECT_NAME=project-name` to `.site-config` using the **Write tool** (update the existing file).

Create the project (first deploy only — this is required before any deploy):

```sh
npx wrangler pages project create CF_PROJECT_NAME --production-branch main
```

If this fails with "A project with this name already exists", that's fine — continue.

Deploy to a preview branch:

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME --branch preview --commit-dirty=true
```

This creates a preview URL like `preview.CF_PROJECT_NAME.pages.dev`. Open it:

Open the preview in their browser: `https://preview.CF_PROJECT_NAME.pages.dev`

Tell the owner: "This is a preview — only people with this link can see it. Take a look and let me know if everything looks right. When you're ready, I'll make it live for everyone."

Wait for approval, then continue to Step 3 for the production deploy.

On subsequent deploys, skip this step.

## Step 3 — Deploy

Tell the owner: "Everything looks clean. I'm uploading your site to Cloudflare now."

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their site name), then add `CF_PROJECT_NAME=project-name` to `.site-config` using the **Write tool** (update the existing file).

On first deploy, create the project (skip if already done in Step 2.5):

```sh
npx wrangler pages project create CF_PROJECT_NAME --production-branch main
```

If this fails with "A project with this name already exists", that's fine — continue.

Deploy:

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME --commit-dirty=true
```

(Replace `CF_PROJECT_NAME` with the actual value from `.site-config`.)

If this is the first deploy, open the live site and celebrate:

Open the live site in their browser: `https://CF_PROJECT_NAME.pages.dev`

Tell the owner: "Your website is live! Anyone can visit it at that address."

On subsequent deploys, skip to Step 7 (commit).

## Step 4 — First deploy: Domain setup

Ask: "Do you want a custom domain for your website — like www.yourbusiness.com — or is the .pages.dev address fine for now?"

If they want to skip, that's fine. They can add a domain later by running `/anglesite:deploy` and asking about it.

If they want a custom domain, first determine the right path. Ask: "Do you already own a domain, or do you need to buy one?"

### Option A — Buy a new domain

Tell the owner: "Let's search for a domain name. Cloudflare sells domains at cost — no markup, no surprise renewals."

Open the Cloudflare domain registration page: `https://dash.cloudflare.com/?to=/:account/domains/register`

Walk them through:
1. Search for their desired domain name
2. Pick a TLD (.com, .org, .net, etc.) — explain price differences
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

1. Update `DEV_HOSTNAME=SITE_DOMAIN.local` in `.site-config` using the Write tool (e.g., `DEV_HOSTNAME=keithelectric.com.local`)
2. Tell the owner: "I need to update your local preview to use your new domain name. The setup script will generate a new certificate — you may need to enter your password again."

```sh
npm run ai-setup
```

The setup script detects the hostname change, generates a new certificate, and updates `/etc/hosts`.

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

Rebuild and redeploy with the correct URLs:

```sh
npm run build
```

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME --commit-dirty=true
```

Tell the owner: "Your website is now live at your custom domain! SSL is handled automatically."

Tell the owner: "Try pasting your website URL into a text message or social media post draft — you should see a nice preview card with your site name and description. If it doesn't look right, we can adjust the preview image and description."

## Step 6 — First deploy: Show analytics

Tell the owner: "Cloudflare automatically tracks how many people visit your site — no cookies, completely private. You can check anytime."

Open the analytics dashboard: `https://dash.cloudflare.com/?to=/:account/web-analytics`

Explain what they'll see: page views, visitor count, where visitors come from (Google, social media, direct links), and which pages get the most traffic. Suggest checking monthly.

Remind them of the goals they shared during `/anglesite:start`: "You said you wanted [goal]. Once you've been live for a few weeks, check analytics to see if visitors are finding the pages that matter — like your [menu/services/portfolio] page."

## Step 7 — Save a snapshot

Run `git add -A` then `git commit -m "Publish: YYYY-MM-DD HH:MM"` (use the current date and time). Do not ask the owner to run these — just do it.

Tell the owner: "Your changes are saved and live! They'll appear on the site in about a minute."
