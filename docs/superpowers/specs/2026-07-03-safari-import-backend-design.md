# Safari-backed rendered extraction for Wix + Squarespace imports

**Date:** 2026-07-03
**Status:** Approved
**Owner decisions:** Safari preferred over Playwright when both are available; full Squarespace rendered tier (tokens + accordions + galleries) in this change; sibling-driver-script architecture.

## Problem

Wix and Squarespace are the lowest-fidelity import sources. Wix requires a ~150 MB Playwright chromium install for static pages, design tokens, and JS widgets, and throttles curl scraping. Squarespace has **no rendered-extraction tier at all**: design tokens are never extracted, collapsed accordions are invisible to WebFetch, and gallery images require manual URL surgery.

Apple's Safari MCP server (`safaridriver --mcp`, shipped in Safari Technology Preview 247, July 2026) was validated live on 2026-07-03: a plain Node script can spawn it and speak newline-delimited JSON-RPC over stdio with no MCP client configuration, and the plugin's existing extraction page-functions run unmodified inside it via `evaluate_javascript`.

## Architecture

New platform-neutral layer at `scripts/import/browser/`. Backend resolution happens once per import, in a new SKILL.md Step 1a.2, producing `RENDER_BACKEND`:

- **Wix chain:** Wix MCP (blog content, unchanged) → RENDER_BACKEND (**Safari → Playwright**) → curl+regex → WebFetch
- **Squarespace chain:** WXR export (primary, unchanged) → `?format=json` (new, curl-only) → RENDER_BACKEND for what exports can't reach (design tokens, accordion content, gallery images)

Safari outranks Playwright when both are usable: no npm install, real-Safari fingerprint against bot throttling, and the owner can see the window working. Playwright remains the only rendered option on Linux/Windows and the automatic fallback on macOS.

## Components

### `scripts/import/browser/page-functions.mjs`

`extractStylesSrc`, `extractContentSrc`, and `expandAccordions` move here from `scripts/import/wix/wix-playwright.mjs`, which re-imports them — its exports, CLI, and behavior are unchanged. Selector lists gain Squarespace patterns (`.sqs-block-content` content roots, `.sqs-block-accordion` accordions) alongside the existing Wix hooks (`[data-hook="post-description"]`, `#PAGES_CONTAINER`) and the generic `main` fallback.

### `scripts/import/browser/safari-mcp.mjs`

A ~100-line stdio JSON-RPC client (hardened from the validated probe): spawn, `initialize` handshake (protocol `2024-11-05`), `call(tool, args, timeoutMs)`, kill-on-close. Three error classes:

- `not-installed` — no safaridriver binary with `--mcp` support found
- `not-enabled` — session creation fails with the "Allow remote automation" WebDriver error
- `page-failure` — per-URL tool errors

Binary discovery order: `SAFARIDRIVER_PATH` env override → `/usr/bin/safaridriver` → `/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver`. Each candidate is probed with `--help` output containing `--mcp`, so the backend starts working with stable Safari automatically when Apple ships it there.

### `scripts/import/browser/safari-driver.mjs`

CLI with the same output contract as `wix-playwright.mjs`:

```sh
node safari-driver.mjs <url…> [--content-only|--styles-only|--fullPage]
node safari-driver.mjs --check
```

(No `--platform` flag: the unified selector cascade in `page-functions.mjs` covers Wix, Squarespace, and generic pages by probing selectors in order.)

- **Multiple URLs, one session:** each `safaridriver --mcp` process is an isolated session (tabs die with the process), so the CLI accepts many URLs and emits **NDJSON** — one `{url, tokens?, content}` line per page — from a single spawned session/window.
- Per-page flow: navigate → wait → `expandAccordions` → `extractContentSrc` → (homepage or `--styles-only`) `extractStylesSrc` → hex-convert samples (mirroring `wix-playwright.mjs:380-385`) → `classifyTokens` from `color-utils.mjs`.
- Validated gotchas encoded: `evaluate_javascript` rejects top-level `return` (use bare IIFE expressions); `get_page_content` defaults truncate paragraphs to 15 words and strip URL params — the rescue path sets `maxWordsPerParagraph: 5000`, `shortenURLs: false`.
- **Empty-body rescue:** if the injected extractor returns an empty body, fall back to `get_page_content` (markdown, `region: "entire_page"`) for that page and map best-effort into `{body, images}`.

## Skill and docs changes

- **`skills/import/SKILL.md`**
  - New Step 1a.2 "Rendered-page backend detection" (runs for platforms needing rendering): run `safari-driver.mjs --check`; on exit 0 set `RENDER_BACKEND=safari`. On "installed but not enabled" (exit 3), show the owner the two-checkbox instructions once (Settings → Advanced → "Show features for web developers"; Settings → Developer → "Allow remote automation") and offer to continue with Playwright instead. Otherwise follow today's Playwright install prompt.
  - Steps 2a / 3b / 5.5 become backend-agnostic: same invocation shape and JSON contract, either driver.
  - Squarespace flow gains the rendered-tier steps (tokens on homepage, accordion pages, gallery pages); Step 5.5 token application no longer Wix-only.
  - The skill tells the owner a Safari window will open and that they should not interact with it during extraction.
- **`docs/import/squarespace.md`**: new extraction method — `?format=json` returns the page's structured JSON (`mainContent` HTML + site config) via plain curl (validated live 2026-07-03); new "Rendered extraction" section for tokens/accordions/galleries via RENDER_BACKEND.
- **`docs/import/wix.md`**: Safari backend section ahead of the Playwright section; Playwright text updated to fallback framing.
- **`docs/decisions/0024-safari-rendered-extraction-backend.md`** (+ index entry in `docs/decisions/README.md`): Safari MCP as an optional on-device rendered-extraction backend — mirrors ADR-0021's `fm` accelerator pattern (free/local/optional, never required, cross-platform fallback preserved).
- **`agent-skills/` regeneration**: `npm run build:agent-skills` must run after SKILL.md changes; CI fails if the export is stale.

## Error handling

- `--check` exit codes: `0` usable, `2` not installed, `3` not enabled, `4` session failure. The skill branches on codes, not prose.
- Per-URL failures emit `{url, error}` NDJSON lines; the skill falls back per-page exactly as it does for Playwright timeouts today (curl+regex for Wix, WebFetch for Squarespace).
- Timeouts: 30 s navigation, 60 s per-page cap; the child process is killed on exit/signal so no orphaned Safari windows.

## Testing

- A **fake safaridriver** test fixture (small Node script speaking MCP over stdio) lets CI exercise everything cross-platform without Safari: handshake, timeouts, the three error classes (including the exact not-enabled error string), NDJSON output shape, `--check` exit codes, and the empty-body rescue.
- `page-functions.mjs` keeps existing coverage via the unchanged `wix-playwright.mjs` exports; hex-conversion + classification are pure-function tests.
- Live-site validation is a documented manual step in `docs/dev/testing.md` (CI has no macOS Safari session).

## Out of scope (follow-ups)

- Network-body extraction (Wix `warmupData` via `list_network_requests`/`get_network_request`)
- Migrating the `design-import` skill to the Safari backend
- Any template or `.mcp.json` changes
