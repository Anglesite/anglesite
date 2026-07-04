# Safari-backed rendered extraction for the design-import skill (Canva)

**Date:** 2026-07-03
**Status:** Implemented
**Builds on:** `2026-07-03-safari-import-backend-design.md` (this was its named follow-up)

## Assessment

**Authenticated-session caveat: not a blocker.** The design-import skill only
accepts *published* Canva sites (`*.my.canva.site`, Step 0b) — public URLs.
`canva-playwright.mjs` already launches a fresh headless Chromium with no
cookies or storage state, so the extraction has never depended on logged-in
state. Safari MCP's isolated WebDriver session (no user cookies) provides an
equivalent context. Editor URLs on `canva.com`, which would require auth, are
rejected by the skill before extraction on both backends.

**Figma: nothing to migrate.** Step 0b's Figma branch is a "coming soon"
message with no extraction code. If Figma extraction is added later it should
resolve RENDER_BACKEND the same way.

## Architecture

Sibling-driver pattern, mirroring the Wix/Squarespace backend:

- **`scripts/design-import/canva-safari.mjs`** — CLI with the exact
  `canva-playwright.mjs` output contract (`{tokens, sections, navigation,
  images}` per page; `--site` → `{tokens, pages, images, navigation}`), plus
  `--check` with the shared exit codes (0 usable / 2 not installed / 3 not
  enabled / 4 session failure).
- **Page adapter, not a rewrite:** `extractCanvaPage`/`crawlCanvaSite` only use
  four Playwright `page` methods (`goto`, `waitForSelector`, `waitForTimeout`,
  `evaluate`). `safariPage(mcp)` implements them over the shared
  `scripts/import/browser/safari-mcp.mjs` client, so the Canva extractors and
  crawl logic run unmodified on both backends. `evaluate` serializes page
  functions as bare IIFE expressions (`(${String(fn)})()`) — Safari's
  `evaluate_javascript` rejects top-level `return` — and the extractors are
  closure-free, referencing only browser globals.
- **`canva-playwright.mjs`** — the crawl loop moved to an exported
  `crawlCanvaSite(page, baseUrl)`; `extractCanvaSite` now wraps it with a
  Playwright browser. Exports, CLI, and behavior unchanged.
- **`skills/design-import/SKILL.md`** — Step 1 is now "Choose a browser
  backend": `canva-safari.mjs --check` first (exit-code branching, one-time
  enable instructions on exit 3), Playwright as the fallback branch; Step 2
  invokes the resolved RENDER_BACKEND driver; Step 6's comparison screenshots
  remain Playwright-only and stay skippable.

Safari stays an optional macOS accelerator; Playwright remains the
cross-platform path (root CLAUDE.md rule, ADR-0021 precedent, ADR-0024 once
the import-skill branch lands it).

## Testing

`test/canva-safari.test.js` drives the CLI end-to-end against
`test/fixtures/fake-safaridriver.mjs`, extended with Canva canned responses
keyed on markers unique to each serialized extractor (`FONT_FACE_RULE`,
`data-section-id`, `nav a[href]`, `img[src]`) so they cannot shadow the Wix
responses. Covers `--check` exit codes, the single-page contract (token
classification through the real `canva-colors`/`canva-fonts` pipeline),
`--content-only`, the `--site` crawl (subpage discovery, homepage-only tokens,
image dedup), and all-pages-failed exit 1.

Live-site validation (macOS, automation enabled):
`node scripts/design-import/canva-safari.mjs --check` → exit 0, then
`node scripts/design-import/canva-safari.mjs --site "https://<site>.my.canva.site"`
and diff the JSON shape against the Playwright driver's output for the same URL.

## Out of scope

- Figma extraction (does not exist on any backend)
- Safari-based comparison screenshots (Step 6 stays Playwright-only)
- The import skill's own Step 1a.2 / `safari-driver.mjs` (Tasks 4–8 of the
  base plan, tracked in `2026-07-03-safari-import-backend.md`)
