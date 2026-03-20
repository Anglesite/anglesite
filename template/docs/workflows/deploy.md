# Deploy Workflow

Build, scan, and deploy the site to Cloudflare Pages.

## Prerequisites

- Cloudflare account (free at https://dash.cloudflare.com/sign-up)
- Wrangler authenticated (`npx wrangler login`)
- `CF_PROJECT_NAME` set in `.site-config`

## Quick deploy

```sh
npm run deploy
```

This runs build, security scans, and `wrangler pages deploy` in sequence. If scans fail, deploy is blocked.

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

### 3. First-time setup

If this is the first deploy, create the Cloudflare Pages project:

```sh
npx wrangler pages project create PROJECT_NAME --production-branch main
```

Save `CF_PROJECT_NAME=PROJECT_NAME` to `.site-config`.

### 4. Deploy

```sh
npx wrangler pages deploy dist/ --project-name PROJECT_NAME --commit-dirty=true
```

Replace `PROJECT_NAME` with the value from `.site-config`.

### 5. Custom domain (first deploy)

Options:
- **Buy at Cloudflare** — at-cost pricing, no markup: https://dash.cloudflare.com → Domains → Register
- **Transfer to Cloudflare** — unlock at current registrar, get EPP/auth code, transfer via dashboard
- **Point existing domain** — add domain to Cloudflare, update nameservers at current registrar

After the domain is on Cloudflare, connect it to the Pages project:
1. Dashboard → Pages → your project → Custom domains
2. Add domain → Activate
3. Cloudflare auto-provisions SSL

Save `SITE_DOMAIN` to `.site-config`.

### 6. After deploy

- Commit changes: `git add -A && git commit -m "Publish: YYYY-MM-DD"`
- Check analytics: https://dash.cloudflare.com → Web Analytics

## Security rules

- Every deploy must pass the security scan — no exceptions
- Customer PII must never appear in built HTML
- No third-party JavaScript except Cloudflare Web Analytics
- Keystatic admin routes must not be in production builds
