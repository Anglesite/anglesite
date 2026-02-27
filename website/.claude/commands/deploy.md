Build, scan, and deploy the site to Cloudflare Pages. On first deploy, this also handles Cloudflare account creation and domain setup.

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context.

## Step 0 — First deploy: Cloudflare account

If Wrangler has never been authorized (first time running `/deploy`), the owner needs a Cloudflare account first.

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

## Step 3 — Deploy

Tell the owner: "Everything looks clean. I'm uploading your site to Cloudflare now."

Read `CF_PROJECT_NAME` from `.site-config`. If not set, ask the owner what to name the Cloudflare project (suggest a slugified version of their business name), then save it:

```sh
echo "CF_PROJECT_NAME=project-name" >> .site-config
```

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

If they want to skip, that's fine. They can add a domain later by running `/deploy` and asking about it.

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

Walk them through:
1. Open Cloudflare and add the domain:
   ```sh
   open https://dash.cloudflare.com/?to=/:account/add-site
   ```
2. Choose the Free plan
3. Cloudflare will show nameservers to use (e.g., `ada.ns.cloudflare.com`)
4. At their current registrar: change nameservers to the ones Cloudflare provided
5. Wait for propagation (usually minutes, can take up to 48 hours)

Save the domain to `.site-config`:

```sh
echo "SITE_DOMAIN=www.example.com" >> .site-config
```

## Step 5 — First deploy: Configure custom domain on Pages

Once the domain is on Cloudflare (purchased, transferred, or pointed):

1. Open the Pages project settings in Cloudflare dashboard and add the custom domain
2. Cloudflare will auto-create the DNS record (CNAME pointing to the .pages.dev URL)
3. SSL certificate is provisioned automatically (free, usually within minutes)

Update the site configuration:

- `astro.config.ts`: set `site` to `https://SITE_DOMAIN`
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

Suggest: "Now that you have a custom domain, you can set up a business email address (like you@yourdomain.com) by running `/setup-email`."

## Step 6 — Commit

```sh
git add -A
```

```sh
git commit -m "Publish: $(date '+%Y-%m-%d %H:%M')"
```

Tell the owner: "Your changes are saved and live! They'll appear on the site in about a minute."
