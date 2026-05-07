# Cloudflare

## Worker project

- Project name: stored in `.site-config` as `CF_PROJECT_NAME` (set during first `/anglesite:deploy`) and mirrored as the `name` field in `wrangler.jsonc`
- Account: stored in `.site-config` as `CLOUDFLARE_ACCOUNT_ID` (set during first `/anglesite:deploy`). Owners with access to multiple accounts (agencies, freelancers, side projects) see a picker on first deploy. Every later deploy validates the active account against this value and aborts on mismatch rather than silently deploying somewhere unexpected.
- Deployed via the `@astrojs/cloudflare` adapter as **Cloudflare Workers Static Assets** (Worker entry + `ASSETS` binding)
- Production deploys: run `npm run deploy` (which runs `astro build && wrangler deploy`)
- Preview versions: `npx wrangler versions upload` (does not promote to production)
- Authentication: `npx wrangler login` once per machine, or set `CLOUDFLARE_API_TOKEN` in `.dev.vars` (gitignored)
- Build output: `dist/` (with `dist/_worker.js/index.js` as the Worker entry)

## Custom domain

Configured during `/anglesite:deploy` after the first publish. Stored in `.site-config` as `SITE_DOMAIN`.

### Domain options (handled during first `/anglesite:deploy`)

**Buy a new domain** — Cloudflare Registrar sells domains at cost (no markup). Search and purchase at `dash.cloudflare.com → Domains → Register`. Payment method required on Cloudflare account.

**Transfer an existing domain** — Move a domain from another registrar to Cloudflare. Requires: domain unlocked at current registrar, authorization/EPP code. Transfers extend registration by 1 year. Usually completes within hours, can take up to 5 days.

**Point an existing domain** — Keep the domain at its current registrar but use Cloudflare's nameservers for DNS. Add the domain via the Cloudflare dashboard and update nameservers at the current registrar. Propagation usually takes minutes, can take up to 48 hours.

### DNS management

DNS records are managed via the Cloudflare dashboard or `/anglesite:domain`. The owner is never asked to add, remove, or modify DNS records directly. The webmaster explains what will be done and why before each change, and confirms what was done after.

Typical configuration after domain is on Cloudflare:

- The Worker custom domain attaches a CNAME (or AAAA for an apex) to the Worker automatically when added under **Workers & Pages → your Worker → Domains & Routes → Add Custom Domain**
- SSL certificate: provisioned automatically (free)
- Email records (MX, SPF, DKIM, DMARC) added via `/anglesite:domain`
- Verification records (Bluesky, Google) added via `/anglesite:domain`

## Web Analytics

Cloudflare auto-injects the Web Analytics beacon for sites served by a Worker on a Cloudflare-managed domain. No additional configuration needed. Privacy-first: no cookies, no personal data collected.

Dashboard: `https://dash.cloudflare.com/?to=/:account/web-analytics`

## MCP

The Cloudflare MCP is provided by the Claude.ai built-in integration (claude.ai Cloudflare Developer Platform). No local `.mcp.json` needed — it's always available when using Claude Code with a claude.ai account.

## Staging previews

Workers don't auto-create per-branch previews. To preview changes before promoting them to production, use `wrangler versions upload` from a feature branch:

```sh
npx wrangler versions upload
```

Wrangler prints a preview URL of the form `https://<hash>-<project>.<account>.workers.dev`. Share that URL for review. When approved, run `npm run deploy` to promote.

Use previews for:

- First-time review before going live
- Testing major changes before publishing
- Showing the owner changes before they're public

## Rollback

If a deploy breaks something:

**Quick rollback via Cloudflare dashboard:**

1. Open the Cloudflare dashboard
2. Go to **Workers & Pages** → your Worker → **Deployments** (or **Versions**)
3. Find the last working deploy
4. Click **Rollback** (or **Promote** that version back to production)

This instantly reverts the live site. The broken code is still in git — you'll need to fix it and redeploy.

**Rollback via Wrangler CLI:**

```sh
npx wrangler rollback
```

Wrangler picks the previous deployment by default; pass `--version-id <id>` to roll back to a specific one.

**Rollback via git:**
If the issue is in a recent commit, use git revert on `draft`, redeploy, then mirror to `main` for backup parity:

```sh
git checkout draft
```

```sh
git revert HEAD
```

```sh
npm run deploy
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

**When to use which:**

- **Dashboard or `wrangler rollback`** — Immediate fix, site is down or broken, need it fixed in seconds
- **Git revert + `npm run deploy`** — The code change caused the issue, you want a clean history

## Security headers

Defined in `public/_headers`. Cloudflare Workers Static Assets honors `_headers` and `_redirects` files in the assets directory. Applied to all routes:

- `Content-Security-Policy` — only self + Cloudflare Insights
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — blocks camera, microphone, geolocation, payment, interest-cohort

## Troubleshooting

- **Deploy fails:** Run `npm run build` locally first to surface the error. Common: missing env binding in `wrangler.jsonc`, build error, missing dependency.
- **`wrangler deploy` says "not authenticated":** Run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` in your shell / `.dev.vars`.
- **Site not updating:** Cloudflare cache. Wait 1–2 minutes or purge cache in dashboard.
- **DNS not resolving:** Propagation can take up to 48 hours (usually minutes). Check nameserver configuration.
- **Domain transfer stuck:** Check email for transfer confirmation from previous registrar. Some registrars require manual approval.
- **SSL not working:** Cloudflare provisions SSL automatically. If it shows "pending", wait 15 minutes. Check that the domain's DNS is proxied (orange cloud icon in Cloudflare DNS settings).
- **CSP errors in console:** A script or style is loading from an unapproved domain. Check `_headers`.
- **`wrangler.jsonc` name mismatch:** The `name` field must match `CF_PROJECT_NAME` in `.site-config`. Update both if you rename the project.
- **Deploy aborts with "active Cloudflare account doesn't match":** The active account on this machine differs from `CLOUDFLARE_ACCOUNT_ID` in `.site-config`. `/anglesite:deploy` will offer to switch back automatically. To change the locked account intentionally, edit `CLOUDFLARE_ACCOUNT_ID` in `.site-config`.
- **Edge middleware not running:** This site runs on Cloudflare Workers Static Assets — the legacy `functions/_middleware.ts` directory is **not** invoked. Membership gates and A/B test variant assignment live in the Worker entry generated by `@astrojs/cloudflare` (or a custom Worker entry that wraps `env.ASSETS.fetch`). See `/anglesite:membership` and `/anglesite:experiment`.
