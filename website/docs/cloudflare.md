# Cloudflare

## Pages project

- Project name: stored in `.site-config` as `CF_PROJECT_NAME` (set during first `/deploy`)
- Deploy command: `npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME`
- First deploy triggers OAuth in browser (Sign in with Apple)

## Custom domain

Configured during `/deploy` after the first publish. Stored in `.site-config` as `SITE_DOMAIN`.

### Domain options (handled during first `/deploy`)

**Buy a new domain** — Cloudflare Registrar sells domains at cost (no markup). Search and purchase at `dash.cloudflare.com → Domains → Register`. Payment method required on Cloudflare account.

**Transfer an existing domain** — Move a domain from another registrar to Cloudflare. Requires: domain unlocked at current registrar, authorization/EPP code. Transfers extend registration by 1 year. Usually completes within hours, can take up to 5 days.

**Point an existing domain** — Keep the domain at its current registrar but use Cloudflare's nameservers for DNS. Add the domain at `dash.cloudflare.com → Add a Site`, then update nameservers at the current registrar. Propagation usually takes minutes, can take up to 48 hours.

### DNS setup

Typical configuration after domain is on Cloudflare:
- CNAME `www` → `project-name.pages.dev` (auto-created when adding custom domain to Pages project)
- Root redirect: `example.com` → `www.example.com` (redirect rule in Cloudflare dashboard)
- SSL certificate: provisioned automatically (free)

### Email DNS (added during `/setup-email`)

- MX records pointing to iCloud mail servers
- TXT record for SPF
- CNAME records for DKIM

## Web Analytics

Enabled on the Pages project. Cloudflare auto-injects the beacon script. No additional configuration needed. Privacy-first: no cookies, no personal data collected.

Dashboard: `https://dash.cloudflare.com/?to=/:account/web-analytics`

## MCP

The Cloudflare MCP is provided by the Claude.ai built-in integration (claude.ai Cloudflare Developer Platform). No local `.mcp.json` needed — it's always available when using Claude Code with a claude.ai account.

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
