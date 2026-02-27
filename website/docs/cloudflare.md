# Cloudflare

## Pages project

- Project name: stored in `.site-config` as `CF_PROJECT_NAME` (set during first `/deploy`)
- Deploy command: `npx wrangler pages deploy dist/ --project-name CF_PROJECT_NAME`
- First deploy triggers OAuth in browser (Sign in with Apple)

## Custom domain

Configured during `/deploy` after the first publish. Stored in `.site-config` as `SITE_DOMAIN`.

Typical setup:
- Primary: `www.example.com`
- DNS: CNAME `www` → `project-name.pages.dev`
- Root redirect: `example.com` → `www.example.com` (redirect rule)

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
- **DNS not resolving:** CNAME propagation can take up to 48 hours (usually minutes).
- **CSP errors in console:** A script or style is loading from an unapproved domain. Check `_headers`.
