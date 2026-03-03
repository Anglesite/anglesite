---
name: Deploy
description: "Build, security scan, and deploy to Cloudflare Pages"
user-invocable: true
---

Build, scan, and deploy the site to Cloudflare Pages. On first deploy, this also handles Cloudflare account creation and domain setup.

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context.

## Step 0 — First deploy: Cloudflare account

If Wrangler has never been authorized (first time running `/anglesite:deploy`), the owner needs a Cloudflare account first.

Tell them: "To put your website on the internet, we need a free Cloudflare account. It's where your site will live — fast and free."

Ask: "Do you already have a Cloudflare account, or should we create one?"

If they need one, tell them you're opening the sign-up page:

```sh
open https://dash.cloudflare.com/sign-up
```

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

If this is the first deploy, offer a preview before going live:

Tell the owner: "Before your site goes live for everyone, I can put it on a private preview link so you can check it. Want to do that first?"

If yes:

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their business name), then add `CF_PROJECT_NAME=project-name` to `.site-config` using the **Write tool** (update the existing file).

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME --branch preview
```

This creates a preview URL like `preview.CF_PROJECT_NAME.pages.dev`. Open it:

```sh
open https://preview.CF_PROJECT_NAME.pages.dev
```

Tell the owner: "This is a preview — only people with this link can see it. Take a look and let me know if everything looks right. When you're ready, I'll make it live for everyone."

Wait for approval, then continue to Step 3 for the production deploy.

On subsequent deploys, skip this step.

## Step 3 — Deploy

Tell the owner: "Everything looks clean. I'm uploading your site to Cloudflare now."

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their business name), then add `CF_PROJECT_NAME=project-name` to `.site-config` using the **Write tool** (update the existing file).

Deploy:

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME
```

(Replace `CF_PROJECT_NAME` with the actual value from `.site-config`.)

If this is the first deploy, open the live site and celebrate:

```sh
open https://CF_PROJECT_NAME.pages.dev
```

Tell the owner: "Your website is live! Anyone can visit it at that address."

On subsequent deploys, skip to Step 6 (commit).

## Step 4 — First deploy: Domain setup

Ask: "Do you want a custom domain for your website — like www.yourbusiness.com — or is the .pages.dev address fine for now?"

If they want to skip, that's fine. They can add a domain later by running `/anglesite:deploy` and asking about it.

If they want a custom domain, ask which path fits:

### Option A — Buy a new domain

Tell the owner: "Let's search for a domain name. Cloudflare sells domains at cost — no markup, no surprise renewals."

```sh
open https://dash.cloudflare.com/?to=/:account/domains/register
```

Walk them through:
1. Search for their desired domain name
2. Pick a TLD (.com, .org, .net, etc.) — explain price differences
3. Complete purchase (requires payment method on Cloudflare account)
4. Wait for registration to complete (usually instant)

### Option B — Transfer an existing domain

Tell the owner: "We can move your domain to Cloudflare so everything is in one place. Cloudflare charges only the registry cost — usually cheaper than other registrars."

Walk them through:
1. At their current registrar: unlock the domain and get the transfer authorization code (sometimes called EPP code or auth code)
2. Open the Cloudflare transfer page:
   ```sh
   open https://dash.cloudflare.com/?to=/:account/domains/transfer
   ```
3. Enter the domain and auth code
4. Confirm transfer and pay (extends registration by 1 year)
5. Approve the transfer confirmation email from the current registrar

Tell the owner: "Transfers can take up to 5 days, but usually finish within a few hours. Your website will keep working during the transfer."

### Option C — Point an existing domain (keep current registrar)

Tell the owner: "We can point your domain at Cloudflare without moving it. Your domain stays where it is, but Cloudflare will handle the DNS."

Add the domain to Cloudflare via the API:

```sh
CF_API_TOKEN=$(npx wrangler auth token 2>/dev/null)
CF_ACCOUNT_ID=$(curl -s "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id')
```

Tell the owner: "I'm adding your domain to Cloudflare now."

```sh
curl -s "https://api.cloudflare.com/client/v4/zones" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"DOMAIN\",\"account\":{\"id\":\"$CF_ACCOUNT_ID\"},\"type\":\"full\"}"
```

The response includes `name_servers` — two Cloudflare nameserver addresses. Tell the owner:

"I've added your domain to Cloudflare. Now you need to do one thing at your current domain provider: change the nameservers to these two addresses: [nameserver 1] and [nameserver 2]. This is usually under 'DNS settings' or 'Nameservers' in your domain provider's website. This is the only step I can't do for you — it has to be done where you bought the domain."

Wait for confirmation. Propagation usually takes minutes but can take up to 48 hours.

Save the domain to `.site-config` using the Write tool (update the existing file, adding `SITE_DOMAIN=www.example.com`).

### Update local HTTPS for the new domain

If `DEV_HOSTNAME` in `.site-config` doesn't already end with the chosen domain, update it:

1. Update `DEV_HOSTNAME=SITE_DOMAIN.local` in `.site-config` using the Write tool (e.g., `DEV_HOSTNAME=keithelectric.com.local`)
2. Tell the owner: "I need to update your local preview to use your new domain name. The setup script will generate a new certificate — you may need to enter your Mac password again."

```sh
zsh scripts/setup.sh
```

The script detects the hostname change, generates a new certificate, and updates `/etc/hosts`.

## Step 5 — First deploy: Configure custom domain on Pages

Once the domain is on Cloudflare (purchased, transferred, or pointed):

Tell the owner: "I'm connecting your domain to your website now."

Add the custom domain to the Pages project via the API:

```sh
CF_API_TOKEN=$(npx wrangler auth token 2>/dev/null)
CF_ACCOUNT_ID=$(curl -s "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id')
```

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/CF_PROJECT_NAME/domains" \
  -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"SITE_DOMAIN"}'
```

(Replace `CF_PROJECT_NAME` and `SITE_DOMAIN` with values from `.site-config`.)

Cloudflare auto-creates the CNAME DNS record and provisions a free SSL certificate (usually within minutes).

Tell the owner: "Done — I connected your domain to your website. Cloudflare set up the DNS record and SSL certificate automatically."

Update the site configuration (astro.config.ts reads `SITE_DOMAIN` from `.site-config` automatically, so no manual edit needed):

- `public/robots.txt`: add `Sitemap: https://SITE_DOMAIN/sitemap-index.xml`
- `docs/cloudflare.md`: note the domain and DNS setup

Rebuild and redeploy with the correct URLs:

```sh
npm run build
```

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME
```

Tell the owner: "Your website is now live at your custom domain! SSL is handled automatically."

Tell the owner: "Try pasting your website URL into a text message or social media post draft — you should see a nice preview card with your site name and description. If it doesn't look right, we can adjust the preview image and description."

## Step 6 — First deploy: Show analytics

Tell the owner: "Cloudflare automatically tracks how many people visit your site — no cookies, completely private. You can check anytime."

```sh
open https://dash.cloudflare.com/?to=/:account/web-analytics
```

Explain what they'll see: page views, visitor count, where visitors come from (Google, social media, direct links), and which pages get the most traffic. Suggest checking monthly.

Remind them of the goals they shared during `/anglesite:start`: "You said you wanted [goal]. Once you've been live for a few weeks, check analytics to see if visitors are finding the pages that matter — like your [menu/services/portfolio] page."

## Step 7 — Save a snapshot

Run `git add -A` then `git commit -m "Publish: YYYY-MM-DD HH:MM"` (use the current date and time). Do not ask the owner to run these — just do it.

Tell the owner: "Your changes are saved and live! They'll appear on the site in about a minute."
