---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# No third-party JavaScript in production

> **This is a default decision.** If you need a specific third-party script (e.g., a booking widget, live chat, or different analytics), tell your Webmaster — they'll add it to the CSP allowlist, update the pre-deploy scan, and record the change here.

## Context and Problem Statement

Third-party JavaScript (analytics, social embeds, chat widgets, ad networks) is the primary vector for visitor tracking, data collection, and security vulnerabilities on the modern web. The Webmaster agent must decide a default policy for external scripts on sites it builds for owners who may not understand the privacy and security implications.

## Decision Drivers

* Visitor privacy — no tracking, fingerprinting, or data collection without informed consent
* Security — every external script is an attack surface (supply chain attacks, XSS)
* Performance — external scripts add latency, block rendering, and increase page weight
* Legal compliance — GDPR, CCPA, and other regulations require disclosure of third-party data processors
* Owner simplicity — fewer moving parts means less to maintain and less to explain
* Content Security Policy — strict CSP headers are only practical with controlled script sources

## Considered Options

* No third-party JavaScript (with one exception)
* Selective third-party scripts with owner approval
* Standard analytics and social stacks (Google Analytics, social embeds, chat widgets)

## Decision Outcome

Chosen option: "No third-party JavaScript", with a single exception: Cloudflare Web Analytics, which is auto-injected by Cloudflare Pages, uses no cookies, collects no personal data, and requires zero setup. All other external scripts are blocked by default, enforced by the Content Security Policy and pre-deploy scans.

### Consequences

* Good, because visitors are not tracked, fingerprinted, or profiled
* Good, because no third-party data processors to disclose in a privacy policy
* Good, because the Content Security Policy can be strict — `script-src 'self' static.cloudflareinsights.com`
* Good, because no supply-chain risk from compromised external scripts
* Good, because pages load faster without external script requests
* Good, because the owner never receives a GDPR complaint about undisclosed tracking
* Bad, because the owner cannot add Google Analytics, social media embeds, or live chat without explicitly requesting a policy exception
* Bad, because some owners may expect these features and perceive their absence as a limitation

### Confirmation

The pre-deploy scan greps `dist/` for `<script src=` tags and blocks any that don't match `cloudflareinsights` or `_astro`. The Content Security Policy in `public/_headers` restricts `script-src` to `'self'` and `static.cloudflareinsights.com`. The `/anglesite:check` skill verifies both.

## Pros and Cons of the Options

### No third-party JavaScript (with Cloudflare Analytics exception)

* Good, because zero visitor tracking beyond privacy-respecting, cookieless analytics
* Good, because strict CSP is enforceable and effective
* Good, because no third-party data processors — simpler legal compliance
* Good, because eliminates entire categories of security risk
* Good, because fastest possible page loads
* Neutral, because Cloudflare Web Analytics is auto-injected by the hosting platform (not a script tag in source)
* Bad, because owners who want Google Analytics or social embeds must request an exception

### Selective third-party scripts with owner approval

* Good, because owner has flexibility to add services they want
* Good, because approval process ensures informed consent
* Bad, because each approved script weakens the CSP
* Bad, because the owner may not understand the privacy implications of what they're approving
* Bad, because ongoing maintenance burden — scripts update, break, or change data practices

### Standard analytics and social stacks

* Good, because matches what most conventional websites include
* Good, because familiar tools (Google Analytics, Facebook Pixel, etc.)
* Bad, because tracks visitors by default — requires cookie consent banners
* Bad, because adds third-party data processors requiring privacy policy disclosure
* Bad, because increases page weight and load time significantly
* Bad, because creates supply-chain security risk
* Bad, because contradicts the privacy-first values of the platform

## More Information

Preferred privacy-respecting alternatives to common third-party scripts:

| Instead of | Use |
|---|---|
| Google Analytics | Cloudflare Web Analytics (auto-included) |
| Google Maps embed | OpenStreetMap static image or link |
| Social media embeds | Static screenshots with links to original posts |
| Google Fonts CDN | System fonts or self-hosted WOFF2 (see ADR-0005) |
| Live chat widget | Contact form with Cloudflare Worker backend |
| YouTube embed | Link to video with a thumbnail image |

Each alternative eliminates a third-party dependency while preserving the functionality the owner needs.
