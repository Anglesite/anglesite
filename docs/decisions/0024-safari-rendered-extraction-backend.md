---
status: accepted
date: 2026-07-03
decision-makers: [Anglesite maintainers]
---

# Safari's MCP server as an optional rendered-extraction backend

## Context and Problem Statement

Wix and Squarespace are the lowest-fidelity `import` sources: both render content client-side, so curl+regex extraction misses tokens, images, and text that only appear after JavaScript runs. The existing rendered-extraction path uses Playwright (`scripts/import/wix/wix-playwright.mjs`), but Playwright costs a ~150 MB per-project Chromium download on first use — a real tax for a plugin whose scripts should stay light. Wix also throttles curl/headless scraping, making even the fallback path unreliable. Squarespace had no rendered tier at all, only the curl+regex fallback.

Apple shipped an MCP server directly in Safari: `safaridriver --mcp` (Safari Technology Preview 247, July 2026). It speaks newline-delimited JSON-RPC over stdio, MCP protocol `2024-11-05`, exposes 17 tools, and each session is an isolated WebDriver session — no access to the user's cookies or logins. It ships with macOS/STP, so there is no extra download when it's available.

## Decision

Treat Safari's MCP server as an **optional, on-device rendered-extraction backend**, spawned directly as a child process — no MCP client configuration is needed since the plugin talks to the binary's stdio directly.

1. **Preference order.** `import` Step 1a.2 selects a `RENDER_BACKEND` in this order: Safari (preferred, when usable) → Playwright (fallback) → none (curl+regex only).
2. **Shared extraction logic.** Browser-context functions (style-token extraction, content extraction, accordion expansion) live once in `scripts/import/browser/page-functions.mjs`. Both the Safari driver (`scripts/import/browser/safari-driver.mjs`, `safari-mcp.mjs`) and the Playwright driver inject the same source into the page and emit the same `{tokens, content}` JSON shape, so downstream import code doesn't care which backend produced it.
3. **Detection, not assumption.** `safari-driver.mjs --check` probes availability and reports one of four exit codes: `0` ok, `2` not installed, `3` automation not enabled, `4` session failure (a fifth, `1`, is used at runtime for "all pages failed"). Binary discovery order is `SAFARIDRIVER_PATH` env var → `/usr/bin/safaridriver` → the Safari Technology Preview bundle, probed via `--help` output containing `--mcp`.
4. **Enabling automation is a deliberate, human-only step.** Turning on "Allow remote automation" requires the owner's admin password and touches sandboxed system preferences, so it cannot be scripted; the owner is prompted once and the choice is respected thereafter.
5. **Squarespace gets a rendered tier.** This backend gives Squarespace import the client-side-rendered extraction it previously lacked, alongside the existing curl+regex fallback.

## Decision Drivers

* Avoid the ~150 MB Playwright/Chromium download when a rendered backend is already on the machine
* Work around Wix's throttling of curl/headless scraping
* Give Squarespace a rendered-extraction tier it didn't have before
* Keep the import scripts cross-platform: Safari is macOS-only, so it must be additive, never required (matches the "cross-platform" editing rule in the root `CLAUDE.md`)
* Reuse the ADR-0021 pattern: free, private, on-device, optional, always with a working fallback

## Consequences

* **Good:** faster, lighter imports on macOS when Safari's automation is enabled — no per-project browser download, and no throttling issues on Wix.
* **Good:** Squarespace import gains rendered-tier fidelity it lacked entirely before this change.
* **Good:** shared `page-functions.mjs` means the two rendered backends can't silently drift in what they extract.
* **Neutral:** this is a macOS-only accelerator. Playwright and the curl+regex path remain fully supported on every platform, so nothing regresses for Linux/Windows users or CI.
* **Neutral:** CI validates the Safari driver against a fake `safaridriver` (`test/fixtures/fake-safaridriver.mjs`); it cannot exercise real Safari. Live-Safari validation is a manual, pre-release step (see `docs/dev/testing.md`).
* **Bad / limits:** Apple's MCP tool set and protocol version (`2024-11-05`, 17 tools) are tied to Safari Technology Preview releases and may change without notice; the driver's tool usage needs to be re-checked against new STP builds.
* **Precedent:** follows ADR-0021 (`fm`) — free, private, offline, and never required for the feature to work.
