# Cloudflare

## Pages project

- Project name: `pairadocs-farm`
- Deploy command: `npx wrangler pages deploy dist/ --project-name pairadocs-farm`
- First deploy triggers OAuth in browser (Sign in with Apple)

## Custom domain

- Primary: `www.pairadocs.farm`
- DNS: CNAME `www` → `pairadocs-farm.pages.dev`
- Root redirect: `pairadocs.farm` → `www.pairadocs.farm` (Page Rule or redirect rule)

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

- **Deploy fails:** Check `~/.pairadocs/logs/deploy.log`. Common: Wrangler auth expired → `npx wrangler login`
- **Site not updating:** Cloudflare cache. Wait 1–2 minutes or purge cache in dashboard.
- **DNS not resolving:** CNAME propagation can take up to 48 hours (usually minutes).
- **CSP errors in console:** A script or style is loading from an unapproved domain. Check `_headers`.
