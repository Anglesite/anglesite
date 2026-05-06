---
status: accepted
date: 2026-05-06
decision-makers: [Anglesite maintainers]
---

# Per-page performance budgets in `/anglesite:deploy`

## Context and Problem Statement

Astro's defining property — and Anglesite's reason for picking it (ADR-0001) — is "zero JavaScript by default." A site can lose that property silently: a freshly added integration, a `client:load` directive on a small island, or a third-party script crept in past the security scan can each push a page from 0 KB to 100 KB+ of JS without any single change being obviously wrong. There's nothing in the deploy pipeline that notices.

We need a regression catcher. The same family of decisions that produced the security scan (ADR-0007), the link-check gate (`LINK_CHECK_DEPLOY`), and the accessibility / agent-readability gates (ADR-0016, ADR-0017) applies here: a per-page audit, severity-aware exit codes, configurable per-route, off-by-default for first-time owners.

The harder question is *what* to measure. A real performance audit needs LCP and CLS, which means a running browser (Lighthouse, WebPageTest), which means a heavy install for owners who don't have it. The cheapest signal — JS and CSS bytes referenced by each HTML page — needs nothing more than `dist/` and a regex pass over the HTML, and it catches the failure mode that matters most for a static-content site: bundle bloat.

## Decision Drivers

* The default budget should catch real regressions on a typical Astro site, where production pages are routinely under 10 KB of JS
* The audit must work without requiring Chromium (default to static asset analysis)
* Owners who want LCP/CLS should be able to opt in via Lighthouse without changing the skill flow
* The deploy gate should ship warn-only in 1.1 — defaults need real-site tuning before they can block
* Per-template overrides are mandatory: a `creative-canvas` page that ships p5.js intentionally cannot share a budget with the homepage
* Trends matter as much as absolutes — slow drift is the failure mode, so the audit must record history for `/anglesite:stats` to surface

## Considered Options

* **Static asset audit by default, Lighthouse opt-in, warn-only in 1.1** (chosen)
* Make Lighthouse a hard dependency and run it on every deploy
* Skip Lighthouse entirely; only ever measure bytes
* Send pages to PageSpeed Insights API (no install)

## Decision Outcome

Chosen option: "Static asset audit by default, Lighthouse opt-in, warn-only in 1.1".

`template/scripts/perf-budget.ts` walks `dist/`, parses each HTML page for `<script src>` and `<link rel="stylesheet">` references, sums the bytes of those local files, and compares each page against budgets read from `.site-config` (with per-route overrides matching the first path segment). When `PERF_LCP_CLS=true` and Lighthouse is installed, the script also drives Lighthouse against the preview server to capture LCP and CLS. Findings are written to `perf-report.md`; a rolling history is appended to `perf-trend.json` (capped at 30 entries) so `/anglesite:stats` can show whether the bundle is creeping up.

The `/anglesite:deploy` skill runs the audit warn-only in 1.1 (`PERF_WARN_ONLY=true` is the implicit default for the step). 1.2 will let owners flip `PERF_WARN_ONLY=false` to fail the deploy on regressions, once the defaults have been tuned against real Anglesite sites.

### Defaults

| Budget | Default | Why |
|---|---|---|
| `PERF_BUDGET_JS` | 50 KB | A typical Astro page ships < 10 KB. 50 KB is generous enough to absorb one client island without nagging. |
| `PERF_BUDGET_CSS` | 50 KB | Vanilla CSS plus a small design system fits comfortably; bundle bloat shows up immediately. |
| `PERF_BUDGET_LCP_MS` | 2500 | Web Vitals "good" threshold. |
| `PERF_BUDGET_CLS` | 0.1 | Web Vitals "good" threshold. |

### Consequences

* Good — owners get a real signal whenever a page bloats past 50 KB of JS or CSS, even without installing Chromium.
* Good — per-template overrides keep the gate honest for `creative-canvas`, ecommerce embeds, and similar exceptions instead of forcing a global ceiling that's wrong for everyone.
* Good — trend snapshots in `perf-trend.json` let `/anglesite:stats` surface slow drift, which is the actual failure mode.
* Good — Lighthouse remains optional, so first-time owners aren't blocked by a Chromium install they don't need.
* Bad — static asset audit doesn't catch render-blocking patterns, font flashes, or hydration cost; those need Lighthouse.
* Bad — per-route overrides are matched on the first path segment, so deeply nested routes (`/blog/2026/launch`) need their override keyed on the top segment (`PERF_BUDGET_JS_BLOG`), which may be coarser than the owner wants.

### Confirmation

`scripts/perf-budget.ts` is invoked from `/anglesite:deploy` Step 2a⅞½ and from `npm run ai-perf` directly. Unit tests in `tests/perf-budget.test.ts` cover budget resolution (defaults, overrides, malformed input), asset extraction (script/link tag parsing, query/hash stripping, external URL handling), per-page evaluation (under, at, and over budget), trend file rotation, and exit-code computation.

## Pros and Cons of the Options

### Static asset audit by default, Lighthouse opt-in, warn-only in 1.1

* Good, because the default audit catches the most common regression (bundle bloat) with zero new dependencies.
* Good, because Lighthouse is an additive upgrade, not a precondition.
* Good, because warn-only in 1.1 lets defaults be tuned against real sites before becoming a hard gate.
* Bad, because two code paths (static + Lighthouse) means more surface area to test.

### Make Lighthouse a hard dependency

* Good, because every owner gets LCP and CLS from day one.
* Bad, because Lighthouse pulls in Chromium (~150 MB), slowing first install substantially.
* Bad, because the audit becomes flaky on CI runners that can't run Chromium reliably.

### Skip Lighthouse; only ever measure bytes

* Good, because the implementation is small and predictable.
* Bad, because LCP and CLS are the metrics owners and customers actually feel; ignoring them limits the audit's usefulness.

### Use PageSpeed Insights API

* Good, because no local install required.
* Bad, because PSI requires a public URL — the audit can't run on previews or before the first deploy.
* Bad, because the API is rate-limited and the latency makes the deploy step slow.
* Bad, because it ties Anglesite's perf signal to a Google product, which conflicts with the "no external runtime dependencies" stance.

## More Information

The audit script is invoked as `npm run ai-perf` in the user's project. Owners can wire it into CI by running `npm run ai-perf -- --json` and reading the exit code. The JSON output makes findings easy to surface in PR comments.

When 1.2 lands, the planned change is a single config flip: `PERF_WARN_ONLY=false` will let owners opt into a hard gate without re-running setup, mirroring how `A11Y_GATE` and `LINK_CHECK_DEPLOY` already work.
