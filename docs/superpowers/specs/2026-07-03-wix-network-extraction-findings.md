# Wix network-layer extraction via Safari MCP — prototype findings

**Date:** 2026-07-03
**Status:** Exploratory — NOT wired into the import skill; requires a new ADR before adoption
**Companion to:** [2026-07-03-safari-import-backend-design.md](2026-07-03-safari-import-backend-design.md) (which listed this as follow-up: "Network-body extraction (Wix warmupData via list_network_requests/get_network_request)")
**Prototype code:** `scripts/import/browser/wix-network.mjs` (standalone module + CLI, designed to become `safari-driver.mjs --network`)

## Question

Can Wix blog-post and static-page content be recovered from captured JSON payloads
(via the Safari MCP `list_network_requests` / `get_network_request` tools) with
higher fidelity than the DOM TreeWalker path in
`scripts/import/browser/page-functions.mjs`?

## Recommendation

**GO for blog posts. NO-GO (for now) for static pages.**

- Blog posts: network extraction is strictly higher fidelity than the DOM path
  on every dimension measured, works across both live blog delivery
  generations, and hit no payload size limits. Ship it as a `--network` mode
  that the blog-post flow tries first, with the DOM path as the automatic
  fallback (`post: null` → DOM).
- Static pages: content is recoverable from JSON but scattered across multiple
  payload generations and files with no single reading-order source; the DOM
  TreeWalker already normalizes all of that post-render. Keep the DOM path.
  One cheap enrichment is worth taking: the captured main document's JSON-LD +
  OpenGraph metas (title, description, canonical image) come free in network
  mode and can top up static-page metadata.

## What was validated live (2026-07-03, Safari Technology Preview 247)

Test targets:

| Page | Kind | Delivery generation |
|---|---|---|
| wix.com/blog/how-to-build-website-from-scratch-guide | blog post | SSR warmup + adapter XHR |
| wix.com/blog/what-is-a-domain | blog post | SSR warmup + adapter XHR |
| wix.com/blog/how-to-start-a-blog | blog post | SSR warmup + adapter XHR |
| wix.com/demone2/atelier-allure/post/from-desk-to-dinner… | blog post (template demo) | adapter XHR only |
| wix.com/demone2/wh-milas-bakery | static page (template demo) | siteassets page JSON |

### Mechanics confirmed

- **Arming:** the Inspector buffer needs an *active browsing context* before it
  can be armed — `list_network_requests` fails with "No active browsing
  context" on a fresh session. Open `about:blank`, arm once, then navigate;
  recording covers all subsequent navigations. `{clear: true}` resets the
  per-tab buffer between URLs — exactly what a multi-URL NDJSON loop needs.
- **Size cap:** `get_network_request` returned complete bodies of **2.45 MB**
  (wix.com blog post main document) and **3.6 MB** (bakery demo main document),
  with `response_body_size_bytes` matching and `</html>` intact. No truncation
  observed at any size a Wix page produced. The cap, wherever it is, is not a
  practical constraint.
- **Fidelity of capture:** the warmup JSON extracted from the network body was
  **byte-identical** (512,996 chars) to the same script tag read from the live
  DOM — the network path loses nothing.

### Where Wix blog content lives (two generations, one format)

1. **Adapter API** (current standard blog OOI; fired by both test sites):
   `GET _api/blog-frontend-adapter-public/v2/post-page/<slug>` returns
   `postPage.post.richContent` (Ricos) plus **resolved** categories
   (label + URL), owner name, `firstPublishedDate`/`lastPublishedDate`,
   `minutesToRead`, original-resolution cover media, and `seoData`.
   Body size observed: ~15 KB.
2. **SSR warmup** (wix.com-style Studio blog): the main document embeds
   `<script id="wix-warmup-data" type="application/json">` (513 KB observed);
   `appsWarmupData.<blog-app-guid>.ctx.post` carries the same Ricos
   `richContent` plus title/slug/excerpt/dates. Author and category are GUIDs
   here — but the same document's **BlogPosting JSON-LD** resolves the author
   name, and OpenGraph metas supply canonical title/description/image.

Both generations share the Ricos node format, so one converter
(`ricosToMarkdown`) serves both. The prototype tries the adapter XHR first,
falls back to warmup, and returns `null` when neither has a post (static
pages) — the signal to use the DOM path.

## Fidelity comparison (blog posts)

Measured on wix.com/blog/how-to-build-website-from-scratch-guide (22-min post:
6 tables, 5-item FAQ collapsible, 1 video, 15 images, 3 buttons):

| Dimension | DOM TreeWalker (`extractContentSrc`) | Network (Ricos + JSON-LD + OG) |
|---|---|---|
| Headings | levels recovered from H1–H6 tags | native `headingData.level` — identical quality |
| Tables | flattened into sequential text blocks; row/column structure destroyed | GFM tables with header row (6/6 converted) |
| Collapsibles/FAQ | text present only because this template SSRs it; structure lost; other templates need `expandAccordions` clicking + animation waits | structured title/body pairs, no interaction needed (5/5) |
| Images | rendered variant URLs (`…/v1/fill/w_1532,h_954,q_90/…`) — downscaled, recompressed | media IDs → **original-resolution** `static.wixstatic.com/media/<id>` + intrinsic width/height + alt (15/15) |
| Video | invisible (iframe player) | YouTube source URL from `videoData` |
| Buttons/CTAs | mixed into text blocks | explicit `[text](url)` |
| Bold/links | links yes; bold lost (visual style only) | semantic `BOLD`/`LINK`/`ANCHOR` decorations |
| Author | not extracted | "Allison Ko" / "Judit Ruiz Ricart" (JSON-LD or `owner.name`) |
| Dates | not extracted | published + modified ISO dates |
| Categories/tags | footer-link scrape, empty on both test sites | resolved labels via adapter API (both test posts) |
| Excerpt/slug/cover | not extracted | native fields |
| Content boundaries | promo banners and site chrome leak into body | Ricos tree is content-only by construction |

Output size: 43.8 KB markdown vs 42.1 KB DOM text for the same post — same
prose, plus structure the DOM version lost.

## Robustness

- **Across template variants:** the two delivery generations above are the
  live population for current Wix blogs (all Thunderbolt). The prototype's
  value-shape search (`ctx.post.richContent` under any `appsWarmupData` key;
  adapter XHR matched by URL path) avoids hardcoding app GUIDs. Legacy
  pre-Thunderbolt sites won't match either source and fall through to the DOM
  path cleanly — fallback is the existing behavior, so the worst case equals
  today's fidelity.
- **Failure mode observed:** none of the five test pages errored; the static
  page correctly returned `null`. Per-URL errors emit `{url, error}` NDJSON
  lines consistent with the driver design's contract.
- **Bot-throttling:** capture rides the real-Safari session, so it inherits
  the Safari backend's fingerprint advantage over curl (the reason wix.com
  works here but throttles `wix-extract.mjs`).

## Why static pages are NO-GO for now

Evidence from the bakery demo (classic template, Studio-generation payloads):

- Page copy lives in `siteassets…/pages/pages/thunderbolt` responses at
  `props.render.compProps.<compId>.richText.html` (33 fragments) — but that
  payload has **no reading order** (component tree lives partly in `structure`,
  partly in other siteassets files) and **no image URIs** (backgrounds and
  galleries resolve elsewhere).
- Older classic-editor sites use a different schema generation
  (`data.document_data` StyledText) — two divergent formats to support.
- Reassembling order + images + text across 4–6 payloads reimplements what the
  browser already did; the DOM TreeWalker reads the final result uniformly
  across all generations. Fidelity gain: marginal (fragments are semantic HTML,
  but so is the rendered DOM). Cost: high. Not worth it.

## Draft `--network` mode

`scripts/import/browser/wix-network.mjs` is the working draft. It is
deliberately a sibling module of `safari-mcp.mjs` because `safari-driver.mjs`
(planned in the companion design, branch `claude/blissful-mendeleev-a2581c`)
does not exist yet. Integration once the driver lands:

- `safari-driver.mjs --network <url…>`: for each URL call
  `extractPostViaNetwork(mcp, url)`; on `null`, run the existing DOM
  `extractContentSrc` path in the same session (no second navigation needed —
  the page is already loaded). Emit the same NDJSON contract, with `post`
  replacing/augmenting `content`.
- The module already implements the arming dance, per-URL buffer clears,
  adapter-first source selection, Ricos→Markdown (paragraphs, headings, bold/
  italic/links, ordered/bulleted/nested lists, GFM tables, collapsibles,
  images, video, buttons, dividers), and a `--from-file` offline mode for
  fixture-based tests.

CLI today:

```sh
node scripts/import/browser/wix-network.mjs <url…>        # NDJSON {url, post}
node scripts/import/browser/wix-network.mjs --raw <url>    # raw warmup post JSON
node scripts/import/browser/wix-network.mjs --from-file <captured-body> <url>
```

## Open questions for the ADR

1. Should network mode be the default for Wix blog posts (DOM as fallback), or
   opt-in? Prototype evidence supports default-on.
2. The Wix MCP (first in the Wix chain per the companion design) already
   returns blog content for sites the owner controls — network mode matters
   for *imports of sites the owner can't authenticate to* (competitor
   migration, agency handoffs). The ADR should position it in the chain
   explicitly (proposed: Wix MCP → RENDER_BACKEND network mode → DOM → curl).
3. Fake-safaridriver fixture coverage: the test fixture needs `list_network_requests`
   /`get_network_request` support (arming error, `clear`, filter, body detail)
   plus a recorded adapter-API body and a warmup main document
   (the `--from-file` mode makes the converter testable without any of that).
4. Category/tag GUID resolution for the warmup generation: acceptable to leave
   empty, or worth a follow-up call to `communities-blog-node-api/v3/categories`
   (observed in the request log)?
