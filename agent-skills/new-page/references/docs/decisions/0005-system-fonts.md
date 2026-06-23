---
status: accepted
date: 2025-01-01
decision-makers: [Anglesite maintainers]
---

# Use system font stacks instead of external font CDNs

> **This is a default decision.** It can be revisited if your brand needs a specific typeface. To change it, tell your Webmaster — they'll self-host your chosen font as WOFF2 files, update the styles, and mark this ADR as superseded.

## Context and Problem Statement

Typography is central to a website's visual identity. The agent needs to select fonts during the design interview that match the owner's brand. The font delivery method affects page load performance, visitor privacy, and legal compliance (particularly under GDPR).

## Decision Drivers

* Zero external network requests for fonts — fastest possible text rendering
* No privacy risk from third-party font CDNs sending visitor IPs to external servers
* No GDPR compliance burden (German courts have ruled Google Fonts violates GDPR)
* Fonts render instantly — no flash of invisible/unstyled text (FOIT/FOUT)
* Familiar, readable typefaces that work across all operating systems

## Considered Options

* System font stacks
* Google Fonts CDN
* Self-hosted web fonts (WOFF2 files)
* Adobe Fonts (Typekit)

## Decision Outcome

Chosen option: "System font stacks", because they render instantly with zero network requests, pose no privacy or GDPR risk, and produce familiar, high-quality typography on every operating system. When an owner requires a specific typeface for brand consistency, self-hosted WOFF2 files are the fallback approach.

### Consequences

* Good, because text renders on the first frame — no layout shift from font loading
* Good, because zero external requests means zero privacy exposure to font CDNs
* Good, because no GDPR liability from Google Fonts or similar services
* Good, because fonts are familiar to visitors on each platform (San Francisco on Apple, Segoe on Windows, Roboto on Android)
* Good, because no font files to host, cache-bust, or update
* Bad, because the exact typeface varies by operating system — less precise brand control than a custom font
* Bad, because some brand identities genuinely need a specific typeface (mitigated by self-hosting WOFF2 as a documented fallback)

### Confirmation

The `/anglesite:check` skill scans the built HTML for any `<link>` tags pointing to external font CDNs (fonts.googleapis.com, use.typekit.net, etc.) and flags them. The Content Security Policy in `public/_headers` restricts `font-src` to `'self'`.

## Pros and Cons of the Options

### System font stacks

Four curated stacks cover the design spectrum:
- **Modern**: `system-ui, -apple-system, sans-serif`
- **Classic**: `Georgia, "Times New Roman", serif`
- **Humanist**: `"Segoe UI", Roboto, sans-serif`
- **Mono**: `ui-monospace, "SF Mono", monospace`

* Good, because instant rendering, zero network requests
* Good, because no privacy exposure or GDPR risk
* Good, because zero maintenance — OS updates improve the fonts automatically
* Neutral, because fonts vary by operating system
* Bad, because limited to what operating systems provide

### Google Fonts CDN

* Good, because thousands of free, high-quality typefaces
* Good, because widely cached across websites (though this benefit has diminished with cache partitioning)
* Bad, because sends visitor IP to Google on every page load
* Bad, because German courts ruled this violates GDPR (LG München, Jan 2022)
* Bad, because adds render-blocking network requests
* Bad, because introduces a third-party dependency and potential single point of failure

### Self-hosted web fonts (WOFF2 files)

* Good, because full typographic control with no external dependency
* Good, because no privacy risk — files served from same origin
* Good, because WOFF2 compression is efficient (~30% smaller than WOFF)
* Neutral, because adds font files to the project (typically 20-100KB per weight)
* Bad, because requires font subsetting for optimal performance
* Bad, because licensing must be verified for each typeface
* Bad, because adds a brief flash of unstyled text while fonts load

### Adobe Fonts (Typekit)

* Good, because high-quality, professionally designed typefaces
* Bad, because requires a paid Creative Cloud subscription
* Bad, because fonts loaded from Adobe's CDN — same privacy concerns as Google Fonts
* Bad, because fonts stop working if the subscription lapses
* Bad, because adds external dependency and render-blocking request

## More Information

Self-hosted WOFF2 is the documented escape hatch for owners who need a specific typeface. The process: download the font, subset to needed characters, add `@font-face` declarations in `global.css`, and update the `--font-family-*` custom property. This keeps fonts under `font-src 'self'` in the CSP.
