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
