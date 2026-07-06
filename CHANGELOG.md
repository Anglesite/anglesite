# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added
- `get_component_model` MCP tool: structured read-only model of an `.astro`
  component (template tree, Props interface, style rules, client script) for
  the app's Component Editor (Slice 1).

## [1.0.0-beta.7] — 2026-05-07

Big beta. Nine new user-invocable skills round out the 1.0 commerce, community, and ops surface; analytics gets honest about what it's measuring; deploy learns about agent readability and performance budgets.

### Added
- `/anglesite:membership` skill — paywall and content gating via Polar or Memberful
- `/anglesite:podcast` skill — episode collection, Apple/Spotify-ready RSS feed, embeddable player, optional per-episode YouTube video embed
- `/anglesite:consent` skill — category-based GDPR/CCPA cookie consent banner with granular per-category opt-in
- `/anglesite:giscus` skill — blog comments backed by GitHub Discussions
- `/anglesite:inbox` skill — Keystatic-based inbox for form submissions from `/anglesite:contact` and `/anglesite:forms` (#193)
- `/anglesite:donations` skill — Stripe, Liberapay, and GitHub Sponsors donation flows with optional fundraising goal widget and 501(c)(3) tax-receipt template
- `/anglesite:redirects` skill — URL redirect manager with CSV bulk import, Cloudflare Pages `_redirects` generation (#192)
- `/anglesite:export` skill — portable site export for self-host or migration
- `/anglesite:forms` skill — custom RSVP, lead, survey, and callback forms wired through Cloudflare Workers into the Keystatic inbox
- Per-page performance budgets in `/anglesite:deploy` — warn-only by default, with a planned `PERF_WARN_ONLY=false` opt-in for hard gating in 1.2
- Restore flow added to `/anglesite:backup` — roll a site back to any GitHub backup snapshot
- Wix MCP server preferred for blog content imports, with the Playwright path as fallback
- Sudo-less HTTPS fallback — `/anglesite:start` skips local HTTPS setup when sudo isn't available (e.g., Claude Cowork) and records `HTTPS_AVAILABLE=false` in `.site-config` so the Keystatic editor URL adapts
- ADR-0017 — agent readability deploy gate driven by `AGENTIC_CRAWLERS` intent

### Changed
- `/anglesite:stats` distinguishes unique visitors, page views, and total requests
- `/anglesite:stats` splits Cloudflare Web Analytics RUM data from zone HTTP logs
- `/anglesite:stats` supports free Cloudflare zones (#216)
- `/anglesite:stats` surfaces country breakdown and caveats bot-inflated unique-visitor numbers
- `AGENTIC_CRAWLERS` in `.site-config` now drives `llms.txt` and `robots.txt` generation as a single source of truth (#210)
- Skill frontmatter field renamed from `user-invokable` to canonical `user-invocable`

### Fixed
- Pre-beta.7 review fixes — security, consent, and performance-budget hardening (#244)
- `/anglesite:stats` no longer extracts UTM data on the free Cloudflare plan (where it isn't reliable)
- `/anglesite:stats` ships `.env.example` and stops reading the dead `CF_PROJECT_NAME` env var
- Template no longer ships placeholder `favicon.svg` (#222)

## [1.0.0-beta.6] — 2026-05-04

### Added
- a14y agent readability audit and opt-in deploy gate, driven by `AGENTIC_CRAWLERS` in `.site-config`
- Owner name collected on-demand (only when a specific output needs it) instead of being asked upfront during `/anglesite:start`

## [1.0.0-beta.5] — 2026-05-04

The bulk of the 1.0 feature work. WCAG 2.1 AA audit, link checker, WordPress import, design-import for Canva, the email skill, freedesignmd integration, and a wave of import/convert and search/blog fixes.

### Added
- WCAG 2.1 AA audit in `/anglesite:check` with opt-in deploy gate (`A11Y_GATE=true`) and warn-only escape hatch (`A11Y_WARN_ONLY=true`) (#197)
- Automated link checker in `/anglesite:check` — internal links by default, `--external` for off-site URL verification (#195)
- WordPress import — WXR parser plus content cleaner that handles shortcodes and Gutenberg blocks
- `/anglesite:design-import` skill — extracts colors, typography, spacing, and layout heuristics from a published Canva site and applies them to the project (Figma support stubbed for a future release)
- Model-only email skill — Apple-first provider flow (iCloud Mail+, Hide My Email) with reference setup for Fastmail, ProtonMail, Google Workspace, and Microsoft 365
- freedesignmd integration as the design system source of truth, replacing the tldraw experiment
- Per-skill style guide and CSS/markdown linting (`stylelint`, `markdownlint-cli2`)
- `PII_PHONE_ALLOW` allowlist in `.site-config` for sites that intentionally publish a phone number (#174)
- Workflow for filing bugs against the Anglesite plugin repo
- Serena project configuration for plugin development

### Changed
- Email setup delegated from the domain skill into a dedicated email skill
- Install instructions updated for the separate marketplace repo

### Fixed
- `/anglesite:import` and `/anglesite:convert` protect existing pages from being overwritten during re-import (#173)
- Content collections only scaffolded when needed for the site type (#171)
- Glob-loader warnings for empty content collections suppressed
- Wix import — header logos and footer content extracted in fullPage mode (#166)
- Wix import — Playwright resolved from the project cwd, not the plugin cache (#167)
- `/anglesite:import` warns against flat-sitemap image extraction (#172)
- `/anglesite:search` — Pagefind CSS variables scoped to `#search` instead of `:root` (#169)
- Blog post URLs strip the `.mdoc` extension (#168)
- `astro-pagefind/components` import replaced with a runtime dynamic import to fix breakage
- Import scripts renamed from `.js` to `.mjs` for ESM compatibility
- `/anglesite:convert` and `/anglesite:import` detect both Astro 5 content config paths (#35)
- Removed Gemini CLI support to focus on Claude

## [1.0.0-beta.4] — 2026-04-02

### Fixed
- Plugin uses inline settings marketplace to fix skill loading

### Added
- Style guide for HTML, CSS, and TypeScript

## [1.0.0-beta.3] — 2026-04-01

### Fixed
- Stop infinite recursion in marketplace plugin source

## [1.0.0-beta.2] — 2026-04-01

### Fixed
- Remove dev artifacts that caused `ENAMETOOLONG` on update
- Support prerelease versions in `bin/release.ts` semver validation

### Changed
- `bin/release.ts` uses the `semver` package for version bumping
- 0.16.x and beta.1 release notes backfilled into this changelog

## [1.0.0-beta.1] — 2026-03-31

First beta for the 1.0 release. All 0.16.x blockers resolved — entering QA.
Bug fixes will be filed against the 1.0 milestone; feature requests against 1.1.

### Added
- 40 skills (17 user-facing, 23 model-only) covering site lifecycle from scaffolding to analytics
- MCP annotation server for visual element selection
- Pre-deploy security hooks (PII, token, third-party script, and admin route scanning)
- Prerelease version support in `bin/release.ts`

### Fixed
- Plugin-root docs referenced by 18+ skills (#145)
- MCP server test timeouts (#146)
- html-validate dependency scope (#147)
- Experiment skill frontmatter (#148)
- Missing worker/ directory (#149)
- ADR-0015 acceptance (#150)
- CLAUDE.md version sync (#151)
- CHANGELOG backfill for 0.16.x releases (#155)

## [0.16.4] — 2026-03-25

### Added
- `/anglesite:contact` skill — contact form via Cloudflare Workers + Turnstile (#49)
- `/anglesite:update` skill — one-command site dependency and template updates (#48)
- Content collections for services, team, testimonials, gallery, events, and FAQ (#47)

### Fixed
- Marketplace source path and schema compatibility with Claude Desktop app
- Marketplace `keywords`/`tags` removed, `homepage` added

## [0.16.3] — 2026-03-24

### Fixed
- Plugin metadata aligned with Claude Code plugin/marketplace conventions
- Cleaned up `.gitignore` — removed legacy template paths, fixed patterns

## [0.16.2] — 2026-03-24

### Fixed
- `marketplace.json` moved to repo root and matched official schema (#45)
- Release script updated for new marketplace.json path

### Changed
- `CLAUDE.md` rewritten with comprehensive current-state documentation (#46)

## [0.16.1] — 2026-03-23

### Fixed
- Let CI own GitHub release creation instead of release script

## [0.16.0] — 2026-03-23

### Added
- `bin/release.ts` — version bumper for all manifests with automatic git tags
- GitHub backup, branching, and Git integration in deploy skill
- Squarespace import fixes analogous to Wix extraction improvements

### Fixed
- `.gitignore` scaffolding appends Astro build artifacts instead of overwriting (#34)
- Playwright moved to `optionalDependencies` to unblock marketplace install
- `[slug].astro` missing `prerender = true`, breaking dev mode (#39)
- Content config path references corrected across codebase (#35)
- Stale Wrangler references cleaned up in deploy skill
- `marketplace.json` aligned with official schema to fix plugin install (#40)
- Plugin manifest version synced with marketplace version

### Changed
- Plugin instructions optimized — reduced always-loaded tokens by 17%

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
