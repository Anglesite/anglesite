# A/B testing and funnel optimization

Test different versions of your pages to find what converts best. The AI proposes experiments, creates variants, manages the test, and tells you the results in plain language.

## How it works

1. **You describe what to test** — "Test two versions of my homepage headline"
2. **AI generates variants** — you review and approve the copy
3. **Test runs at the edge** — visitors are randomly assigned to a version with zero flicker
4. **AI monitors results** — checks periodically and reports in plain English
5. **Winner is promoted** — the best version becomes the default automatically

## What gets tested

In order of typical impact:

1. Hero headline
2. Call-to-action copy ("Get a Quote" vs "Book a Free Call")
3. Social proof placement (above vs below the fold)
4. Contact form length
5. Pricing framing
6. Page narrative structure

One test at a time. The AI manages the queue.

## Prerequisites

- Site deployed to Cloudflare Pages
- Cloudflare API token with KV, Analytics Engine, and D1 access
- At least some traffic (experiments need visitors to produce results)

## Configuration

These values are saved to `.site-config` during first use:

| Key | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token |
| `CF_ACCOUNT_ID` | Cloudflare account identifier |
| `AB_KV_NAMESPACE_ID` | KV namespace for experiment config |
| `AB_D1_DATABASE_ID` | D1 database for experiment outcomes |
| `AB_AE_DATASET` | Analytics Engine dataset name (default: `anglesite_events`) |

## Data storage

| What | Where | Why |
|---|---|---|
| Live impressions and conversions | Analytics Engine | Fast, non-blocking, SQL-queryable |
| Active experiment config | KV | Low-latency edge reads |
| Experiment outcomes and learnings | D1 | Long-term history for AI to learn from |

## Privacy

- First-party cookie only (no third-party tracking)
- No PII collected or stored
- All data stays in your Cloudflare account
- No consent banner required (functional cookie)

## Checking results

Ask "How is the test going?" at any time. The AI will query the latest data and explain the results:

> **Homepage Hero Test**
> Version B is outperforming the original by about 18%.
> We're 87% confident — a bit more data will confirm it.

## Acting on results

- **"Go with Version B"** — promotes the winner, cleans up test files
- **"Stop the test"** — ends the experiment, keeps the original
- **"What have we learned?"** — shows experiment history and patterns
