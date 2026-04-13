---
name: experiment
description: "Propose, run, and analyze A/B tests to improve conversions"
user-invokable: false
allowed-tools: Bash(npm run build), Bash(npx wrangler *), Write, Read, Edit, Glob
---

Manage the full lifecycle of an A/B experiment: propose a hypothesis, generate variant copy, configure the test, monitor results, and promote the winner.

## Architecture decisions

- [ADR-0003 Cloudflare Pages](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-pages-hosting.md) — hosting platform (Pages Functions for edge assignment)
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — no external A/B testing scripts
- [ADR-0014 Edge A/B testing](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0014-edge-ab-testing.md) — why build-time variants + edge assignment

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## How it works

Experiments run in three layers:

1. **Build time** — Astro generates variant HTML files alongside the control (e.g., `index.variant-a.html`)
2. **Edge** — A Cloudflare Pages Function (`functions/_middleware.ts`) intercepts requests, assigns visitors to variants via cookie, and serves the correct file. Zero layout flicker.
3. **Analysis** — Impressions and conversions are logged to Analytics Engine. A Bayesian analysis determines winners without requiring fixed sample sizes.

### Data layer

| Concern | Tool | Why |
|---|---|---|
| Event stream (impressions + conversions) | Analytics Engine | Non-blocking writes, SQL-queryable, scales to any traffic |
| Active experiment config | KV | Low-latency edge reads, mutable without rebuild |
| Experiment outcomes + learning history | D1 | Relational storage, queried for long-term pattern learning |

## Step 1 — Propose a hypothesis

Analyze the page the owner wants to test. Consider:

- Current conversion signals (does the page have a clear CTA?)
- Funnel drop-off patterns (if analytics data is available, check via `/anglesite:stats`)
- Best practices from `${CLAUDE_PLUGIN_ROOT}/docs/smb/` for the owner's `BUSINESS_TYPE`

Propose a specific, testable hypothesis. Example:

> "I think changing the hero headline from 'Welcome to Pairadocs Farm' to 'Fresh Eggs and Seasonal Produce — Join Our CSA' will increase contact form submissions, because visitors will immediately understand what you offer."

**Always get the owner's approval before proceeding.** Show them the exact copy for each variant.

### Default experiment playbook

If the owner says "test my site" without a specific idea, prioritize by expected impact:

1. Hero headline
2. Primary CTA copy
3. Social proof placement
4. Contact form length
5. Pricing framing
6. Page narrative structure (problem-first vs solution-first)

One test at a time. Sequential. No multivariate experiments until traffic warrants it.

## Step 2 — Generate variants

Create 1-2 alternative versions of the element under test. Ground the copy in:

- The owner's `BUSINESS_TYPE` and brand voice (read `docs/brand.md` if it exists)
- Copywriting principles (specificity beats vagueness, benefits beat features)
- Past experiment outcomes (query D1 if available: "What has worked on this site before?")

Present each variant side-by-side with the control for the owner to approve or edit.

## Step 3 — Configure the experiment

Once the owner approves the variants:

1. **Create variant page files** — duplicate the page under test and apply the variant copy. Follow Astro's static generation conventions:
   ```
   src/pages/index.astro            ← control (unchanged)
   src/pages/index.variant-a.astro  ← treatment
   ```

2. **Update experiment config** — Write the experiment definition to KV via the Cloudflare API:
   ```json
   {
     "id": "homepage-hero",
     "page": "/",
     "variants": ["control", "variant-a"],
     "weights": [0.5, 0.5],
     "metric": "contact-form-submit",
     "active": true
   }
   ```

3. **Verify the Analytics Engine dataset exists** — The dataset `anglesite_events` must be created on the owner's Cloudflare account. If it doesn't exist, guide them through creating it in the Cloudflare dashboard.

4. **Build and deploy** — Run `npm run build` to generate variant HTML files, then deploy via `/anglesite:deploy`. The middleware will start routing traffic immediately.

Tell the owner: "The test is live. I'll check the results periodically and let you know when we have enough data to make a decision."

## Step 4 — Monitor results

Query Analytics Engine via the SQL API to check experiment progress. Use `template/scripts/ab-analytics.ts:buildConversionQuery()` to build the query.

Feed the per-variant impression and conversion counts into `template/scripts/ab-stats.ts:bayesianABTest()` for statistical analysis.

Format the result using `formatExperimentResult()` and share with the owner in plain language:

> **Homepage Hero Test**
> "Fresh Eggs and Seasonal Produce" is outperforming the original by about 18%.
> We're 87% confident this is a real difference — a bit more data will confirm it.
> Original: 3.2% · Variant: 3.8%

### Anomaly detection

Watch for sample ratio mismatch (SRM): if the traffic split deviates significantly from the configured weights (e.g., 60/40 instead of 50/50), flag it. SRM usually indicates a technical issue (caching problem, bot traffic skew). Investigate before trusting the results.

## Step 5 — Promote or discard

When confidence reaches the threshold (default 95%):

**If the variant wins:**
1. Replace the control page with the winning variant's content
2. Remove the variant file (e.g., `index.variant-a.astro`)
3. Remove the experiment from KV (set `active: false`)
4. Record the outcome in D1 via `template/scripts/ab-outcomes.ts:buildInsertOutcomeSQL()`
5. Deploy the updated site

Tell the owner: "Version B won! I've made it the new default and cleaned up the test files."

**If the control wins:**
1. Remove the variant file
2. Remove the experiment from KV
3. Record the outcome in D1
4. Tell the owner: "The original is performing better — I've ended the test and kept things as they were."

**If inconclusive after sufficient time (30+ days, or 500+ impressions per variant):**
1. Discuss with the owner: "The test has been running for a while and the results are too close to call. Want to keep testing, try a different variant, or call it?"
2. Act on their preference.

## Privacy and compliance

- Variant assignment cookie is first-party, session-scoped, contains no PII
- No data sent to third-party servers
- All event data stored in the owner's Cloudflare account (Analytics Engine + D1)
- Compliant with GDPR, CCPA, and ePrivacy without a consent banner (functional cookie, no tracking)
- Experiment data is excluded from analytics exports

## Owner-facing language

The owner should never need to understand statistics. Use these patterns:

| They say | You do |
|---|---|
| "Test two versions of my headline" | Run Steps 1-3 |
| "How is the test going?" | Run Step 4 |
| "Go with Version B" | Run Step 5 (promote) |
| "Stop the test" | Run Step 5 (discard) |
| "What have we learned?" | Query D1 experiment history |
