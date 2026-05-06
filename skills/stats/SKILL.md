---
name: stats
description: "Show site analytics in plain language"
allowed-tools: Bash(curl *), Bash(grep *), Bash(git log *), Write, Read, Glob
disable-model-invocation: true
---

Fetch Cloudflare analytics data and present it as a plain-language summary. No dashboard navigation required — the owner sees their numbers right here.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-pages-hosting.md) — why Cloudflare (includes free, cookieless analytics)
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics (auto-injected, privacy-respecting)

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Two data sources, one skill

Cloudflare exposes two unrelated analytics datasets and the skill must pick the right one. Mixing them up gives wrong numbers.

| Source | Dataset | Beacon? | Permission | Filter | Available when |
|---|---|---|---|---|---|
| **Web Analytics RUM** | `rumPageloadEventsAdaptiveGroups` | Yes (`static.cloudflareinsights.com/beacon.min.js`, auto-injected by Pages) | **Account → Analytics → Read** | `siteTag` + `accountTag` | Always, for any Pages-deployed Anglesite site |
| **Zone HTTP analytics** | `httpRequests1dGroups` / `httpRequestsAdaptiveGroups` | No — derived from edge logs | **Zone → Analytics → Read** | `zoneTag` | Only when the custom domain runs through Cloudflare DNS proxied (orange cloud) |

Default to Web Analytics RUM because every Anglesite site has the beacon auto-injected by Pages. Fall back to zone HTTP only when RUM is unreachable and a proxied zone exists.

When presenting numbers, always tell the owner which source they're seeing — the two datasets count different things and the totals will not match.

## Step 0 — Check prerequisites

Read `.env` for `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_WEB_ANALYTICS_SITE_TAG`, and (optional) `CF_ZONE_ID`.

### Token creation (one-time)

If `CF_API_TOKEN` is missing, guide the owner through creating one:

1. Tell them: "To see your analytics, I need a Cloudflare API token. Let's create one — it takes about a minute. We'll add two permissions so the token works whether your site uses Cloudflare's Web Analytics beacon (the default for Anglesite) or proxied DNS."
2. Open: `https://dash.cloudflare.com/profile/api-tokens`
3. Click "Create Token"
4. Use the "Custom token" template
5. Add **both** permissions:
   - **Account → Analytics → Read** — required for Web Analytics RUM (the default)
   - **Zone → Analytics → Read** — required only if the site uses proxied DNS on Cloudflare; safe to include either way
6. Account Resources: Include → (their Cloudflare account)
7. Zone Resources: Include → All zones from the same account (or the specific zone if known)
8. Click "Continue to summary" → "Create Token"
9. Copy the token and share it

Save to `.env` as `CF_API_TOKEN=token-value` using the Write tool (update or create the file). **Never save API tokens to `.site-config`** — that file is committed to git. `.env` is gitignored and stays local.

If the owner created an older token with only **Zone → Analytics → Read** (the previous version of this skill recommended that), they may see "Account → Analytics" errors below. Have them either edit the existing token to add the account-level permission, or create a new one.

### Account ID

If `CF_ACCOUNT_ID` is missing, fetch it:

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
```

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id'
```

If the API returns an `authz` error or an empty result, the token lacks account-level access — guide the owner to recreate it with Account → Analytics → Read (above).

Save to `.env` as `CF_ACCOUNT_ID=account-id`.

### Web Analytics site tag

If `CF_WEB_ANALYTICS_SITE_TAG` is missing, list the account's Web Analytics sites and pick the one whose host matches `SITE_DOMAIN` (or, if no custom domain is set yet, the Pages preview hostname).

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ACCOUNT_ID=$(grep CF_ACCOUNT_ID .env | cut -d= -f2)
SITE_DOMAIN=$(grep SITE_DOMAIN .site-config | cut -d= -f2)
```

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rum/site_info/list" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r --arg host "$SITE_DOMAIN" '.result[] | select(.host == $host) | .site_tag'
```

If the response is empty, the Pages project hasn't enabled Web Analytics yet. Tell the owner: "Cloudflare Web Analytics isn't enabled on your Pages project yet. Open `https://dash.cloudflare.com/?to=/:account/web-analytics`, click 'Add a site', pick the Pages project, and re-run `/anglesite:stats`." Do not proceed with RUM in this case — fall through to zone HTTP if available.

Save the site tag to `.env` as `CF_WEB_ANALYTICS_SITE_TAG=tag-value`.

### Zone ID (optional fallback)

If `CF_ZONE_ID` is missing, fetch it (only needed if the site uses proxied DNS on Cloudflare):

```sh
curl -s "https://api.cloudflare.com/client/v4/zones?name=$SITE_DOMAIN" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id'
```

If empty, the domain isn't a Cloudflare-managed zone. That's fine — Web Analytics RUM doesn't need a zone. Skip this step.

Save to `.env` as `CF_ZONE_ID=zone-id` if present.

## Step 1 — Choose the data source

Determine which dataset to query. In order of preference:

1. **Web Analytics RUM** — use this if `CF_WEB_ANALYTICS_SITE_TAG` and `CF_ACCOUNT_ID` are both set.
2. **Zone HTTP analytics** — fall back to this if RUM is unavailable and `CF_ZONE_ID` is set.
3. **Neither available** — explain to the owner: "I couldn't reach either Cloudflare analytics dataset. Your Pages project either doesn't have Web Analytics enabled yet or the API token is missing the right permission. Run `/anglesite:check` and revisit Step 0 above."

Set a `STATS_SOURCE` variable in memory (not on disk) — `web-analytics` or `zone-http` — and use it to select the right query and the right summary label below.

## Step 2A — Fetch via Web Analytics RUM (default)

Skip this section if `STATS_SOURCE` is `zone-http`.

The Web Analytics RUM dataset is the JS-beacon source: each row corresponds to a beacon hit from a real browser. It does **not** double-count bots, asset requests, or non-HTML responses, so the page-view counts come out clean without a content-type filter.

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ACCOUNT_ID=$(grep CF_ACCOUNT_ID .env | cut -d= -f2)
CF_WEB_ANALYTICS_SITE_TAG=$(grep CF_WEB_ANALYTICS_SITE_TAG .env | cut -d= -f2)
```

### Query A (RUM) — weekly comparison (last 14 days, daily roll-ups)

Replace `DATE_START_PREV` with 14 days ago and `DATE_END_CURR` with today (ISO `YYYY-MM-DD`).

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { accounts(filter: {accountTag: \"'$CF_ACCOUNT_ID'\"}) { rumPageloadEventsAdaptiveGroups(filter: {siteTag: \"'$CF_WEB_ANALYTICS_SITE_TAG'\", date_geq: \"DATE_START_PREV\", date_leq: \"DATE_END_CURR\"}, limit: 14, orderBy: [date_ASC]) { count sum { visits } dimensions { date } } } } }"}'
```

`count` is page views (beacon hits). `sum.visits` is sessions (≈ unique visitors for a week-long window). Split rows by date: `date >= today - 7` is the current week; the earlier 7 are the previous week.

### Query B (RUM) — top paths (last 7 days)

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { accounts(filter: {accountTag: \"'$CF_ACCOUNT_ID'\"}) { rumPageloadEventsAdaptiveGroups(filter: {siteTag: \"'$CF_WEB_ANALYTICS_SITE_TAG'\", date_geq: \"DATE_START_CURR\", date_leq: \"DATE_END_CURR\"}, limit: 100, orderBy: [count_DESC]) { count dimensions { requestPath } } } } }"}'
```

Replace `DATE_START_CURR` with 7 days ago and `DATE_END_CURR` with today.

### Query C (RUM) — referrers and devices (last 7 days, optional)

These dimensions are part of the standard Web Analytics RUM dataset on the free plan. If the response returns an `authz` error, skip the section.

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { accounts(filter: {accountTag: \"'$CF_ACCOUNT_ID'\"}) { rumPageloadEventsAdaptiveGroups(filter: {siteTag: \"'$CF_WEB_ANALYTICS_SITE_TAG'\", date_geq: \"DATE_START_CURR\", date_leq: \"DATE_END_CURR\"}, limit: 50, orderBy: [count_DESC]) { count dimensions { refererHost deviceType } } } } }"}'
```

### Graceful degradation (RUM)

Inspect the JSON response for an `errors[]` array before parsing. If the message contains `does not have access`, `authz`, or `siteTag`, switch `STATS_SOURCE` to `zone-http` and try Step 2B. If that also fails, fall back to the "Neither available" branch in Step 1.

## Step 2B — Fetch via zone HTTP analytics (fallback)

Skip this section if `STATS_SOURCE` is `web-analytics` and Step 2A succeeded.

The zone HTTP dataset is derived from edge logs and exists only when the custom domain is on Cloudflare proxied DNS. Free Cloudflare zones gate several fields and cap the adaptive dataset to a 1-day window, so split the work across two datasets:

- **`httpRequests1dGroups`** — daily roll-ups (page views, requests, unique visitors). Available on free plans, supports multi-day ranges. Use this for the 7-day weekly comparison and busiest-day calculation.
- **`httpRequestsAdaptiveGroups`** — request-level drilldowns. On free plans this is capped to a 1-day time range, so use it only for the most recent 24 hours to derive top paths.

Referrer host (`clientRefererHost`), URL query string (`clientRequestQuery`), and device-class fields are **paid-only** on Cloudflare. Don't include them in the default query — if the owner is on a paid plan, see "Paid-plan extras" below.

**UTM/campaign breakdown is not available on free plans of the zone dataset.** `clientRequestPath` is the path *without* the query string, so UTM parameters can't be extracted from it. The `clientRequestQuery` dimension is paid-only, and the most reliable UTM-level data comes from raw HTTP logs (Enterprise) or from server-side redirect counters. Only attempt campaign breakdown if the owner is on a paid plan — see "Paid-plan extras" below. (RUM, by contrast, has its own campaign data via the beacon; not covered here.)

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ZONE_ID=$(grep CF_ZONE_ID .env | cut -d= -f2)
```

### Query A (zone) — weekly comparison (last 14 days, daily roll-ups)

Replace `DATE_START_PREV` with 14 days ago and `DATE_END_CURR` with today (ISO `YYYY-MM-DD`).

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequests1dGroups(filter: {date_geq: \"DATE_START_PREV\", date_leq: \"DATE_END_CURR\"}, limit: 14, orderBy: [date_ASC]) { dimensions { date } sum { pageViews requests } uniq { uniques } } } } }"}'
```

Split the results: rows with `date >= today - 7` are the current week; the earlier 7 are the previous week.

### Query B (zone) — top paths (most recent day)

Replace `DATE_TODAY` with today's ISO date. Keep the range to a single day so the query stays inside the free-plan limit.

The filter narrows results to HTML responses so `count` approximates page views per path. Without this filter, `httpRequestsAdaptiveGroups.count` aggregates every HTTP request — assets, bots, redirects, error responses — and can be 5–10× higher than the page-view count on a static site, so it must not be presented as "visits" or "page views".

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date: \"DATE_TODAY\", edgeResponseContentTypeName: \"html\", edgeResponseStatus_lt: 400}, limit: 100, orderBy: [count_DESC]) { count dimensions { clientRequestPath } } } } }"}'
```

### Graceful degradation (zone)

Inspect the JSON response for an `errors[]` array before parsing. If any error message contains `authz`, `does not have access`, or `time range wider than`, drop that section from the output and continue with the data you do have. Don't surface the raw error to the owner — note in the summary that the section requires a paid Cloudflare plan (for referrer/device) or a longer history (for the adaptive window).

### Paid-plan extras (zone, optional)

Only attempt these if the owner has confirmed a paid Cloudflare plan. Add `clientRefererHost`, `userAgentBrowser`, and/or `clientRequestQuery` dimensions to Query B. If the response returns an `authz` error, fall back to the default query above.

For campaign breakdown specifically, run a separate query that groups by `clientRequestQuery` and filters to rows where the query string contains `utm_`:

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date: \"DATE_TODAY\", edgeResponseContentTypeName: \"html\", edgeResponseStatus_lt: 400, clientRequestQuery_like: \"%utm_%\"}, limit: 100, orderBy: [count_DESC]) { count dimensions { clientRequestPath clientRequestQuery } } } } }"}'
```

If the response returns an `authz` error or the field is rejected, the owner's plan tier doesn't expose `clientRequestQuery` — skip the campaign section entirely.

## Step 3 — Parse and summarize

These three numbers measure different things and must not be substituted for one another:

- **Unique visitors** — `uniq.uniques` (zone) or `sum.visits` (RUM, sessions ≈ unique visitors for week-long windows). The number of distinct people.
- **Page views** — `sum.pageViews` (zone) / `count` (RUM, beacon hits) / `count` from `httpRequestsAdaptiveGroups` *when filtered to HTML responses* (zone Query B). One person can generate many page views.
- **Requests** *(zone only)* — raw `count` from `httpRequestsAdaptiveGroups` with no content-type filter. Includes every asset, redirect, bot hit, and error response. Don't surface this as "visitors" or "views"; only mention it explicitly as "requests" when relevant. RUM has no equivalent — the beacon only fires on HTML pageloads.

From the responses, extract:

1. **Unique visitors** — RUM: sum `sum.visits` across each 7-day window. Zone: sum `uniq.uniques` across each 7-day window.
2. **Page views** — RUM: sum `count` from Query A across each 7-day window. Zone: sum `sum.pageViews` from Query A across each 7-day window. Report alongside visitors; don't conflate the two.
3. **Busiest day** — from Query A, map each `dimensions.date` (ISO date) to its weekday name, take the day with the highest page views in the current week. Label the figure as "page views" (not "visits" or "visitors").
4. **Top pages** — RUM: from Query B, group by `requestPath`, sum `count`, sort descending, take top 5. Note in the summary that this reflects the last 7 days. Zone: from Query B (HTML-filtered), group by `clientRequestPath`, sum `count`, sort descending, take top 5. Note in the summary that this reflects the most recent 24 hours (free-plan limitation).
5. **Referral sources** — RUM: from Query C, group by `refererHost`, rename common ones (e.g., `google.com` → "Google Search", empty → "Direct"). Zone *(paid only)*: group by `clientRefererHost`. Skip on zone free plans.
6. **Device breakdown** — RUM: from Query C, group by `deviceType`. Zone *(paid only)*: group by `userAgentBrowser`. Skip on zone free plans.
7. **Campaign breakdown** *(zone paid only)* — from the `clientRequestQuery` query above, parse each query string for `utm_source`, `utm_medium`, `utm_campaign`. `clientRequestPath` does not include query strings, so this section is impossible on zone free plans — skip it there. RUM exposes campaign dimensions via the beacon but they are not covered by this skill yet — skip on RUM.

Present the summary in plain language. **Always begin with a one-line note that names the data source.** Example output (Web Analytics RUM, free plan):

> *Source: Cloudflare Web Analytics beacon (last 7 days vs the 7 before).*
>
> Your site had **142 unique visitors** and **318 page views** this week (visitors up 23%, page views up 31% from last week).
>
> **Top pages** (last 7 days, beacon page views):
> 1. /services — 58 page views
> 2. / — 45 page views
> 3. /about — 30 page views
>
> **Busiest day:** Tuesday with 65 page views. Consider posting new content on Monday to catch the wave.
>
> **Top referrers:** Google Search (42), Direct (28), bsky.app (12).

Example output (zone HTTP analytics, free plan):

> *Source: Cloudflare zone HTTP logs (proxied DNS edge data). Numbers will not match the Web Analytics dashboard.*
>
> Your site had **142 unique visitors** and **318 page views** this week (visitors up 23%, page views up 31% from last week).
>
> **Top pages** (last 24 hours, HTML page views):
> 1. /services — 58 page views
> 2. / — 45 page views
> 3. /about — 30 page views
>
> **Busiest day:** Tuesday with 65 page views. Consider posting new content on Monday to catch the wave.
>
> *Referrer, device, and campaign (UTM) breakdowns require a paid Cloudflare plan on the zone dataset, or switching to the Web Analytics beacon.*

## Presentation

After collecting the data, present results as a clean markdown summary:

- **Source line** — italic, single sentence, names the dataset (`Web Analytics beacon` or `zone HTTP logs`). Always first.
- **Top pages** — markdown table with page path and page-view count (and optional bar made of `█` characters proportional to page views, e.g. `████████ 240`). Header the count column "Page views", not "Visits".
- **Campaign performance** *(zone paid only)* — second markdown table if `clientRequestQuery` data is available, also in page views. Skip otherwise.
- **Plain-language summary** — 2–3 sentences explaining what the numbers mean. When you cite a headline figure, say which one (visitors vs page views) — they tell different stories.

Lead with the source line and the table, then the summary and actionable suggestions.

## Step 4 — Actionable suggestions

After presenting the summary, check for opportunities:

1. **Stale popular pages** — For each top page, check when it was last modified:

```sh
git log -1 --format="%ar" -- src/pages/PAGE.astro
```

If a top page hasn't been updated in more than 30 days, suggest: "Your /services page is your most popular but hasn't been updated in 45 days — worth a refresh?"

2. **Content timing** — Based on the busiest day, suggest when to publish: "Most page views land on Tuesday — consider publishing new posts on Monday evening." Use "page views" here, not "visitors" — the busiest-day figure is page views, not unique visitors.

3. **Traffic source tips** — If Google Search is the top referrer, mention SEO. If Direct dominates, suggest sharing the URL on social media.

## Step 5 — Offer the dashboard

After showing the summary, remind the owner they can see more detail in the Cloudflare dashboard:

"For more detailed charts, visit your analytics dashboard:"

- Web Analytics: `https://dash.cloudflare.com/?to=/:account/web-analytics`
- Zone analytics (only if you used `zone-http`): `https://dash.cloudflare.com/?to=/:account/:zone/analytics/traffic`

Tell them: "The dashboard shows trends over time, geographic data, and more. But for a quick check-in, just run this command anytime."
