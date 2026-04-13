# Design Import Skill — Spec

**Date:** 2026-04-13
**Skill name:** `/anglesite:design-import`
**Status:** Phase 1 (Canva), Phase 2 (Figma)

## Summary

A new user-facing skill that imports design tokens and page layouts from design tools into Anglesite. The owner provides a URL to their published Canva site (or, in Phase 2, a Figma file link) and the skill extracts colors, fonts, content, and layout structure — then generates a complete Astro site with a design system seeded from the original design.

The approach is **semantic approximation with visual reference**: generated pages capture the design's intent using clean, responsive HTML/CSS and Anglesite's existing layout patterns, not pixel-perfect reproduction. Side-by-side comparison screenshots let the owner see where interpretation differs.

## Audience

Written for non-technical site owners (Canva design handed off by a designer), works for developers too. All complexity is behind the scenes.

## Phase 1: Canva

### Why Canva first

- Canva's free tier publishes to `*.my.canva.site` — a live URL we can scrape
- No authentication required
- Better match for Anglesite's primary audience (non-technical small business owners)
- Validates the generation pipeline before adding Figma API complexity

### Entry flow

1. Owner provides a URL (or is asked for one)
2. Skill detects source:
   - `*.my.canva.site` or `canva.site` in URL → Canva path
   - `figma.com/design/` or `figma.com/file/` in URL → Figma path (Phase 2 — friendly "coming soon" with workaround)
   - Unrecognized → ask if it's a design tool URL, suggest alternatives
3. Check Playwright installation (required — Canva sites are JS SPAs). Offer to install if missing. Same pattern as Wix import.
4. Scaffold the project if needed (same Step 0b/0c logic as import skill)

### Canva site characteristics

Canva published sites (`*.my.canva.site`) are:

- **JS SPAs** — initial HTML is a shell with `<div id="root">`, content hydrated by JS bundles. Playwright is mandatory; curl/WebFetch returns nothing useful.
- **Canvas-based layout** — elements are absolute-positioned with `transform: translate(Xpx, Ypx)` and explicit `width`/`height`. No semantic HTML (`<nav>`, `<header>`, `<article>`).
- **Hashed class names** — e.g. `onhyOQ`, `GDnEHQ`. Not stable, never match on them.
- **Inline styles** — colors as `rgb()` values on nested divs. No CSS custom properties.
- **Custom fonts** — user-chosen fonts loaded via `@font-face` in external CSS as WOFF2. Filter out Canva system fonts ("Canva Sans", "Noto Sans").
- **Images** — served from same subdomain at `media/<32-char-hex-hash>.<ext>`.
- **Multi-page** — up to 45 pages with path-based URLs. Auto-generated nav menu optional.
- **Minimal metadata** — `og:title` and `<title>` present, but usually no `og:description`, `og:image`, or JSON-LD.
- **No scraping restrictions** — published sites render in Playwright without bot detection.

### Extraction pipeline

**Script:** `scripts/design-import/canva-playwright.mjs`

**Output shape:**

```json
{
  "tokens": {
    "colors": ["#6CE5E8", "#41B8D5", "#FFF"],
    "fonts": ["Arimo", "Open Sans"],
    "colorRoles": {
      "background": "#FFF",
      "primary": "#41B8D5",
      "accent": "#6CE5E8",
      "text": "#333"
    }
  },
  "pages": [{
    "url": "/",
    "title": "Home",
    "sections": [{
      "bounds": { "x": 0, "y": 0, "width": 1280, "height": 600 },
      "elements": [{
        "type": "text",
        "content": "Welcome to Our Business",
        "style": { "fontSize": 48, "fontFamily": "Arimo", "color": "#FFF" },
        "bounds": { "x": 100, "y": 200, "width": 500, "height": 60 }
      }]
    }]
  }],
  "images": ["media/abc123.png"],
  "navigation": [{ "label": "Home", "path": "/" }]
}
```

**Extraction steps:**

1. Navigate to Canva site with Playwright, wait for SPA hydration (`networkidle`)
2. Extract tokens (first page only):
   - Scan all inline `style` attributes for `rgb()`/`rgba()` → deduplicate → rank by frequency
   - Parse `@font-face` rules from loaded stylesheets → filter out Canva system fonts → keep user-chosen fonts
   - Infer color roles: most-used background color, most-used text color, remaining prominent colors as primary/accent
3. Extract sections by finding `<section>` elements, reading child elements' positions, sizes, and content
4. Discover pages from navigation links, visit each subpage (skip token re-extraction)
5. Collect all image URLs across all pages for batch download

**Failure handling:**

- Playwright timeout on a page → add to `FAILED_PAGES`, continue with others
- No colors extractable → fall back to design-interview for manual color picking
- Low-confidence section classification → mark as generic, preserve content order

### Layout heuristics

**Script:** `scripts/design-import/layout-heuristics.mjs`

Since Canva uses absolute positioning with no semantic structure, sections are classified by spatial patterns:

| Heuristic | Classification |
|---|---|
| First section, contains large text + large image | Hero |
| Section with 2-4 evenly-spaced same-sized groups | Feature grid |
| Section with large image + quote-style text | Testimonial |
| Section with a form or email input | Contact/CTA |
| Section with small text + multiple links | Footer |
| Section with a single large block of body text | Content block |
| Section with 3+ images in a grid | Gallery |
| Anything unclassified | Generic section (preserve order) |

Heuristics won't be perfect — that's expected. The side-by-side comparison and semantic approximation approach mean imperfect classification still produces usable pages.

### Design system generation

**Color mapping:**

| Extracted role | CSS custom property |
|---|---|
| `background` | `--color-bg` |
| `primary` | `--color-primary` |
| `accent` | `--color-accent` |
| `text` | `--color-text` |

Uses luminance and contrast analysis (reusing `scripts/import/wix/color-utils.mjs`) when roles don't map cleanly. Remaining colors documented in `design.json` as supplementary palette.

**Font mapping:**

Canva loads custom web fonts, but Anglesite uses system font stacks (ADR-0005). Process:

1. Identify extracted font's character (geometric sans, humanist sans, slab serif, etc.)
2. Map to closest system font stack from `design-system.md`
3. Explain to owner: "Your designer used [Font] — I've matched it to a similar system font that loads instantly."

**Design axes inference:**

| Axis | Inference method |
|---|---|
| Temperature | Warm/cool hue analysis of primary + accent |
| Weight | Section density, spacing between elements |
| Register | Border-radius presence, font pairing |
| Time | Serif → classic, sans-serif → contemporary |
| Voice | Color saturation, contrast ratio |

Inferred axes seed `design.json` and `global.css` via existing `scripts/design.ts` functions. Owner can refine later with `/anglesite:design-interview`.

**Existing design system handling:**

If `src/design/design.json` already exists (owner previously ran `/anglesite:design-interview`), ask before overwriting:

> "You already have a design system set up. Would you like me to:
> 1. Replace it entirely with the colors and fonts from your Canva design
> 2. Keep your current design and just import the page layouts and content
>
> You can always adjust the design later."

If no existing design system, proceed without asking.

**Output files:**

- `src/styles/global.css` — updated CSS custom properties
- `src/design/design.json` — axes, palette, font choices
- `docs/design-rationale.md` — plain-English explanation of every decision

### Page generation

Classified sections assemble into `.astro` files:

| Section type | Astro output |
|---|---|
| Hero | `<section class="hero">` with h1, tagline, CTA button |
| Feature grid | `<section class="features">` with CSS Grid cards |
| Testimonial | `<blockquote>` with attribution |
| Content block | Prose section with headings + paragraphs |
| Gallery | Responsive CSS Grid image gallery |
| Contact/CTA | `<section class="cta">` with heading + button |
| Footer | Content folded into BaseLayout footer |
| Generic | `<section>` preserving text/image order |

**Principles:**

- Every page uses `BaseLayout`
- Semantic HTML throughout — not absolute-positioned divs
- Styles use design system CSS custom properties, not hardcoded values
- Responsive by default — Canva is fixed-width; generated pages are fluid
- Images downloaded to `public/images/` and optimized (same pipeline as import Step 2c)

**Text hierarchy** — determined by Canva font sizes:

| Relative font size | HTML element |
|---|---|
| Largest in section | `<h1>` (first) or `<h2>` |
| Second largest | `<h2>` or `<h3>` |
| Body-sized | `<p>` |
| Small | `<small>` or footer text |

Text that appears to be a button (small box + contrasting background + short text) → `<a class="button">`.

**Homepage:** Generates `src/pages/index.astro`, replacing scaffolded placeholder. Other pages → `src/pages/<slug>.astro` using slugified nav label.

**Navigation:** Built from extracted nav links. If no nav detected, built from discovered pages list.

**Not attempted:**

- Animations/hover effects — added later via `/anglesite:animate`
- Canva forms — noted as app-powered, suggest `/anglesite:contact`
- Exact pixel spacing — uses design system spacing scale

### Visual comparison

After pages generate and build succeeds:

1. Screenshot Canva site — Playwright captures each page at 1280px width
2. Screenshot built Astro site — start dev server, Playwright captures each page at same width
3. Save to `docs/design-import/comparison/` as `<page>-original.png` and `<page>-generated.png`

Screenshots are described to the owner in the summary and saved as reference files.

### Owner presentation

Plain-English summary after build verification:

> "I've built your site from your Canva design. Here's what happened:
>
> **Design system:** Extracted your brand colors and matched your fonts to fast-loading system equivalents.
>
> **Pages created:** N pages (list with section breakdown)
>
> **Images:** N downloaded and optimized
>
> **What's different from your Canva design:**
> - Layout is responsive (works on phones)
> - Fonts are system equivalents (faster loading)
> - [Any app-powered features noted with alternatives]
>
> Comparison screenshots saved in `docs/design-import/comparison/`."

### Commit and next steps

```
git add -A
git commit -m "Import design from Canva (N pages, design system)"
```

Offer: deploy, review in Keystatic, or run design-interview to refine.

## Phase 2: Figma

### Figma API adapter

When owner provides a `figma.com/design/` URL:

1. Walk through personal access token creation (step-by-step plain English)
2. Use Figma REST API:
   - `GET /v1/files/:key` — file structure, pages, frames
   - `GET /v1/files/:key/nodes?ids=...` — frame data with styles
   - `GET /v1/images/:key?ids=...` — export frames as PNG for comparison
   - `GET /v1/files/:key/styles` — published color and text styles

### Figma advantages over Canva

- Named color styles → direct role mapping (no heuristics needed)
- Named text styles → direct heading-level mapping
- Auto-layout frames → hints at flex/grid behavior
- Component structure → repeated components suggest cards, buttons
- Explicit page organization → clean page mapping

### Shared with Canva path

- Layout heuristics still needed (not all files use auto-layout)
- Same semantic approximation approach
- Same design system generation pipeline
- Same comparison screenshot flow
- Same owner presentation format

### Interim behavior (Phase 1)

When Figma URL detected:

> "Figma import is coming soon! In the meantime:
> 1. If your designer can export a PDF, I can extract colors, fonts, and layout
> 2. Or we can build from scratch — `/anglesite:design-interview`"

PDF path uses lightweight color/font extraction without Playwright.

## File inventory

### New files

| File | Purpose |
|---|---|
| `skills/design-import/SKILL.md` | User-facing skill (entry point, flow orchestration) |
| `skills/design-import/canva-extract/SKILL.md` | Model-only sub-skill for Canva extraction |
| `scripts/design-import/canva-playwright.mjs` | Playwright extraction for Canva sites |
| `scripts/design-import/layout-heuristics.mjs` | Spatial → semantic section classification |
| `scripts/design-import/comparison.mjs` | Side-by-side screenshot generation |
| `docs/import/canva-site.md` | Canva platform extraction guide |

### Modified files

| File | Change |
|---|---|
| `CLAUDE.md` | Add design-import to skill tables |
| `docs/import/README.md` | Add Canva entry to hosted platforms list |

### Reused existing code

| File | What's reused |
|---|---|
| `scripts/import/wix/color-utils.mjs` | Luminance, contrast, color classification |
| `scripts/design.ts` | `axesFromBusinessType`, design axis generation |
| `docs/content-conversion.md` | Image optimization pipeline |

## Architecture decisions

- **Canva first, Figma second** — Canva is scrape-ready with no auth, matches primary audience, validates the pipeline
- **Playwright mandatory for Canva** — sites are JS SPAs, no static HTML to scrape
- **Semantic approximation** — clean responsive HTML, not pixel reproduction of canvas layouts
- **Reuse color-utils.mjs** — proven color analysis already exists for Wix import
- **System font mapping** — consistent with ADR-0005, no external font dependencies
- **Normalized intermediate format** — extraction produces a standard shape so Figma adapter slots in without reworking generation code
- **Comparison screenshots as files** — no browser UI dependency, owner can open and inspect at their pace
