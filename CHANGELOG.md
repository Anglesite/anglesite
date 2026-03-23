# Changelog

All notable changes to this project will be documented in this file.

## [0.15.0] — 2026-03-23

### Added
- Wix tag extraction from post footers: category links, data-hook tags, and plain text fallback (#27)
- Accordion/FAQ expansion before Playwright content extraction (#28)
- Opaque Wix slug renaming (e.g., `general-5` → `endorsements`) with automatic redirects (#29)
- Homepage update step in convert skill for blog site types (#30)
- Inline body images inserted as Markdown `![alt](src)` in extracted content
- 214 tests across 12 test files

### Fixed
- Playwright timeout on Wix: use `domcontentloaded` instead of `networkidle` (#21)
- Hyperlinks in Wix post bodies preserved as Markdown links (#22)
- Hyperlinks in Wix static pages extracted correctly (#23)
- Split-word text across adjacent Wix elements rejoined (#25)
- Superscript ordinals (27th, 1st) merged instead of split (#26)
- Background color extraction picks lightest color, not brand-colored headers
- BaseLayout header reads SITE_NAME from .site-config instead of hardcoding "My Website" (#31)

### Changed
- Tests migrated from node:test to Vitest
- vitest.config.ts includes both `tests/` and `test/` directories

## [0.14.1] — 2026-03-23

### Fixed
- Release workflow now uploads zip to existing releases instead of failing
- Plugin zip now includes `scripts/import/` extraction scripts

## [0.14.0] — 2026-03-23

### Added
- Playwright-based Wix extraction: content + computed CSS design tokens (colors, fonts) in one browser session
- Color utilities (`color-utils.js`): rgbToHex, luminance, saturation, isGray, topColors, classifyTokens
- Bundled curl+regex Wix extraction scripts as per-page fallback
- New Step 5.5 in import skill: auto-apply extracted design tokens to `global.css`
- Playwright added as a required dependency
- 49 tests for Wix extraction and color classification

### Changed
- Wix import no longer uses WebFetch (which returned empty content for all Wix pages)
- Extraction method hierarchy updated: Playwright → curl+regex → WebFetch (last resort)

## [0.13.2] — 2026-03-23

### Fixed
- Sync plugin manifest version so marketplace picks up the latest release

## [0.13.0] — 2026-03-20

### Added
- New `/anglesite:convert` skill for converting local SSG projects (Hugo, Jekyll, Eleventy, etc.) to Anglesite/Astro
- Portable `docs/workflows/convert.md` for non-Claude-Code agents

### Changed
- `/anglesite:import` now accepts website URLs only (WordPress, Squarespace, Wix, etc.) — local SSG paths moved to `/convert`
- Import skill directs users to `/convert` when an SSG project is detected in the working directory
- Plugin structure updated to 9 skills (6 user-facing)

## [0.12.2] — 2026-03-20

### Fixed
- Add `eleventy.config.ts` to all SSG detection tables — Eleventy v3 TypeScript projects were not recognized (#11)

## [0.12.1] — 2026-03-20

### Fixed
- Remove redundant `hooks` field from `plugin.json` that caused "duplicate hooks file" error on plugin load (#10)
- Create GitHub Releases for all tagged versions so the plugin installer can discover them (#10)

## [0.12.0] — 2026-03-20

### Added
- `/import` now works standalone without requiring `/start` first
- Detects existing SSG projects (Hugo, Jekyll, Gatsby, etc.) and offers in-place conversion to Anglesite
- Empty directories prompt for a URL, scaffold automatically, then import
- Non-Anglesite Astro projects detected as a conversion candidate

### Changed
- Import skill Step 0 rewritten as directory assessment with four sub-steps (0a–0d)
- Import workflow doc updated with "Getting started" section explaining standalone behavior
- Import skill `allowed-tools` expanded to include `npm install` and `zsh` for scaffolding

## [0.11.1] — 2026-03-20

### Fixed
- Pre-deploy PII scan no longer blocks deploys for intentional `mailto:` links (#9)
- Email scan uses real email regex instead of bare `@` — eliminates false positives from Mastodon URLs, CSS at-rules, and social media handles
- Added `PII_EMAIL_ALLOW` allowlist in `.site-config` for emails the owner intentionally publishes

### Changed
- Deploy skill uses `npm run predeploy` instead of manual grep commands — all agents get the same enforcement (#8)
- AGENTS.md and deploy workflow docs reference `npm run deploy` pipeline
- README install instructions corrected to use `claude plugin marketplace add` + `claude plugin install`

## [0.9.14] — 2026-03-04

### Added
- Import support for 5 new platforms: Webflow, GoDaddy Website Builder, Carrd, Micro.blog, WriteFreely/Write.as
- Calendly platform integration doc (alternative to Cal.com for scheduling)
- Shared import guidance docs: `hosted-platforms.md` (HTML-to-Markdown, image CDN handling, pagination, redirects) and `ssg-migrations.md` (template syntax, frontmatter, content discovery)
- 9 universal import principles in the import skill (content accuracy, local images, provenance, no embeds)
- First-pass expectation setting: import results now tell owners design tweaks come after content migration

### Changed
- All 25 platform import docs now cross-reference the appropriate shared guidance doc
- Trimmed duplicated content conversion rules from WordPress, Squarespace, Ghost, Blogger, Medium, Weebly, and Webflow docs
- Import skill description updated to list all 15 hosted platforms

## [0.9.13] — 2026-03-04

### Added
- Wix import skill (`/anglesite:import`) — imports blog posts, images, and static pages from Wix sites with redirect mappings for SEO preservation
- 12 Architectural Decision Records documenting default technical choices (Astro, Keystatic, Cloudflare, vanilla CSS, system fonts, IndieWeb, pre-deploy scans, no third-party JS, industry tools, local HTTPS, owner ownership, verify-before-presenting)
- "Verify your own work" section in the webmaster guide (build at session start, after changes, before deploy)

### Changed
- All skills now link to relevant ADRs in an "Architecture decisions" section
- ADRs framed as owner-changeable defaults, not fixed rules
- Terminology updated from "small business owner" to inclusive language (individuals, artists, nonprofits, government offices)

## [0.9.0] — 2026-03-03

First pre-release as a Claude Code plugin.

### Added
- 9 user-invocable skills: start, deploy, design-interview, check, fix, update, new-page, setup, domain
- Astro 5 + Keystatic CMS project template with 56 business types
- Local HTTPS with custom hostname via mkcert and pfctl
- Cloudflare Pages deployment with security scan
- DNS management via Cloudflare API (email, Bluesky, Google verification)
- Unified webmaster guide in CLAUDE.md
- Design system with per-industry guidance
- IndieWeb support (h-card, h-entry, h-feed, Webmention)
- Token efficiency calculator
- ISC + CC BY 4.0 licensing

### Changed
- Converted from standalone website project to Claude Code plugin format
- All DNS operations use Cloudflare API directly (no dashboard for DNS)
- Health check results presented in plain English (no jargon)
- Git commands run silently by the agent (no user-facing git)
- Plugin permissions use strict JSON (no JSONC comments)

### Removed
- setup-customers skill (not a core feature)
- iCloud .nosync symlink support
- AGENTS.md and GEMINI.md (consolidated into CLAUDE.md)
