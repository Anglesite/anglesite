# Astro Animate in Anglesite — design

**Date:** 2026-07-27
**Status:** Approved (brainstorm 2026-07-27)
**Repos:** `Anglesite/Anglesite-app` (template + app gallery), `Anglesite/anglesite` (skill + ADR amendment)

## Context

[Astro Animate](https://www.astroanimate.com) is an MIT-licensed, Astro-native animated
component library. As of 2026-07-27 only **`@astroanimate/core@0.1.2`** is published on
npm — the `@astroanimate/aos`, `@astroanimate/gsap`, and `@astroanimate/motion` packages
advertised on the website do not exist yet. Core is a ~32-component animated UI kit
(FadeInText, CountUp, InfiniteMarquee, GlassCard, Dock, TypewriterText, …) built
CSS-first: components render meaningful content with zero client JS by default, opt into
an IntersectionObserver path via an `enhance` prop, and respect
`prefers-reduced-motion`. Its peer dependency range is `astro ^4 || ^5 || ^6`; the
Anglesite template runs Astro `^7.1.3`, so installing it requires an npm `overrides`
pin. Inspection of the shipped components shows no version-specific Astro APIs — the
peer range is conservative, not a known incompatibility.

Anglesite today has two animation-adjacent lanes:

- The sidecar's conversational **`/animate` skill** — a "motion designer" that
  hand-writes vanilla CSS, bound by ADR-0004 (vanilla CSS custom properties) and
  ADR-0008 (no third-party JavaScript).
- The app's deterministic **Integration Wizard**
  (`Sources/AnglesiteCore/IntegrationCatalog.swift` + `Resources/Template/integrations/`)
  for capabilities needing configuration.

## Decisions (from the brainstorm)

1. **Bake into the template.** `@astroanimate/core` ships as a default template
   dependency; every new site has it with no install step. The wizard is not the
   vehicle — this capability needs no keys or configuration.
2. **npm dependency, not vendored.** Track upstream via the package (exact-pinned),
   accepting the peer-override cost. If upstream dies, the MIT license lets us vendor
   the curated components later without breaking sites.
3. **Adopt future sub-packages deliberately.** `aos`/`gsap`/`motion` are adopted in a
   follow-up decision if/when they actually publish — not designed for now.
4. **Skill stance: CSS-first, library as escalation.** The `/animate` skill keeps
   vanilla CSS as its default craft and reaches for Astro Animate components when CSS
   can't deliver well (spring-like physics, orchestrated sequences, counters,
   marquees).
5. **Full product surface.** Curated manifest + docs + smoke tests + an app-side
   gallery UI (approach C).

## Goals

- A website owner can browse real, animating previews of the curated components in the
  app and get one into a page via copy-paste or the assistant.
- The `/animate` skill escalates to real component names and props instead of
  hallucinating an API.
- Breakage from the Astro-7 peer override or upstream churn is caught by CI, not by
  owners.

## Non-goals

- No deterministic "insert component into page X at position Y" machinery — placement
  stays conversational.
- No adoption of unpublished sub-packages; no GSAP runtime.
- No exposure of all 32 components — only the vetted subset.

## Architecture

### 1. Template capability (`Resources/Template/`, app repo)

- `package.json`: add `"@astroanimate/core": "0.1.2"` (exact pin, no caret) to
  `dependencies`, plus:

  ```json
  "overrides": { "@astroanimate/core": { "astro": "$astro" } }
  ```

  so npm resolves the peer dependency to the template's Astro without `ERESOLVE`
  failures. Regenerate `package-lock.json`.
- **Curation manifest** — `integrations/animations.json`, the single source of truth
  consumed by both the docs and the app gallery. Per entry:
  `component`, `title`, `ownerDescription` (owner-language, e.g. "a number that counts
  up when it scrolls into view"), `category` (`text` | `cards` | `buttons` |
  `backgrounds` | `navigation`), `keyProps`, `snippet` (import + usage). Only
  components that pass a curation pass are listed: renders under Astro 7, respects
  `prefers-reduced-motion`, slot content meaningful without JS, **and emits zero
  `<script>` tags under the cataloged props**. The last rule is load-bearing: the
  template CSP is `script-src 'self' 'wasm-unsafe-eval' …` with no `'unsafe-inline'`
  and no hashes, and the library's `enhance=true` mode emits `is:inline` scripts that
  the CSP would block in production. v1 catalogs CSS-only usage (`enhance` stays
  `false`); JS-requiring components are excluded.
- **Docs** — `integrations/docs/animations.md` beside the existing setup docs: the
  human/agent-readable catalog (kept in sync with the manifest; a template test
  cross-checks the two).
- **Container image** — the image bakes the template's full `node_modules`, so this
  change re-vendors the image (both vendor scripts + rebuild).

### 2. App gallery (app repo)

**Website ▸ Animations…** menu item opening a gallery:

- **Preview without the dev server.** A template script (built on the existing
  `component-harness`) prerenders each curated component demo into self-contained
  static HTML (the components are scoped CSS + optional inline scripts, so prerendered
  demos animate for real). The demo files are **generated and committed** under
  `Resources/Template/integrations/` — a template test regenerates and diffs them so
  stale demos fail CI — and the app bundles them as resources. The gallery is a
  SwiftUI list (categories from `animations.json`) with a `WKWebView` rendering the
  selected demo — works offline, before any site container boots, and nothing can leak
  preview pages into a deployed site.
- **Actions:** *Copy snippet* (from the manifest) in v1. An *Add with assistant*
  action (pre-filling the chat) is deferred: the app currently has no chat-prefill
  API, and inventing one is out of scope here — tracked as a follow-up in the gallery
  issue.
- Gallery model code lives in `AnglesiteCore` (manifest decoding, snippet provision) so
  it's testable without the app host; the SwiftUI shell stays thin.

### 3. Sidecar changes (`Anglesite/anglesite`, separate PR)

- **ADR-0008 extended, not reversed.** The ADR already carves out npm-installed,
  Astro-bundled libraries (p5.js, Three.js, GSAP, …) as *first-party* under
  `script-src 'self'` ("Creative coding libraries (not third-party)"). The change is a
  one-paragraph extension naming animation component libraries (`@astroanimate/core`)
  under the same carve-out, plus a note that its `enhance` mode emits inline scripts
  the template CSP blocks — CSS-only usage is the supported mode.
- **`/animate` skill** gains an escalation section: vanilla CSS by default; for effects
  CSS can't do well, consult the site's `integrations/docs/animations.md` and use the
  cataloged components by name with their real props. The preview-before-apply and
  reduced-motion rules apply unchanged.

Ordering: app PR lands first (capability exists in sites), sidecar PR follows. This is
not an MCP schema change, so no paired-PR requirement.

## Testing

- **Template suite** (`npm test` in `Resources/Template/`): a harness smoke test
  renders every curated component, asserting its marker attribute and reduced-motion
  CSS are emitted; a consistency test asserts every `animations.json` entry resolves to
  a real component in the installed package and appears in `animations.md`. This is the
  tripwire that turns "peer override silently breaks on a future Astro major" into red
  CI.
- **Swift suite:** tests for manifest decoding, category grouping, and snippet
  provision; run the template-coupled guards (`IntegrationTemplateAssetsTests`,
  `ProjectValidator` suites) since template files change.
- **Container:** re-vendor, rebuild, and verify site preview boots.

## Risks

| Risk | Mitigation |
| --- | --- |
| Upstream is 0.1.x, single maintainer | Exact pin; MIT fallback to vendoring the curated subset |
| Peer override masks a real future incompatibility | Harness smoke test over every curated component |
| Advertised sub-packages never ship | Core-only design; sub-packages are an explicit later decision |
| A11y regressions from library components | Curation gate requires reduced-motion + no-JS fallback per component |
| Bundle bloat | CSS-first (~0.5 KB/component, JS only with `enhance`); no CSP/external domains |
| `enhance=true` inline scripts blocked by strict CSP | Curation gate: catalog only zero-`<script>` usage; smoke test enforces |

## Rollout / process

1. Open a tracking issue proposing the `@astroanimate/core` template dependency
   (CONTRIBUTING requires explicit dependency approval in an issue) and claim it with
   the `🛠️ In Progress` label.
2. App PR: template dependency + manifest + docs + harness tests + gallery + container
   re-vendor. Template changes are app-only.
3. Sidecar PR: ADR amendment + `/animate` escalation section.
4. Follow-up (untracked until relevant): revisit when upstream publishes Astro 7
   support or the `aos`/`gsap`/`motion` packages.
