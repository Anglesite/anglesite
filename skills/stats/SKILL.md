---
name: stats
description: "Show site analytics in plain language"
allowed-tools: Bash(curl *), Bash(grep *), Bash(git log *), Bash(cat perf-trend.json), Write, Edit, Read, Glob
disable-model-invocation: true
---

Fetch Cloudflare analytics data and present it as a plain-language summary. No dashboard navigation required — the owner sees their numbers right here.

## Architecture decisions

- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — why Cloudflare (includes free, cookieless analytics)
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — why only Cloudflare Analytics (privacy-respecting, injected by the Anglesite layouts when `CF_WEB_ANALYTICS_TOKEN` is set in `.site-config`)

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Traffic analytics vs. ad-attribution pixels

This skill answers "how is my site doing?" using **Cloudflare Web Analytics** — the cookieless beacon already wired into the layouts. Web Analytics counts page views, sessions, top pages, referrers, and devices; it does not attribute paid-ad conversions back to specific campaigns.

If the owner asks about ad-platform numbers ("how is my Facebook campaign doing?", "did my Google Ads convert?"), that's a different surface. Direct them to `/anglesite:tracking` to install the right pixel — Meta Pixel, Google Ads, GA4, LinkedIn Insight, TikTok, Pinterest, or X — and to read each campaign's numbers in that platform's own dashboard. The two sources count different things:

- **Cloudflare Web Analytics** — every visitor's pageview, on every page. Privacy-respecting, cookieless, no opt-in needed. Reported here.
- **Ad-platform pixels** — conversion events tied to ad-spend. Cookie-based, opt-in via the consent banner in regulated regions. Reported in each ad platform.

Don't recommend installing tracking pixels just to see traffic numbers — they make the site heavier and they're unnecessary if the owner only wants visitor counts.

## Three data sources, one skill

Cloudflare exposes three unrelated analytics datasets and the skill must pick the right one for each section. Mixing them up gives wrong numbers.

| Source | Dataset | Beacon? | Permission | Filter | Available when |
|---|---|---|---|---|---|
| **Web Analytics RUM** | `rumPageloadEventsAdaptiveGroups` | Yes (`static.cloudflareinsights.com/beacon.min.js`, injected by `BaseLayout`/`KioskLayout`/`ImmersiveLayout` when `CF_WEB_ANALYTICS_TOKEN` is set in `.site-config`) | **Account → Analytics → Read** | `siteTag` + `accountTag` | After the owner enables Web Analytics for the site and the token is written to `.site-config` (this skill walks them through it on first run) |
| **Zone HTTP analytics** | `httpRequests1dGroups` / `httpRequestsAdaptiveGroups` | No — derived from edge logs | **Zone → Analytics → Read** | `zoneTag` | Only when the custom domain runs through Cloudflare DNS proxied (orange cloud) |
| **Anglesite events (Analytics Engine)** | `anglesite_events` | No — written from helper Workers | **Account → Analytics Engine → Read** | `dataset='anglesite_events'`, optionally `index1=<site domain>` | When at least one helper Worker (contact, forms, membership, review, subscribe, ecommerce) is deployed |

Default to Web Analytics RUM for traffic once the token is wired up — it's the more accurate dataset and works regardless of DNS setup. The Anglesite layouts emit the beacon `<script>` whenever `CF_WEB_ANALYTICS_TOKEN` is present in `.site-config`. Fall back to zone HTTP only when RUM is unreachable and a proxied zone exists. The `anglesite_events` dataset is independent of both — it surfaces *conversions* (form submits, signups, unlocks) and is queried alongside the traffic source.

When presenting numbers, always tell the owner which source they're seeing — the datasets count different things and the totals will not match.

## The `anglesite_events` dataset

The Anglesite helper Workers write a standard data point on every meaningful event:

```js
env.ANALYTICS.writeDataPoint({
  blobs: [workerName, eventType, formName, outcome],
  doubles: [1],
  indexes: [siteDomain],
});
```

| Field | Purpose | Example values |
|---|---|---|
| `blob1` (workerName) | Which helper Worker wrote the event | `contact`, `forms`, `membership`, `review`, `subscribe`, `ecommerce` |
| `blob2` (eventType) | What kind of event | `submit`, `signup`, `unlock`, `webhook`, `error` |
| `blob3` (formName) | Form/tier identifier | `contact`, `rsvp`, `lead`, `free`, `paid`, `newsletter`, `review`, or `""` |
| `blob4` (outcome) | Result of the request | `ok`, `rate_limited`, `validation_error`, `upstream_error` |
| `double1` | Count for SUM aggregation | `1` |
| `index1` (siteDomain) | Site that produced the event (multi-site accounts) | `example.com` |

Free Cloudflare accounts include 10M Analytics Engine writes per month and a 30-day retention window, which is more than enough for SMB conversion tracking.

## Step 0 — Check prerequisites

Read `.env` for `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_WEB_ANALYTICS_SITE_TAG`, and (optional) `CF_ZONE_ID`. The scaffolded project ships a `.env.example` that lists these keys with comments — copy or create `.env` from it on first run if it doesn't exist yet.

Also read `.site-config` for `CF_WEB_ANALYTICS_TOKEN`. This is the public beacon token (the same value as `CF_WEB_ANALYTICS_SITE_TAG`, just stored in the committed config so the layouts can inject the beacon at build time). It is safe to commit — every visitor sees it in the page HTML anyway. If it is missing, the site is currently not reporting any beacon hits and this skill will guide the owner through enabling Web Analytics before falling back to zone HTTP.

### Token creation (one-time)

If `CF_API_TOKEN` is missing, guide the owner through creating one:

1. Tell them: "To see your analytics, I need a Cloudflare API token. Let's create one — it takes about a minute. We'll add three permissions so the token covers traffic (Web Analytics or proxied DNS) and conversions (form submits, signups)."
2. Open: `https://dash.cloudflare.com/profile/api-tokens`
3. Click "Create Token"
4. Use the "Custom token" template
5. Add **all three** permissions:
   - **Account → Analytics → Read** — required for Web Analytics RUM (the default)
   - **Account → Analytics Engine → Read** — required for the `anglesite_events` conversions dataset
   - **Zone → Analytics → Read** — required only if the site uses proxied DNS on Cloudflare; safe to include either way
6. Account Resources: Include → (their Cloudflare account)
7. Zone Resources: Include → All zones from the same account (or the specific zone if known)
8. Click "Continue to summary" → "Create Token"
9. Copy the token and share it

Save to `.env` as `CF_API_TOKEN=token-value` using the Write tool (update or create the file). **Never save API tokens to `.site-config`** — that file is committed to git. `.env` is gitignored and stays local.

If the owner created an older token with only **Zone → Analytics → Read** (the original version of this skill recommended that), they may see "Account → Analytics" errors below. If the token is missing **Account → Analytics Engine → Read**, the conversions section will return an `authz` error — surface a one-line note ("Add Account → Analytics Engine → Read to your token to see conversion numbers") and skip the section. Have them either edit the existing token to add the missing permissions, or create a new one.

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

If `CF_WEB_ANALYTICS_SITE_TAG` is missing, list the account's Web Analytics sites and pick the one whose host matches `SITE_DOMAIN` (or, if no custom domain is set yet, the `*.workers.dev` preview hostname).

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ACCOUNT_ID=$(grep CF_ACCOUNT_ID .env | cut -d= -f2)
SITE_DOMAIN=$(grep SITE_DOMAIN .site-config | cut -d= -f2)
```

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rum/site_info/list" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r --arg host "$SITE_DOMAIN" '.result[] | select(.host == $host) | .site_tag'
```

If the response is empty, Web Analytics isn't enabled for this site yet. Tell the owner: "Cloudflare Web Analytics isn't enabled for your site yet. Open `https://dash.cloudflare.com/?to=/:account/web-analytics`, click 'Add a site', enter your site's hostname (`SITE_DOMAIN` or your `*.workers.dev` preview), and re-run `/anglesite:stats`. The beacon snippet itself is already wired into your Astro layouts — we just need the token." Do not proceed with RUM in this case — fall through to zone HTTP if available.

Save the site tag to `.env` as `CF_WEB_ANALYTICS_SITE_TAG=tag-value`, and **also** to `.site-config` as `CF_WEB_ANALYTICS_TOKEN=tag-value`. The layouts (`BaseLayout.astro`, `KioskLayout.astro`, `ImmersiveLayout.astro`) read `CF_WEB_ANALYTICS_TOKEN` at build time and inject `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"…"}'></script>` into the `<head>` — without the token, no real-browser hits reach the RUM dataset. Use the **Edit** or **Write** tool to update `.site-config` — the value is public and safe to commit.

After saving the token, remind the owner: "Your next deploy will start sending real-browser hits to Cloudflare. The numbers below will look thin until traffic builds up — usually a day or two."

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
3. **Neither available** — explain to the owner: "I couldn't reach either Cloudflare analytics dataset. Either Web Analytics isn't enabled for your site yet, the beacon token isn't wired into `.site-config`, or the API token is missing the right permission. Run `/anglesite:check` and revisit Step 0 above."

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

### Query C (zone) — country breakdown (most recent day)

Replace `DATE_TODAY` with today's ISO date. Same single-day window as Query B. The country breakdown lets the owner self-diagnose datacenter/bot inflation in the unique-visitor count — small sites often see Hetzner Frankfurt (DE), AWS/Hetzner Dublin (IE), OVH, Vultr Singapore (SG), and Tor (T1) dominate the geography.

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { zones(filter: {zoneTag: \"'$CF_ZONE_ID'\"}) { httpRequestsAdaptiveGroups(filter: {date: \"DATE_TODAY\", edgeResponseContentTypeName: \"html\", edgeResponseStatus_lt: 400}, limit: 25, orderBy: [count_DESC]) { count dimensions { clientCountryName } } } } }"}'
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

## Step 2C — Fetch conversions from `anglesite_events`

Always run this section in addition to Step 2A or 2B — conversions are an independent signal from traffic. Skip it gracefully if the helper Workers haven't been deployed yet (an empty result set, not an error).

The `anglesite_events` dataset lives in Cloudflare Analytics Engine and is queried via the same GraphQL endpoint used for traffic. The schema is documented at the top of this file under "The `anglesite_events` dataset".

```sh
CF_API_TOKEN=$(grep CF_API_TOKEN .env | cut -d= -f2)
CF_ACCOUNT_ID=$(grep CF_ACCOUNT_ID .env | cut -d= -f2)
SITE_DOMAIN=$(grep SITE_DOMAIN .site-config | cut -d= -f2)
```

### Query D (events) — conversions by worker and outcome (last 14 days, daily roll-ups)

Replace `DATE_START_PREV` with 14 days ago (ISO `YYYY-MM-DD`) and `DATE_END_CURR` with today.

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { accounts(filter: {accountTag: \"'$CF_ACCOUNT_ID'\"}) { workersAnalyticsEngineAdaptiveGroups(filter: {datasetId: \"anglesite_events\", index1: \"'$SITE_DOMAIN'\", date_geq: \"DATE_START_PREV\", date_leq: \"DATE_END_CURR\"}, limit: 1000, orderBy: [date_ASC]) { sum { _sample_interval } count dimensions { date blob1 blob2 blob3 blob4 } } } } }"}'
```

`count` is the number of distinct events in the bucket; `sum._sample_interval` is the count weighted for sampling (use this when extrapolating to a real total). For SMB-scale traffic the two are usually identical.

If the response contains an `authz` or `does not have access` error, the token is missing **Account → Analytics Engine → Read**. Skip the conversions section and surface the one-line remediation note from the token-creation step.

If the response is empty (no rows), the helper Workers either haven't been deployed yet or haven't received any traffic. Skip the section silently — don't surface an empty table.

### Query E (events) — totals by form (last 7 days)

```sh
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"{ viewer { accounts(filter: {accountTag: \"'$CF_ACCOUNT_ID'\"}) { workersAnalyticsEngineAdaptiveGroups(filter: {datasetId: \"anglesite_events\", index1: \"'$SITE_DOMAIN'\", date_geq: \"DATE_START_CURR\", date_leq: \"DATE_END_CURR\"}, limit: 200, orderBy: [count_DESC]) { count dimensions { blob1 blob2 blob3 blob4 } } } } }"}'
```

Replace `DATE_START_CURR` with 7 days ago and `DATE_END_CURR` with today.

## Step 3 — Parse and summarize

These three numbers measure different things and must not be substituted for one another:

- **Unique visitors** — RUM: `sum.visits` (sessions ≈ unique visitors for week-long windows). Zone: `uniq.uniques` from `httpRequests1dGroups`. The zone figure is the number of distinct IP+UA pairs Cloudflare saw — **it includes datacenter ranges (Hetzner, AWS, OVH, Vultr) and bots that did not get blocked at the edge**, so on small personal sites it can overstate human readers by 50–100%. The RUM beacon only fires in real browsers, so it doesn't suffer the same inflation. Always present the zone figure with the caveat in the summary, and lead with page views when both are available.
- **Page views** — RUM: `count` from `rumPageloadEventsAdaptiveGroups` (beacon hits, real browsers only). Zone: `sum.pageViews` from `httpRequests1dGroups`, or `count` from `httpRequestsAdaptiveGroups` *when filtered to HTML responses* (Query B). One person can generate many page views. The zone figure is less inflated by bots than uniques because most non-rendering scrapers don't request many distinct HTML pages.
- **Requests** *(zone only)* — raw `count` from `httpRequestsAdaptiveGroups` with no content-type filter. Includes every asset, redirect, bot hit, and error response. Don't surface this as "visitors" or "views"; only mention it explicitly as "requests" when relevant. RUM has no equivalent — the beacon only fires on HTML pageloads.

From the responses, extract:

1. **Unique visitors** — RUM: sum `sum.visits` across each 7-day window. Zone: sum `uniq.uniques` across each 7-day window.
2. **Page views** — RUM: sum `count` from Query A across each 7-day window. Zone: sum `sum.pageViews` from Query A across each 7-day window. Report alongside visitors; don't conflate the two.
3. **Busiest day** — from Query A, map each `dimensions.date` (ISO date) to its weekday name, take the day with the highest page views in the current week. Label the figure as "page views" (not "visits" or "visitors").
4. **Top pages** — RUM: from Query B, group by `requestPath`, sum `count`, sort descending, take top 5. Note in the summary that this reflects the last 7 days. Zone: from Query B (HTML-filtered), group by `clientRequestPath`, sum `count`, sort descending, take top 5. Note in the summary that this reflects the most recent 24 hours (free-plan limitation).
5. **Country breakdown** *(zone only)* — from zone Query C, take top 8 countries by `count`. Mark the following as `(datacenter-heavy)` so the owner can spot bot inflation: `IE` (Dublin — Hetzner/AWS), `DE` (Frankfurt — Hetzner), `NL` (Amsterdam — OVH/Hetzner), `SG` (Vultr/DigitalOcean), `FI` (Hetzner Helsinki), `T1` or `XX` (Tor exit nodes), and any country whose share looks disproportionate to the site's audience (e.g., `CN` on an English-language local-business site). Use the country code as returned by Cloudflare; map common ones to readable names (`US` → "United States", etc.) when presenting. Skip on RUM — the bot-inflation problem doesn't apply, and the beacon's geo dimensions are not wired here yet.
6. **Referral sources** — RUM: from Query C, group by `refererHost`, rename common ones (e.g., `google.com` → "Google Search", empty → "Direct"). Zone *(paid only)*: group by `clientRefererHost`. Skip on zone free plans.
7. **Device breakdown** — RUM: from Query C, group by `deviceType`. Zone *(paid only)*: group by `userAgentBrowser`. Skip on zone free plans.
8. **Campaign breakdown** *(zone paid only)* — from the `clientRequestQuery` query above, parse each query string for `utm_source`, `utm_medium`, `utm_campaign`. Group by `utm_source`/`utm_campaign`, label each entry as `{source} "{campaign}"`, and sort by page-view count descending. `clientRequestPath` does not include query strings, so this section is impossible on zone free plans — skip it there. RUM exposes campaign dimensions via the beacon but they are not covered by this skill yet — skip on RUM.
9. **Conversions** *(events dataset)* — from Query D and Query E:
   - **Total submits this week** — sum `count` from Query D where `blob4 = "ok"`, scoped to the current 7-day window.
   - **By worker** — group Query E rows by `blob1` (`contact`, `forms`, `membership`, `review`, `subscribe`, `ecommerce`); for each, report total events and the share with `blob4 = "ok"`. This is the signal an SMB owner cares about: "12 contact submits, 8 newsletter signups, 3 paid unlocks."
   - **By form** — for `blob1 = "forms"`, sub-group by `blob3` (form slug: `rsvp`, `lead`, etc.) so the owner sees per-form volume. Show only forms with at least one submit in the window.
   - **Error rate** — within each worker, the share of rows where `blob4 != "ok"`. Surface only when error rate exceeds 25% of total events for that worker — most error rows are routine validation noise (rate-limiting, empty fields) and aren't actionable. Frame the alert as "12 of 38 contact submits failed Turnstile this week — worth checking the form is loading the widget."
   - **Week-over-week** — split Query D rows by date as in the traffic queries (current 7 days vs prior 7 days) and compute the delta on `blob4 = "ok"` events. Phrase as "newsletter signups up from 4 to 11 this week".

   Skip the section silently if Query D returned an empty result (no helper Workers deployed). Surface the token remediation note if the query returned an `authz` error.

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
>
> *Conversions (last 7 days, helper Worker events):*
>
> | Worker | Successful events | Notes |
> |---|---|---|
> | contact | 12 | up from 7 last week |
> | subscribe | 8 newsletter signups | up from 4 last week |
> | forms (rsvp) | 5 | first event this week |
> | membership | 2 paid unlocks | new |
>
> Conversion rate: 27 form events on 318 page views = **8.5%** — healthy for a small business site.

Example output (zone HTTP analytics, free plan):

> *Source: Cloudflare zone HTTP logs (proxied DNS edge data). Numbers will not match the Web Analytics dashboard.*
>
> Your site drew **318 page views** this week (up 31% from last week), from **142 unique IPs** (up 23%).
>
> *Heads up — on the zone dataset, Cloudflare counts every distinct IP as a "unique visitor", which sweeps in datacenter traffic (Hetzner, AWS, OVH) and bots that don't get blocked at the edge. On small sites the real human-reader count is usually 50–60% of the unique number. Use page views as the more reliable signal and check the country breakdown below — or switch to the Web Analytics beacon, which only counts real browsers.*
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
> *Referrer, device, and campaign (UTM) breakdowns require a paid Cloudflare plan on the zone dataset, or switching to the Web Analytics beacon.*

## Presentation

After collecting the data, present results as a clean markdown summary:

- **Source line** — italic, single sentence, names the dataset (`Web Analytics beacon` or `zone HTTP logs`). Always first.
- **Top pages** — markdown table with page path and page-view count (and optional bar made of `█` characters proportional to page views, e.g. `████████ 240`). Header the count column "Page views", not "Visits".
- **Top countries** *(zone only)* — markdown table with country name and page-view count. Append `(datacenter-heavy)` to known datacenter-dominant origins (see Step 3 item 5). Skip on RUM.
- **Campaign performance** *(zone paid only)* — markdown table if `clientRequestQuery` data is available, also in page views. Skip on zone free plans and on RUM.
- **Conversions** *(events dataset)* — markdown table grouped by worker (and by form slug for `forms`) with a "Successful events" column. Append a one-line conversion-rate sentence (`successful events / page views`) when traffic data is also available. Skip silently when no helper Workers have been deployed; surface the token remediation note when the query returned an `authz` error.
- **Bot/datacenter caveat** *(zone only)* — always include the one-line heads-up about unique-visitor inflation when reporting `uniq.uniques`. Don't skip it on the assumption that the site is large; the owner is rarely in a position to know. The RUM beacon doesn't have this problem, so skip the caveat there.
- **Plain-language summary** — 2–3 sentences explaining what the numbers mean. When you cite a headline figure, say which one (visitors vs page views) — they tell different stories. Lead with page views when both are available.

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

## Step 4.5 — Performance trends (if available)

If `reports/perf-trend.json` exists, the deploy skill has been recording performance budget snapshots. Each entry has `generatedAt`, `totalJs`, `totalCss`, `pageCount`, `findingCount`, and (when Lighthouse ran) `worstLcpMs` / `worstCls`.

Read the file with `Read`, then surface the trend in plain language. Show the most recent run alongside the run from ~30 days ago (or the oldest available) so the owner can see drift:

> **Performance:** Across {pageCount} pages your site ships {totalJs / 1024 KB} of JavaScript and {totalCss / 1024 KB} of CSS — about the same as last month. {findingCount} pages were over budget on this deploy ({listed in reports/perf-report.md}).

If `totalJs` or `totalCss` has grown by more than 25% since the oldest entry, surface that as a heads-up: "Your JavaScript bundle has grown from 32 KB to 71 KB over the last month — worth checking what was added." The deploy skill writes the granular per-page report to `reports/perf-report.md`; point the owner there for specifics.

If the file doesn't exist, skip this section — performance trends only appear after the owner has run `/anglesite:deploy` at least once on a build with the perf budget step active.

## Step 5 — Offer the dashboard

After showing the summary, remind the owner they can see more detail in the Cloudflare dashboard:

"For more detailed charts, visit your analytics dashboard:"

- Web Analytics: `https://dash.cloudflare.com/?to=/:account/web-analytics`
- Zone analytics (only if you used `zone-http`): `https://dash.cloudflare.com/?to=/:account/:zone/analytics/traffic`

Both URLs are account-scoped (Cloudflare resolves `:account` from the logged-in session) and don't need a project identifier.

Tell them: "The dashboard shows trends over time, geographic data, and more. But for a quick check-in, just run this command anytime."
