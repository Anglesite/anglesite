# Deploy Workflow

Build, scan, and deploy the site to Cloudflare Pages via Git integration.

## Prerequisites

- Cloudflare account (free at https://dash.cloudflare.com/sign-up)
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
- **Buy at Cloudflare** — at-cost pricing, no markup: https://dash.cloudflare.com → Domains → Register
- **Transfer to Cloudflare** — unlock at current registrar, get EPP/auth code, transfer via dashboard
- **Point existing domain** — add domain to Cloudflare, update nameservers at current registrar

After the domain is on Cloudflare, connect it to the Pages project:
1. Dashboard → Pages → your project → Custom domains
2. Add domain → Activate
3. Cloudflare auto-provisions SSL

Save `SITE_DOMAIN` to `.site-config`.

### 6. After deploy

- Check analytics: https://dash.cloudflare.com → Web Analytics
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
