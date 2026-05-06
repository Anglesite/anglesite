---
name: stats
description: "Show site analytics in plain language"
allowed-tools: Bash(curl *), Bash(grep *), Bash(git log *), Write, Read, Glob
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

Query the Cloudflare GraphQL Analytics API. Free Cloudflare zones gate several fields and cap the adaptive dataset to a 1-day window, so split the work across two datasets:

- **`httpRequests1dGroups`** — daily roll-ups (page views, requests, unique visitors). Available on free plans, supports multi-day ranges. Use this for the 7-day weekly comparison and busiest-day calculation.
- **`httpRequestsAdaptiveGroups`** — request-level drilldowns. On free plans this is capped to a 1-day time range, so use it only for the most recent 24 hours to derive top paths.

Referrer host (`clientRefererHost`), URL query string (`clientRequestQuery`), and device-class fields are **paid-only** on Cloudflare. Don't include them in the default query — if the owner is on a paid plan, see "Paid-plan extras" below.

**UTM/campaign breakdown is not available on free plans.** `clientRequestPath` is the path *without* the query string, so UTM parameters can't be extracted from it. The `clientRequestQuery` dimension is paid-only, and the most reliable UTM-level data comes from raw HTTP logs (Enterprise) or from server-side redirect counters. Only attempt campaign breakdown if the owner is on a paid plan — see "Paid-plan extras" below.

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ZONE_ID=$(grep CF_ZONE_ID .env | cut -d= -f2)
```

### Query A — weekly comparison (last 14 days, daily roll-ups)

Replace `DATE_START_PREV` with 14 days ago and `DATE_END_CURR` with today (ISO `YYYY-MM-DD`).

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequests1dGroups(filter: {date_geq: \"DATE_START_PREV\", date_leq: \"DATE_END_CURR\"}, limit: 14, orderBy: [date_ASC]) { dimensions { date } sum { pageViews requests } uniq { uniques } } } } }"}'
```

Split the results: rows with `date >= today - 7` are the current week; the earlier 7 are the previous week.

### Query B — top paths (most recent day)

Replace `DATE_TODAY` with today's ISO date. Keep the range to a single day so the query stays inside the free-plan limit.

The filter narrows results to HTML responses so `count` approximates page views per path. Without this filter, `httpRequestsAdaptiveGroups.count` aggregates every HTTP request — assets, bots, redirects, error responses — and can be 5–10× higher than the page-view count on a static site, so it must not be presented as "visits" or "page views".

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date: \"DATE_TODAY\", edgeResponseContentTypeName: \"html\", edgeResponseStatus_lt: 400}, limit: 100, orderBy: [count_DESC]) { count dimensions { clientRequestPath } } } } }"}'
```

### Query C — country breakdown (most recent day)

Replace `DATE_TODAY` with today's ISO date. Same single-day window as Query B. The country breakdown lets the owner self-diagnose datacenter/bot inflation in the unique-visitor count — small sites often see Hetzner Frankfurt (DE), AWS/Hetzner Dublin (IE), OVH, Vultr Singapore (SG), and Tor (T1) dominate the geography.

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date: \"DATE_TODAY\", edgeResponseContentTypeName: \"html\", edgeResponseStatus_lt: 400}, limit: 25, orderBy: [count_DESC]) { count dimensions { clientCountryName } } } } }"}'
```

### Graceful degradation

Inspect the JSON response for an `errors[]` array before parsing. If any error message contains `authz`, `does not have access`, or `time range wider than`, drop that section from the output and continue with the data you do have. Don't surface the raw error to the owner — note in the summary that the section requires a paid Cloudflare plan (for referrer/device) or a longer history (for the adaptive window).

### Paid-plan extras (optional)

Only attempt these if the owner has confirmed a paid Cloudflare plan. Add `clientRefererHost`, `userAgentBrowser`, and/or `clientRequestQuery` dimensions to Query B. If the response returns an `authz` error, fall back to the default query above.

For campaign breakdown specifically, run a separate query that groups by `clientRequestQuery` and filters to rows where the query string contains `utm_`:

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date: \"DATE_TODAY\", edgeResponseContentTypeName: \"html\", edgeResponseStatus_lt: 400, clientRequestQuery_like: \"%utm_%\"}, limit: 100, orderBy: [count_DESC]) { count dimensions { clientRequestPath clientRequestQuery } } } } }"}'
```

If the response returns an `authz` error or the field is rejected, the owner's plan tier doesn't expose `clientRequestQuery` — skip the campaign section entirely.

## Step 2 — Parse and summarize

These three numbers measure different things and must not be substituted for one another:

- **Unique visitors** — `uniq.uniques` from `httpRequests1dGroups`. The number of distinct IP+UA pairs Cloudflare saw. **This includes datacenter ranges (Hetzner, AWS, OVH, Vultr) and bots that did not get blocked at the edge**, so on small personal sites it can overstate human readers by 50–100%. Always present it with the caveat in the summary, and lead with page views when both are available.
- **Page views** — `sum.pageViews` from `httpRequests1dGroups`, or `count` from `httpRequestsAdaptiveGroups` *when filtered to HTML responses* (Query B). One person can generate many page views. Less inflated by bots than uniques because most non-rendering scrapers don't request many distinct HTML pages.
- **Requests** — raw `count` from `httpRequestsAdaptiveGroups` with no content-type filter. Includes every asset, redirect, bot hit, and error response. Don't surface this as "visitors" or "views"; only mention it explicitly as "requests" when relevant.

From the responses, extract:

1. **Unique visitors** — from Query A, sum `uniq.uniques` across the 7 most recent days for the current week, and across the 7 days before for the previous week.
2. **Page views** — from Query A, sum `sum.pageViews` across each 7-day window. Report alongside visitors; don't conflate the two.
3. **Busiest day** — from Query A, map each `dimensions.date` (ISO date) to its weekday name, take the day with the highest `sum.pageViews` in the current week. Label the figure as "page views" (not "visits" or "visitors").
4. **Top pages** — from Query B (HTML-filtered), group rows by `clientRequestPath`, sum `count`, sort descending, take top 5. Label the figure as "page views". Note in the summary that this reflects the most recent 24 hours (free-plan limitation).
5. **Country breakdown** — from Query C, take top 8 countries by `count`. Mark the following as `(datacenter-heavy)` so the owner can spot bot inflation: `IE` (Dublin — Hetzner/AWS), `DE` (Frankfurt — Hetzner), `NL` (Amsterdam — OVH/Hetzner), `SG` (Vultr/DigitalOcean), `FI` (Hetzner Helsinki), `T1` or `XX` (Tor exit nodes), and any country whose share looks disproportionate to the site's audience (e.g., `CN` on an English-language local-business site). Use the country code as returned by Cloudflare; map common ones to readable names (`US` → "United States", etc.) when presenting.
6. **Referral sources** *(paid plans only)* — group by `clientRefererHost`, rename common ones (e.g., `google.com` → "Google Search", empty → "Direct"). Skip entirely on free plans.
7. **Device breakdown** *(paid plans only)* — group by `userAgentBrowser` or device class. Skip entirely on free plans.
8. **Campaign breakdown** *(paid plans only)* — from the `clientRequestQuery` query above, parse each query string for `utm_source`, `utm_medium`, `utm_campaign`. Group by `utm_source`/`utm_campaign`, label each entry as `{source} "{campaign}"`, and sort by page-view count descending. `clientRequestPath` does **not** include query strings, so this section is impossible on free plans — skip it there.

Present the summary in plain language. Example output (free plan):

> Your site drew **318 page views** this week (up 31% from last week), from **142 unique IPs** (up 23%).
>
> *Heads up — Cloudflare counts every distinct IP as a "unique visitor", which sweeps in datacenter traffic (Hetzner, AWS, OVH) and bots that don't get blocked at the edge. On small sites the real human-reader count is usually 50–60% of the unique number. Use page views as the more reliable signal and check the country breakdown below.*
>
> **Top pages** (last 24 hours, HTML page views):
> 1. /services — 58 page views
> 2. / — 45 page views
> 3. /about — 30 page views
>
> **Top countries** (last 24 hours, HTML page views):
> 1. United States — 1,248
> 2. Ireland — 358 *(datacenter-heavy)*
> 3. Germany — 349 *(datacenter-heavy)*
> 4. China — 190
> 5. Tor — 124 *(datacenter-heavy)*
>
> **Busiest day:** Tuesday with 65 page views. Consider posting new content on Monday to catch the wave.
>
> *Referrer, device, and campaign (UTM) breakdowns require a paid Cloudflare plan.*

## Presentation

After collecting the data, present results as a clean markdown summary:

- **Top pages** — markdown table with page path and page-view count (and optional bar made of `█` characters proportional to page views, e.g. `████████ 240`). Header the count column "Page views", not "Visits".
- **Top countries** — markdown table with country name and page-view count. Append `(datacenter-heavy)` to known datacenter-dominant origins (see Step 2 item 5).
- **Campaign performance** *(paid plans only)* — markdown table if `clientRequestQuery` data is available, also in page views. Skip on free plans.
- **Bot/datacenter caveat** — always include the one-line heads-up about unique-visitor inflation when reporting `uniq.uniques` on a free plan. Don't skip it on the assumption that the site is large; the owner is rarely in a position to know.
- **Plain-language summary** — 2–3 sentences explaining what the numbers mean. When you cite a headline figure, say which one (visitors vs page views) — they tell different stories. Lead with page views when both are available.

Lead with the table, follow with the summary and actionable suggestions.

## Step 3 — Actionable suggestions

After presenting the summary, check for opportunities:

1. **Stale popular pages** — For each top page, check when it was last modified:

```sh
git log -1 --format="%ar" -- src/pages/PAGE.astro
```

If a top page hasn't been updated in more than 30 days, suggest: "Your /services page is your most popular but hasn't been updated in 45 days — worth a refresh?"

2. **Content timing** — Based on the busiest day, suggest when to publish: "Most page views land on Tuesday — consider publishing new posts on Monday evening." Use "page views" here, not "visitors" — the busiest-day figure is `sum.pageViews`, not `uniq.uniques`.

3. **Traffic source tips** — If Google Search is the top referrer, mention SEO. If Direct dominates, suggest sharing the URL on social media.

## Step 4 — Offer the dashboard

After showing the summary, remind the owner they can see more detail in the Cloudflare dashboard:

"For more detailed charts, visit your analytics dashboard:"

Read `CF_PROJECT_NAME` from `.site-config` if available, and provide:
`https://dash.cloudflare.com/?to=/:account/web-analytics`

Tell them: "The dashboard shows trends over time, geographic data, and more. But for a quick check-in, just run this command anytime."
