# Site analytics

View your website analytics in plain language without visiting the Cloudflare dashboard.

## What it shows

- **Visitor count** with week-over-week trend (up or down)
- **Top pages** — which pages get the most traffic
- **Traffic sources** — where visitors come from (Google, social media, direct)
- **Device breakdown** — mobile vs desktop percentages
- **Busiest day** — when your site gets the most traffic, with posting suggestions

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
