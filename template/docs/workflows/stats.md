# Site analytics

View your website analytics in plain language without visiting the Cloudflare dashboard.

## What it shows

- **Visitor count** with week-over-week trend (up or down)
- **Top pages** — which pages get the most traffic (last 24 hours on free plans)
- **Busiest day** — when your site gets the most traffic, with posting suggestions
- **Campaigns** — UTM-tagged links broken down by source/campaign

### Paid-plan extras

These require a paid Cloudflare plan and are skipped automatically on free zones:

- **Traffic sources** — referrer breakdown (Google, social media, direct)
- **Device breakdown** — mobile vs desktop percentages

Free Cloudflare zones gate referrer and device fields, and cap request-level analytics to a 1-day window. The skill uses daily roll-ups (`httpRequests1dGroups`) for the weekly visitor comparison so the report still works on free plans, and falls back to the most recent 24 hours for path/campaign drilldowns.

## Prerequisites

- Site deployed to Cloudflare Pages
- Cloudflare API token with Analytics read permission
- Zone ID for your domain (auto-detected if `SITE_DOMAIN` is set)

## Configuration

These values are saved to `.site-config` during first use:

| Key | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token (Analytics read) |
| `CF_ZONE_ID` | Cloudflare zone identifier for your domain |

## Actionable insights

Beyond raw numbers, the report suggests actions:

- Popular pages that haven't been updated recently
- Best days to publish new content
- Tips based on your traffic sources (SEO, social sharing)

## Full dashboard

For detailed charts and geographic data, visit:
`https://dash.cloudflare.com/?to=/:account/web-analytics`
