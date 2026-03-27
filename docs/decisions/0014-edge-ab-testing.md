---
status: accepted
date: 2026-03-27
decision-makers: [Anglesite maintainers]
---

# Use build-time variants with edge assignment for A/B testing

## Context and Problem Statement

Small business owners need to test what works on their website (headlines, CTAs, page structure) but traditional A/B testing tools are inaccessible: they require JavaScript snippets, introduce layout flicker that hurts Core Web Vitals, and produce dashboards that require statistical literacy to interpret.

Anglesite needs a testing approach that: works with static sites, produces zero layout flicker, requires no statistical knowledge from the owner, and keeps all data on the owner's infrastructure.

## Decision Drivers

* Zero layout flicker — variant must be resolved before HTML reaches the browser
* Static site compatibility — Astro generates static HTML, no server-side rendering in production
* Privacy by default — no third-party cookies or external analytics services
* Owner comprehension — results must be interpretable without statistical training
* Cloudflare-native — leverage existing infrastructure (Pages, KV, Analytics Engine, D1)

## Considered Options

* Build-time variants with edge assignment (Pages Function middleware)
* Client-side JavaScript variant swap
* Server-side rendering with variant selection
* Third-party A/B testing service (Optimizely, Google Optimize, VWO)

## Decision Outcome

Chosen option: "Build-time variants with edge assignment", because it eliminates layout flicker entirely (the correct variant HTML is served from the edge before any bytes reach the browser), works with Astro's static output, keeps all data on Cloudflare, and requires no client-side JavaScript.

### Architecture

1. **Build time:** Astro generates all variant HTML files as separate static pages (e.g., `index.html` and `index.variant-a.html`)
2. **Edge:** A Pages Function middleware intercepts requests, checks for an existing assignment cookie, assigns new visitors via weighted random selection, and serves the correct variant file
3. **Tracking:** Impressions are logged to Analytics Engine (non-blocking); conversions are logged from client-side beacon
4. **Analysis:** Bayesian A/B test (Beta-Binomial model with Monte Carlo simulation) runs on a schedule, producing plain-language summaries
5. **Storage:** Active config in KV (mutable without rebuild), outcomes in D1 (long-term learning)

### Consequences

* Good, because zero layout flicker — variant is selected at the CDN edge before HTML is served
* Good, because variant pages are fully static and independently cacheable (during non-experiment periods)
* Good, because Bayesian analysis is interpretable at any sample size — no fixed-duration requirement
* Good, because all data stays on the owner's Cloudflare account (Analytics Engine, KV, D1)
* Good, because the AI handles the full lifecycle — the owner just says what to test
* Bad, because pages under active experiment must set `Cache-Control: no-store` to prevent cross-variant cache contamination
* Bad, because each variant doubles the number of HTML files for that page during the test
* Bad, because Analytics Engine applies adaptive sampling at very high traffic — queries must account for `_sample_interval` (defensive, unlikely to affect small business traffic)
