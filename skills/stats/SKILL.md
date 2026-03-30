---
name: stats
description: "Show site analytics in plain language"
allowed-tools: Bash(curl *), Bash(grep *), Bash(git log *), mcp__claude_ai_tldraw__create_shapes, mcp__claude_ai_tldraw__diagram_drawing_read_me, Read, Glob
disable-model-invocation: true
---

Fetch Cloudflare Web Analytics data and present it as a plain-language summary. No dashboard navigation required — the owner sees their numbers right here.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-pages-hosting.md) — why Cloudflare (includes free, cookieless analytics)
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics (auto-injected, privacy-respecting)

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.env` for `CF_API_TOKEN` and `CF_ZONE_ID`.

If `CF_API_TOKEN` is missing, guide the owner through creating one:

1. Tell them: "To see your analytics, I need a Cloudflare API token. Let's create one — it takes about a minute."
2. Open: `https://dash.cloudflare.com/profile/api-tokens`
3. Click "Create Token"
4. Use the "Custom token" template
5. Permissions: Zone → Analytics → Read
6. Zone Resources: Include → Specific zone → (their domain)
7. Click "Continue to summary" → "Create Token"
8. Copy the token and share it

Save to `.env` as `CF_API_TOKEN=token-value` using the Write tool (update or create the file). **Never save API tokens to `.site-config`** — that file is committed to git. `.env` is gitignored and stays local.

If `CF_ZONE_ID` is missing, fetch it:

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
```

```sh
curl -s "https://api.cloudflare.com/client/v4/zones?name=$(grep SITE_DOMAIN .site-config | cut -d= -f2)" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id'
```

Save to `.env` as `CF_ZONE_ID=zone-id`.

## Step 1 — Fetch analytics data

Query the Cloudflare GraphQL Analytics API for the last 7 days and the 7 days before that (for comparison).

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ZONE_ID=$(grep CF_ZONE_ID .env | cut -d= -f2)
```

Current week (replace DATE_START and DATE_END with actual ISO dates):

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date_geq: \"DATE_START\", date_leq: \"DATE_END\"}, limit: 100, orderBy: [count_DESC]) { count dimensions { date clientRequestPath refererHost device } } } } }"}'
```

Previous week (7 days before DATE_START):

Run the same query with the previous week's date range for comparison.

## Step 2 — Parse and summarize

From the API response, extract:

1. **Total visitors** — sum of unique visits for current and previous periods
2. **Top pages** — group by `clientRequestPath`, sort by count, take top 5
3. **Referral sources** — group by `refererHost`, rename common ones (e.g., "google.com" → "Google Search", empty → "Direct")
4. **Device breakdown** — group by `device` type, calculate percentages
5. **Busiest day** — group by `date`, map to day names, find the highest
6. **Campaign breakdown** — group by UTM parameters (`clientRequestPath` query string contains `utm_source`, `utm_medium`, `utm_campaign`). Extract these from pages with UTM params in the URL. Use `formatCampaigns()` from `scripts/analytics-summary.ts`.

Present the summary in plain language. Example output:

> Your site had **142 visitors** this week (up 23% from last week).
>
> **Top pages:**
> 1. /services — 58 views
> 2. / — 45 views
> 3. /about — 30 views
>
> **Traffic sources:**
> - Google Search: 80 visits
> - Direct: 40 visits
> - Facebook: 20 visits
>
> **Devices:** mobile: 67%, desktop: 33%.
>
> **Busiest day:** Tuesday with 30 visits. Consider posting new content on Monday to catch the wave.
>
> **Campaigns:**
> - QR code "table-tent": 23 visits
> - facebook ad "march-promo": 45 visits
> - Email "weekly-update" via newsletter: 12 visits

## Visual presentation

After collecting the data, **draw the results** using tldraw before presenting text:

- Use `barChart()` from `scripts/tldraw-helpers.ts` to show top pages as a horizontal bar chart
- If campaign data exists, draw a second bar chart for campaign performance
- The owner sees their numbers as a visual dashboard, not a wall of text

Show the visual first, then follow up with the plain-language summary and actionable suggestions.

## Step 3 — Actionable suggestions

After presenting the summary, check for opportunities:

1. **Stale popular pages** — For each top page, check when it was last modified:

```sh
git log -1 --format="%ar" -- src/pages/PAGE.astro
```

If a top page hasn't been updated in more than 30 days, suggest: "Your /services page is your most popular but hasn't been updated in 45 days — worth a refresh?"

2. **Content timing** — Based on the busiest day, suggest when to publish: "Most visitors come on Tuesday — consider publishing new posts on Monday evening."

3. **Traffic source tips** — If Google Search is the top referrer, mention SEO. If Direct dominates, suggest sharing the URL on social media.

## Step 4 — Offer the dashboard

After showing the summary, remind the owner they can see more detail in the Cloudflare dashboard:

"For more detailed charts, visit your analytics dashboard:"

Read `CF_PROJECT_NAME` from `.site-config` if available, and provide:
`https://dash.cloudflare.com/?to=/:account/web-analytics`

Tell them: "The dashboard shows trends over time, geographic data, and more. But for a quick check-in, just run this command anytime."
