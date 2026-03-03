# Cloudflare

## Pages project

- Project name: stored in `.site-config` as `CF_PROJECT_NAME` (set during first `/anglesite:deploy`)
- Deploy command: `npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME`
- First deploy triggers OAuth in browser (Sign in with Apple)

## Custom domain

Configured during `/anglesite:deploy` after the first publish. Stored in `.site-config` as `SITE_DOMAIN`.

### Domain options (handled during first `/anglesite:deploy`)

**Buy a new domain** — Cloudflare Registrar sells domains at cost (no markup). Search and purchase at `dash.cloudflare.com → Domains → Register`. Payment method required on Cloudflare account.

**Transfer an existing domain** — Move a domain from another registrar to Cloudflare. Requires: domain unlocked at current registrar, authorization/EPP code. Transfers extend registration by 1 year. Usually completes within hours, can take up to 5 days.

**Point an existing domain** — Keep the domain at its current registrar but use Cloudflare's nameservers for DNS. Add the domain at `dash.cloudflare.com → Add a Site`, then update nameservers at the current registrar. Propagation usually takes minutes, can take up to 48 hours.

### DNS setup

Typical configuration after domain is on Cloudflare:
- CNAME `www` → `project-name.pages.dev` (auto-created when adding custom domain to Pages project)
- Root redirect: `example.com` → `www.example.com` (redirect rule in Cloudflare dashboard)
- SSL certificate: provisioned automatically (free)

## Web Analytics

Enabled on the Pages project. Cloudflare auto-injects the beacon script. No additional configuration needed. Privacy-first: no cookies, no personal data collected.

Dashboard: `https://dash.cloudflare.com/?to=/:account/web-analytics`

## MCP

The Cloudflare MCP is provided by the Claude.ai built-in integration (claude.ai Cloudflare Developer Platform). No local `.mcp.json` needed — it's always available when using Claude Code with a claude.ai account.

## Staging previews

Wrangler supports branch deploys. Deploy to a non-production branch to get a preview URL:

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME --branch preview
```

This creates `preview.CF_PROJECT_NAME.pages.dev`. The preview is not indexed by search engines and is separate from the production deploy.

Use previews for:
- First-time review before going live
- Testing major changes before publishing
- Showing the owner changes before they're public

## Rollback

If a deploy breaks something:

**Quick rollback via Cloudflare dashboard:**
1. Open the Cloudflare dashboard
2. Go to **Workers & Pages** → your project → **Deployments**
3. Find the last working deploy
4. Click **Rollback to this deploy**

This instantly reverts the live site. The broken code is still in git — you'll need to fix it and redeploy.

**Rollback via git:**
If the issue is in a recent commit, use git revert to undo it, then rebuild and redeploy:

```sh
git revert HEAD
```

```sh
npm run build
```

```sh
npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME
```

**When to use which:**
- **Dashboard rollback** — Immediate fix, site is down or broken, need it fixed in seconds
- **Git revert** — The code change caused the issue, you want a clean history

## Security headers

Defined in `public/_headers`. Applied to all routes:
- `Content-Security-Policy` — only self + Cloudflare Insights
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — blocks camera, microphone, geolocation, payment, interest-cohort

## Troubleshooting

- **Deploy fails:** Check `~/.anglesite/logs/deploy.log`. Common: Wrangler auth expired → `npx wrangler login`
- **Site not updating:** Cloudflare cache. Wait 1–2 minutes or purge cache in dashboard.
- **DNS not resolving:** Propagation can take up to 48 hours (usually minutes). Check nameserver configuration.
- **Domain transfer stuck:** Check email for transfer confirmation from previous registrar. Some registrars require manual approval.
- **SSL not working:** Cloudflare provisions SSL automatically. If it shows "pending", wait 15 minutes. Check that the domain's DNS is proxied (orange cloud icon in Cloudflare DNS settings).
- **CSP errors in console:** A script or style is loading from an unapproved domain. Check `_headers`.
