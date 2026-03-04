# Changelog

All notable changes to this project will be documented in this file.

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
