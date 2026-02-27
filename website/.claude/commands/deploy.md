Build, scan, and deploy the site to Cloudflare Pages.

Before every tool call or command that will trigger a permission prompt, tell Julia what you're about to do and why in plain English. She should never see a permission dialog without context.

## Step 0 — First deploy check

If Wrangler has never been authorized (first time running `/deploy`), Julia needs a Cloudflare account first.

Tell her: "To put your website on the internet, we need a free Cloudflare account. It's where your site will live — fast and free."

Ask Julia: "Do you already have a Cloudflare account, or should we create one?"

If she needs one, tell her you're opening the sign-up page:

```sh
open https://dash.cloudflare.com/sign-up
```

Walk her through: click "Sign in with Apple", approve, done. Wait for her to confirm she's signed in before continuing.

Then tell her: "The first time we publish, your browser will open asking you to authorize the connection between your computer and Cloudflare — just click Authorize."

Skip this step entirely on subsequent deploys.

## Step 1 — Build

Tell Julia: "I'm building your website — turning your posts and pages into the files that go online."

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
If either returns results, STOP. Member data has leaked into the built site.

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

Tell Julia: "Everything looks clean. I'm uploading your site to Cloudflare now."

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

## Step 4 — Commit

```sh
git add -A
```

```sh
git commit -m "Publish: $(date '+%Y-%m-%d %H:%M')"
```

Tell Julia: "Your changes are live! They'll appear on the site in about a minute."
