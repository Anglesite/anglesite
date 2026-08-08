# In-app analytics data viewing (Web Analytics / RUM) — design

**Issue:** [#1114](https://github.com/Anglesite/Anglesite/issues/1114)
**Date:** 2026-08-07
**Status:** Approved

## 1. Problem

#1114 was split out of #699's design (`docs/superpowers/specs/2026-07-30-server-debug-panel-design.md`
§2/§6) as the follow-up for "in-app analytics data viewing," explicitly out of scope for that
work. Today, once a site owner enables Cloudflare Web Analytics from Site Settings, the app can
only deep-link out to the Cloudflare dashboard (`WorkerDashboardLinks`, shipped with #710) to see
any traffic numbers. This design adds a small in-app summary — recent pageviews, visits, and a
trend — so an owner can get a quick read on their site's traffic without leaving the app.

**Non-goals** (unchanged from the parent issue): local-dev analytics (local `wrangler dev` has no
analytics; the Debug Pane's worker log/status rows from #699 cover local visibility), and
replacing the Cloudflare dashboard for deep investigation — the existing deep-links remain the
answer for anything beyond a glance.

## 2. Scope

**In:**
- A 7-day pageviews + visits summary with a daily trend sparkline, shown in Site Settings ▸
  Analytics tab, for sites with Cloudflare Web Analytics enabled.
- A new `CloudflareRUMAnalyticsClient`/`CloudflareRUMAnalyticsProviding` pair in AnglesiteCore
  that queries Cloudflare's GraphQL Analytics API (`rumPageloadEventsAdaptiveGroups`) for that
  summary.

**Out (explicit, with rationale):**
- **Any UI in the Workers tab.** The Workers tab only knows the deployed worker's name (for
  `WorkerDashboardLinks`' dashboard deep-links); it has no notion of the RUM `siteTag`. The
  Analytics tab already resolves and persists that `siteTag` (`PlistEditorModel.swift:840-841`,
  stored as `analyticsSettings.cloudflareToken`) as part of turning Cloudflare Analytics on, so
  it is the natural home with no new token/siteTag plumbing.
- **A dedicated Analytics window/surface.** More navigation surface (menu item, window
  lifecycle) than a summary card justifies; revisit only if this grows into a full dashboard.
- **Selectable time ranges, top-pages/referrer breakdowns, auto-refresh/polling.** YAGNI for a
  "quick glance" feature — a fixed 7-day window, totals-only (no breakdowns), and fetch-on-tab-
  appear (no timers) keep the query, the UI, and the test matrix small. Any of these can be
  added later without changing the architecture below.
- **Manual refresh control.** Reopening the tab (or the site window) re-fetches; no separate
  button. A 7-day trend doesn't need hour-to-hour freshness enforcement.

## 3. Architecture

A new pair in `Sources/AnglesiteCore/`, mirroring the existing
`CloudflareWebAnalyticsClient`/`CloudflareWebAnalyticsProviding` pattern used for `siteTag`
resolution — but kept as a **separate** type rather than folded into that client, because the two
calls are different Cloudflare APIs (REST v4 for site-tag resolution, done once during
onboarding; GraphQL for metrics, done on every tab view) with different request/response shapes
and different call cadences. Keeping them separate keeps each independently fakeable in tests
without either one growing into a grab-bag.

```swift
public struct DailyCount: Sendable, Equatable {
    public let date: Date
    public let pageviews: Int
}

public struct RUMAnalyticsSummary: Sendable, Equatable {
    public let totalPageviews: Int
    public let totalVisits: Int
    public let dailyPageviews: [DailyCount]   // ascending by date, one entry per day in range
}

public protocol CloudflareRUMAnalyticsProviding: Sendable {
    /// Fetches a pageviews/visits summary for the last `days` days for the Web Analytics site
    /// identified by `siteTag`.
    func summary(siteTag: String, apiToken: String, days: Int) async throws -> RUMAnalyticsSummary
}

public struct CloudflareRUMAnalyticsClient: CloudflareRUMAnalyticsProviding {
    // POSTs to https://api.cloudflare.com/client/v4/graphql, same Bearer-token auth as
    // CloudflareWebAnalyticsClient. Reuses CloudflareWebAnalyticsError for its failure cases
    // (.missingToken, .invalidResponse, .api) — this client fails the same ways (bad token, bad
    // response, non-2xx) as the sibling REST client, so a second error enum would be redundant.
}
```

**Query shape.** `rumPageloadEventsAdaptiveGroups` belongs to Cloudflare's "Adaptive Groups"
dataset family (confirmed against Cloudflare's own migration-guide example for the sibling
`httpRequestsAdaptiveGroups` dataset, which shares the same filter/aggregate conventions):
`filter: { siteTag: ..., datetime_geq: ..., datetime_lt: ... }`, `count` and `sum { visits }`
aggregates, and a `dimensions { ... }` block carrying a per-day grouping field. The account tag
needed to scope the query is already resolved by the existing `accounts(apiToken:)` REST call
inside `CloudflareWebAnalyticsClient` — `CloudflareRUMAnalyticsClient` makes the equivalent call
itself (same `/accounts` endpoint) rather than threading the account ID through from the other
client, keeping the two providers independent.

**Verify-before-build note:** the exact dimension field name for day-level grouping in the RUM
dataset specifically (as opposed to the confirmed sibling dataset) should be confirmed against
Cloudflare's live GraphQL schema (introspection, or the GraphiQL explorer linked from
`developers.cloudflare.com/analytics/graphql-api/getting-started/compose-graphql-query/`) as the
first implementation step, using a real account token. This is normal due diligence for any
external API integration — the architecture, decoding boundary, and test strategy below do not
depend on which exact field name it turns out to be.

**Wiring into `PlistEditorModel`:** a new `rumAnalyticsProvider: any CloudflareRUMAnalyticsProviding
= CloudflareRUMAnalyticsClient()` init parameter, injected exactly like the existing
`analyticsProvider` — production takes the default, tests inject a fake.

## 4. Data flow

- **Trigger:** `PlistEditorModel` gains a `loadRUMSummary()` method, called from a `.task`
  attached to the Analytics tab's content (fires when that tab is selected — the tab already
  lazy-loads nothing before being shown, same as the Workers tab's catalog state). It only runs
  when `cloudflareAnalyticsEnabled` is `true`; sites without analytics enabled never fetch.
- **State** (mirrors the existing `isConfiguringCloudflareAnalytics`/`analyticsError` pair):
  ```swift
  private(set) var rumSummary: RUMAnalyticsSummary?
  private(set) var isLoadingRUMSummary = false
  private(set) var rumSummaryError: String?
  ```
- **`loadRUMSummary()`:** guards `!isLoadingRUMSummary`; resolves the API token via the existing
  `cloudflareToken()` helper; calls `rumAnalyticsProvider.summary(siteTag: analyticsSettings
  .cloudflareToken, apiToken: token, days: 7)`; stores the result in `rumSummary` or the
  localized error in `rumSummaryError`. Single attempt per tab-appear — no retry/backoff,
  consistent with the fetch-on-appear-only decision in §2.
- **Error handling:** any thrown error (missing/revoked token, non-2xx, undecodable body)
  surfaces as `rumSummaryError` and suppresses the summary card entirely — never a stale or
  zero-filled chart standing in for "the fetch failed."
- **Empty-but-successful response** (a real site with genuinely no traffic in the window) is a
  distinct third state from both loading and error: rendered as "No traffic recorded in the last
  7 days," not a blank or zeroed chart — conflating "no data" with "fetch failed" would hide real
  outages behind what looks like a quiet site.

## 5. UI

- **Placement:** Site Settings ▸ Analytics tab, in a new `rumSummarySection` below the existing
  "Enable Cloudflare Web Analytics" toggle. Rendered only when `cloudflareAnalyticsEnabled` is
  `true` — nothing added to the tab for sites without analytics enabled.
- **Content:** "Last 7 days" label; two stat lines (total pageviews, total visits); a small
  `Chart` (Swift Charts — `import Charts`, a system framework already available at this
  deployment target via Apple's own SDK, same as `AppKit`/`SwiftUI` today; no `project.yml`
  change needed) rendering `dailyPageviews` as a `BarMark` sparkline.
- **States:** loading shows a `ProgressView` in place of the card; error shows `rumSummaryError`
  as inline secondary text with no chart; empty-but-successful shows the "No traffic recorded"
  message per §4.
- **Accessibility:** the chart carries an `accessibilityLabel`/`accessibilityValue` summarizing
  the trend in words (e.g. "7-day pageviews, 1,240 total, trending up") per the macOS spec's
  VoiceOver requirement — a sparkline with no textual equivalent is invisible to VoiceOver.
- **Strings:** new user-visible text goes through CONTRIBUTING.md's String Catalog CLI-sync step,
  same as any other new text in this file.

## 6. Testing

- **`CloudflareRUMAnalyticsClientTests`** (AnglesiteCoreTests, Swift Testing): request
  construction (correct `siteTag` and date-window bounds in the GraphQL request body), a
  successful-response decode into `RUMAnalyticsSummary`, and each error path (missing token,
  non-2xx, undecodable body) — mirrors `CloudflareWebAnalyticsClientTests`' existing shape
  against a stub `URLSession`/local server.
- **`PlistEditorModelTests`:** `loadRUMSummary()` only fires when `cloudflareAnalyticsEnabled` is
  `true`; a fake `CloudflareRUMAnalyticsProviding` drives the success, error, and empty-summary
  cases into `rumSummary`/`rumSummaryError`.
- **No new UI/snapshot tests** — `PlistEditorView` has no snapshot-testing pattern for its other
  tabs today; this feature doesn't introduce one.
- **App target build** via `scripts/build-app.sh` (a `swift test` pass alone doesn't prove the
  app links — repo rule), plus the String Catalog sync for the new strings.
- **Manual GUI smoke** (this repo's standard owed-QA pattern, e.g. #918), filed as a follow-up
  checklist issue: verify the card for a site with analytics enabled and real traffic, a site
  with analytics disabled (nothing shown), a site with analytics enabled but no traffic yet
  (empty state), and a revoked-token error case.

## 7. Follow-ups filed with this work

- **Manual GUI smoke checklist** for the new Analytics tab summary card — new issue.
