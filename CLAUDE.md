# Anglesite — Development Context

Anglesite is a Claude plugin that scaffolds and manages websites for small businesses. It works with Claude Cowork (non-technical site owners, GUI) and Claude Code (developers, CLI). It generates Astro + Keystatic sites deployed to Cloudflare Workers (Static Assets, via the `@astrojs/cloudflare` adapter).

**Version:** 1.2.0 · **License:** ISC · **Node:** >=22 · **Module system:** ESM

## Plugin structure

```
├── .claude-plugin/
│   ├── plugin.json               Plugin manifest (name, version, metadata)
│   └── marketplace.json          Marketplace catalog — this repo is also its own marketplace
├── skills/                       Skills (56 total: 31 user-facing, 25 model-only)
│   ├── start/SKILL.md            First-time setup + scaffolding
│   ├── deploy/SKILL.md           Build, scan, deploy to Cloudflare Workers
│   ├── check/SKILL.md            Health audit + troubleshooting
│   ├── update/SKILL.md           Update dependencies + template files
│   ├── domain/SKILL.md           DNS management (email, Bluesky, verification)
│   ├── import/SKILL.md           Import from website URL
│   ├── convert/SKILL.md          Convert existing SSG project to Anglesite
│   ├── export/SKILL.md           Portable export (dist + content + MIGRATING.md)
│   ├── contact/SKILL.md          Contact form (Workers + Turnstile)
│   ├── forms/SKILL.md            Custom forms — RSVP, lead, survey, callback (Workers + Turnstile)
│   ├── inbox/SKILL.md            Form submissions inbox in Keystatic (Cloudflare D1 + triage + CSV export)
│   ├── indieweb/SKILL.md         Self-owned IndieAuth + Webmention + Micropub endpoints (user-facing)
│   ├── backup/SKILL.md           Back up changes to GitHub
│   ├── stats/SKILL.md            Plain-language site analytics
│   ├── newsletter/SKILL.md       Email newsletter setup + subscribe form
│   ├── add-store/SKILL.md        Ecommerce intake (user-facing)
│   ├── design-interview/SKILL.md Visual identity (model-only)
│   ├── email/SKILL.md            Business email setup, Apple-first (model-only)
│   ├── animate/SKILL.md          CSS animations (model-only)
│   ├── new-page/SKILL.md         Page creation (model-only)
│   ├── syndicate/SKILL.md        Social media post generation (model-only)
│   ├── seasonal/SKILL.md         Seasonal content suggestions (model-only)
│   ├── optimize-images/SKILL.md  Image optimization pipeline (model-only)
│   ├── og-images/SKILL.md       Satori-based OG image generation (model-only)
│   ├── business-info/SKILL.md    Hours, location, LocalBusiness JSON-LD (model-only)
│   ├── themes/SKILL.md           Visual theme picker — freedesignmd + built-ins (model-only)
│   ├── freedesignmd/SKILL.md    Apply a design system from freedesignmd.com (model-only)
│   ├── qr/SKILL.md              QR codes + UTM tracking (model-only)
│   ├── reputation/SKILL.md     Review monitoring + competitive coaching (model-only)
│   ├── testimonials/SKILL.md    Review collection + display (model-only)
│   ├── i18n/SKILL.md            Multi-language support (model-only)
│   ├── print/SKILL.md           Print materials generation (model-only)
│   ├── buy-button/SKILL.md     Stripe Payment Link buy button (model-only)
│   ├── lemon-squeezy/SKILL.md  Lemon Squeezy checkout for digital goods (model-only)
│   ├── snipcart/SKILL.md       Snipcart ecommerce for physical goods (model-only)
│   ├── shopify-buy-button/SKILL.md  Shopify Buy Button for full catalogs (model-only)
│   ├── paddle/SKILL.md         Paddle checkout for SaaS/software licensing (model-only)
│   ├── social-media/SKILL.md    Social media strategy + content calendars (model-only)
│   ├── booking/SKILL.md        Appointment scheduling embed (user-facing)
│   ├── seo/SKILL.md            SEO audit, Schema.org, sitemap, LLM/GEO (user-facing)
│   ├── search/SKILL.md          On-site search via Pagefind (user-facing)
│   ├── copy-edit/SKILL.md       Website copy audit + brand voice coaching (model-only)
│   ├── experiment/SKILL.md      A/B testing + funnel optimization (model-only)
│   ├── creative-canvas/SKILL.md Interactive visual effects + creative coding (model-only)
│   ├── photography/SKILL.md    Shot list generator + phone photography tips
│   ├── menu/SKILL.md            Restaurant menu import, creation, and management (user-facing)
│   ├── podcast/SKILL.md         Podcast: episodes, RSS+iTunes, transcripts, audio player (user-facing)
│   ├── donations/SKILL.md       Donation button + page (Stripe/Liberapay/GitHub Sponsors) (user-facing)
│   ├── redirects/SKILL.md       Manage Cloudflare _redirects (user-facing)
│   ├── design-import/SKILL.md    Import design from Canva/Figma (user-facing)
│   ├── giscus/SKILL.md          Blog comments via Giscus + GitHub Discussions (user-facing)
│   ├── consent/SKILL.md         Category-based GDPR/CCPA cookie consent banner (user-facing)
│   ├── membership/SKILL.md       Paywall + content gating: free (newsletter) and paid (Stripe) tiers (user-facing)
│   ├── tracking/SKILL.md         Meta Pixel, Google Ads, GA4, LinkedIn, TikTok, Pinterest, X via @astrojs/partytown + Microsoft Clarity (main thread) (user-facing)
│   ├── pwa/SKILL.md              Progressive Web App: installable, offline support, service worker (user-facing)
│   └── share/SKILL.md            Native sharing via Web Share API + clipboard fallback (user-facing)
├── settings.json                 Plugin settings (empty — permissions via allowed-tools)
├── hooks/hooks.json              PreToolUse hook for deploy safety scans
├── scripts/
│   ├── scaffold.sh               Copies template/ to user's project (zsh, rsync)
│   ├── update.sh                 Compares template files against scaffolded site
│   ├── pre-deploy-check.sh       Blocks deploy if security scans fail
│   ├── pack-plugin.sh            Builds distributable plugin ZIP
│   ├── design-import/            Canva/Figma extraction scripts
│   │   ├── canva-playwright.mjs  Browser-based Canva content extraction (Playwright fallback)
│   │   ├── canva-safari.mjs      Safari MCP Canva extraction (preferred on macOS; same JSON contract)
│   │   ├── canva-colors.mjs      Canva color token extraction
│   │   ├── canva-fonts.mjs       Canva font extraction
│   │   ├── comparison.mjs        Design comparison utilities
│   │   ├── infer-axes.mjs        Layout axis inference
│   │   ├── layout-heuristics.mjs Layout detection heuristics
│   │   └── text-hierarchy.mjs    Text hierarchy analysis
│   └── import/                   Platform-specific extraction scripts
│       ├── menu-extract.mjs      Menu extraction from PDF/photo
│       ├── wix/
│       │   ├── wix-playwright.mjs Browser-based content + CSS token extraction
│       │   ├── wix-extract.mjs    Curl+regex fallback for Wix HTML parsing
│       │   └── color-utils.mjs    RGB/hex conversion, luminance, color classification
│       └── wordpress/
│           ├── wp-xml-parse.mjs   WordPress WXR export parser
│           └── wp-content-clean.mjs WordPress content cleanup
├── server/                       MCP server + shared modules (Node.js, ESM) — the wire contract the Anglesite-app host builds against
│   ├── index-tools.mjs           buildServer(projectRoot): registers all 8 MCP tools (transport-agnostic)
│   ├── index.mjs                 stdio entry point (wires buildServer to StdioServerTransport)
│   ├── http-server.mjs           Streamable HTTP transport (/mcp, Mcp-Session-Id) for container runtimes
│   ├── annotations.mjs           Annotation store (CRUD + persistence)
│   ├── selector.mjs              CSS selector generation from ElementInfo metadata
│   ├── messages.mjs              WebSocket message schema (overlay ↔ server)
│   ├── apply-edit-schema.mjs     Zod schema + response builders for apply_edit (ElementInfo, op enum, edit-applied/failed/preview)
│   ├── apply-edit-dispatcher.mjs apply_edit handler: image pre-process → resolve → atomic write → onApplied hook
│   ├── patcher.mjs               Source-file resolver (mdoc → Keystatic → .astro)
│   ├── style-edit.mjs            edit-style op resolver (inline/scoped style patches)
│   ├── undo-edit.mjs             undo_edit handler
│   ├── edit-history.mjs          Commits applied edits to the hidden anglesite/edits branch
│   ├── list-content.mjs          list_content tool (enumerate pages/posts)
│   ├── create-content.mjs        create_page / create_post tools
│   ├── content-frontmatter.mjs   Shared frontmatter helpers for content tools
│   ├── content-types.mjs         Built-in typed-content catalog mirrored from the app's ContentTypeRegistry.swift (source of truth is Swift)
│   └── optimize-images.mjs       Image optimize/srcset used by the image-drop edit path
├── bin/
│   ├── build-instructions.ts     Agent instruction file validator
│   ├── build-agent-skills.ts     Generates agent-skills/ (Open Agent Skills export)
│   ├── generate-skill-registry.ts Generates docs/dev/skill-registry.md from frontmatter
│   └── release.ts                Semantic version bumper (updates all manifests)
├── agent-skills/                 GENERATED — Open Agent Skills export (skills.sh); never edit by hand
├── package.json                  Dev dependencies and test scripts
├── vitest.config.ts              Test configuration
├── docs/                         Reference docs (read by skills via ${CLAUDE_PLUGIN_ROOT})
│   ├── smb/                      Business type guides (67 files, ~59 verticals)
│   ├── import/                   Platform migration guides (29 files)
│   ├── platforms/                Tool integration guides (23 files)
│   ├── dev/                      Plugin development guides (7 files: architecture, releasing, testing, etc.)
│   ├── decisions/                ADRs — architecture decision records (24 files)
│   ├── style-guide.md           HTML, CSS, and TypeScript coding standards for generated sites
│   └── content-conversion.md    Shared HTML-to-Markdown guidance (used by import + convert)
├── template/                     Files scaffolded to user's project
│   ├── src/                      Astro source (pages, layouts, styles, integrations, toolbar)
│   │   ├── layouts/ImmersiveLayout.astro  Full-viewport layout for creative experiments
│   │   ├── pages/lab/index.astro          Experiment gallery page
│   │   └── styles/immersive.css           Dark/immersive styles for creative work
│   ├── public/                   Static assets
│   ├── scripts/                  setup.ts, check-prereqs.ts, cleanup.ts, platform.ts
│   ├── docs/                     Site-specific docs (~17 files) + workflows/
│   ├── CLAUDE.md                 Webmaster guide + Claude Code commands
│   ├── package.json              Site dependencies (Astro, Keystatic)
│   ├── astro.config.ts           Astro + Keystatic integration config
│   ├── keystatic.config.ts       CMS schema and collection definitions
│   ├── worker/                   Cloudflare Worker source (contact form)
│   ├── .mcp.json                 MCP server config (annotation tools)
│   └── .gitignore                Build artifacts exclusions
├── test/                         JavaScript tests + fixtures
│   └── fixtures/                 Sample HTML for Wix extraction tests
└── tests/                        TypeScript tests
```

## Agent instruction hierarchy

Two levels of agent instructions exist — do not confuse them:

| File | Audience | Purpose |
|---|---|---|
| **This file** (root `CLAUDE.md`) | Plugin developers | Building and maintaining the plugin itself |
| `template/CLAUDE.md` | Claude Code / Cowork users | Webmaster guide + Claude Code commands |

## How it works

1. User installs the plugin from the `Anglesite/anglesite` marketplace (or `claude --plugin-dir .` for development). The marketplace catalog (`.claude-plugin/marketplace.json`) lives in this same repo alongside the plugin manifest.
2. `/anglesite:start` runs `scripts/scaffold.sh` to copy `template/` to the user's project
3. Start skill proceeds with discovery interview, design, and tool installation
4. All other skills (`/anglesite:deploy`, `/anglesite:check`, etc.) execute in the user's working directory

## MCP server & the Anglesite-app host

`server/` is also a public integration surface: the native macOS host `Anglesite/Anglesite-app` embeds this plugin and drives its click-to-edit UI through this MCP server. Treat the schema and transport below as a contract — change them plugin-side first, then coordinate with the app (see ADR-0023 and `docs/dev/mac-app-design.md`).

**Tools** (registered by `buildServer(projectRoot)` in `server/index-tools.mjs`):

| Tool | Purpose |
|---|---|
| `add_annotation` / `list_annotations` / `resolve_annotation` | Pin, list, and resolve feedback notes anchored to page elements |
| `apply_edit` | Patch source from an `ElementInfo` selector. Closed op enum: `replace-text`, `replace-attr`, `replace-image-src`, `edit-style`, `apply-instruction`. Supports `dry_run` (returns `edit-preview`); responses are `edit-applied` / `edit-failed` (`server/apply-edit-schema.mjs`, `apply-edit-dispatcher.mjs`) |
| `undo_edit` | Revert the last applied edit via the `anglesite/edits` history branch |
| `list_content` | Enumerate pages/posts |
| `create_page` / `create_post` | Scaffold new content with frontmatter |

**Transport.** The server is transport-agnostic. `server/index.mjs` connects it over **stdio** by default. Set `ANGLESITE_MCP_TRANSPORT=http` to use the **Streamable HTTP** transport (`server/http-server.mjs`, endpoint `/mcp`, session via `Mcp-Session-Id`) with `ANGLESITE_MCP_HOST` / `ANGLESITE_MCP_PORT` — used by the app's container runtimes. The server prints an `Anglesite MCP listening on …` readiness line the host waits for.

**Runtime.** The app vendors a pinned Node (`Anglesite-app/scripts/node-version.txt`) to execute `server/*.mjs`; the CI test matrix should track it so the shipped interpreter is exercised here.

## Skills reference

**User-facing** (invoked via `/anglesite:<name>`, have `disable-model-invocation: true`):

| Skill | Purpose |
|---|---|
| `start` | First-time setup: scaffolding, discovery interview, design, tool installation, preview |
| `deploy` | Build, 4-point security scan, deploy to Cloudflare Workers |
| `check` | Health audit, troubleshooting, diagnostics |
| `update` | Update dependencies and template files to the latest version |
| `domain` | DNS record management (email, Bluesky, domain verification) |
| `import` | Import content from external website URL |
| `convert` | Convert existing SSG project (Hugo, Jekyll, Next.js, etc.) to Anglesite |
| `export` | Portable export of the site (`dist/`, `content/`, `public/`, `MIGRATING.md`) for self-host or migration |
| `contact` | Contact form via Cloudflare Workers + Turnstile |
| `forms` | Custom forms (RSVP, lead capture, survey, callback) via Cloudflare Workers + Turnstile |
| `inbox` | Persisted form submissions inbox in Keystatic (Cloudflare D1, triage, CSV export) |
| `indieweb` | Self-owned IndieAuth, Webmention, and Micropub endpoints on the owner's domain |
| `backup` | Back up site changes to GitHub, or restore an earlier snapshot |
| `stats` | Plain-language site analytics from Cloudflare |
| `newsletter` | Email newsletter setup (Buttondown/Mailchimp) + subscribe form |
| `add-store` | Ecommerce intake: routes to Stripe, Polar, or coming-soon paths |
| `booking` | Embed appointment scheduling (Cal.com or Calendly) |
| `seo` | SEO audit, metadata editing, Schema.org, sitemap, LLM/GEO optimization |
| `search` | On-site search via Pagefind (build-time index, ~6 KB JS) |
| `photography` | Site-type-specific shot list generator and phone photography tips |
| `menu` | Restaurant menu import (PDF/photo), creation, and editing |
| `podcast` | First-class podcast support — episodes, RSS+iTunes feed, transcripts, audio player, directory submission |
| `donations` | Donation button + page (Stripe / Liberapay / GitHub Sponsors), suggested + custom amounts, recurring defaults, optional goal widget, 501(c)(3) tax-receipt template |
| `redirects` | Manage Cloudflare `_redirects`: add, remove, list, validate, bulk-import (301/302/308) |
| `design-import` | Import design tokens and page layouts from Canva or Figma |
| `giscus` | Blog comments backed by GitHub Discussions (per-post opt-out via frontmatter) |
| `consent` | Category-based GDPR/CCPA cookie consent banner; gates third-party scripts/embeds via `data-consent` |
| `membership` | Paywall and content gating: free tier (newsletter) and paid tier (Stripe), edge-gated via signed cookie |
| `tracking` | Meta Pixel, Google Ads, GA4, LinkedIn Insight, TikTok, Pinterest, X — wrapped in `@astrojs/partytown` so they run in a worker, not on the main thread; plus Microsoft Clarity (heatmaps + session recording), which runs on the main thread because session replay needs DOM access |
| `pwa` | Progressive Web App: standalone display, service worker with offline caching, install prompt — no app store required |
| `share` | Native share button via Web Share API (mobile) with copy-to-clipboard fallback (desktop) — no third-party share widgets |

**Model-only** (called programmatically by other skills, `user-invocable: false`):

| Skill | Purpose |
|---|---|
| `design-interview` | Visual identity and branding questionnaire |
| `email` | Business email setup: Apple-first provider recommendation, DNS pre-fill |
| `animate` | CSS animations (hover, scroll reveals, transitions) |
| `creative-canvas` | Interactive visual effects and creative coding (p5.js, Three.js, GSAP, Tone.js, D3.js) |
| `new-page` | Create new page with SEO and accessibility |
| `syndicate` | Generate social media posts from blog post (POSSE) |
| `seasonal` | Surface seasonal content suggestions by business type |
| `optimize-images` | Resize, convert to WebP, strip EXIF, generate srcset |
| `og-images` | Satori-based OG image generation for social sharing previews |
| `business-info` | Hours, address, phone, LocalBusiness JSON-LD |
| `themes` | Pre-built visual theme picker (freedesignmd catalog + 9 built-in quick-picks) |
| `freedesignmd` | Browse, fetch, and apply a design system from freedesignmd.com |
| `qr` | QR codes, shortlinks, UTM campaign URLs |
| `reputation` | Review monitoring coaching and competitive awareness |
| `testimonials` | Customer review collection, moderation, display |
| `i18n` | Multi-language support with hreflang and language switcher |
| `print` | Print-ready materials (business cards, flyers, door hangers, social cards) |
| `buy-button` | Stripe Payment Link buy button for single product/service sales |
| `lemon-squeezy` | Lemon Squeezy checkout overlay for digital product sales (alternative to Polar) |
| `snipcart` | Snipcart ecommerce for small physical product catalogs |
| `shopify-buy-button` | Shopify Buy Button for full catalog physical goods |
| `paddle` | Paddle checkout for software licensing, SaaS subscriptions, or metered billing |
| `copy-edit` | Audit and coach website copy for clarity, tone, and brand voice |
| `social-media` | Proactive social media strategy, content calendars, and profile optimization |
| `experiment` | A/B testing: propose, run, analyze, and promote winning variants |

## Editing guidelines

- **Template files** go in `template/` — they're copied to the user's project during `/anglesite:start`
- **Skills** go in `skills/` — they reference user project files (relative) and plugin files (`${CLAUDE_PLUGIN_ROOT}`)
- **Tool permissions** are in each skill's `allowed-tools` frontmatter (not `settings.json`)
- **Cross-skill references** use `${CLAUDE_PLUGIN_ROOT}/skills/skill-name/SKILL.md`
- **The end user is non-technical.** Skills are their primary interface. Changes should not require CLI knowledge.
- **Cross-platform.** Template scripts detect macOS/Linux/Windows via `scripts/platform.ts`. Never use platform-specific commands (`sips`, `pfctl`, `dscacheutil`, `osascript`, `open`, `sed -i ""`) without a cross-platform alternative or guard.
- **Privacy and security are non-negotiable.** The deploy skill scans for PII, exposed tokens, third-party scripts, and Keystatic admin routes.
- **PII is collected on-demand, not upfront.** Names, emails, phone numbers, and addresses are PII. Skills should not prompt for them speculatively during setup or onboarding. Prompt only when a specific output requires the field — frame the question by the use case ("What name should appear on the copyright line?" not "What's your name?") and save the answer to `.site-config` so other skills don't re-ask. The canonical example is `OWNER_NAME`: `start` no longer collects it; consumer skills (`print`, `convert`'s footer, About-page work, h-card / IndieAuth) prompt for it themselves and write back. See "On-demand owner name" in `skills/start/SKILL.md` and follow the same pattern when adding new fields.
- **Reference docs** go in `docs/` at the plugin root — skills read them via `${CLAUDE_PLUGIN_ROOT}/docs/`.
- **Site-specific docs** go in `template/docs/` — these are scaffolded to the user's project and updated per-site.
- **Documentation must stay in sync.** Update docs when you change behavior.
- **MCP-first for Cloudflare provisioning.** When a skill provisions Cloudflare resources (KV namespaces, R2 buckets, D1 databases, Hyperdrive configs, Workers), prefer the Cloudflare MCP tools (`mcp__cloudflare__kv_namespace_create`, `mcp__cloudflare__kv_namespace_get`, `mcp__cloudflare__kv_namespaces_list`, etc.) over shelling out to `npx wrangler …`. The MCP path returns the resource id directly, so the skill can write the binding into the relevant `worker/*-wrangler.toml` itself — no copy-paste, no terminal-output parsing, and no human-readable prompt the owner has to interpret. Always document a `wrangler` CLI fallback for offline / no-MCP environments, and add the relevant `mcp__cloudflare__*` tools to the skill's `allowed-tools` frontmatter.

## Key decisions

| Decision | Why |
|---|---|
| Claude Code Plugin | Marketplace distribution, versioning, namespace isolation |
| Astro (not Next/Nuxt) | Zero client JS by default, best for static content sites |
| Keystatic (not headless CMS) | Local `.mdoc` files, no external API dependency |
| Cloudflare Workers + Static Assets (not Vercel/Netlify) | Free, fast, `wrangler deploy` from CLI; `@astrojs/cloudflare` adapter |
| GitHub (not GitLab) | `gh` CLI browser OAuth is simplest for non-technical users; private repos free |
| Vanilla CSS | No build-time framework overhead, custom properties for theming |
| Industry tools first | Recommend purpose-built solutions (Square, Shopify, Clio, etc.) over generic databases |
| Edge A/B testing (not client-side) | Build-time variants + Worker-entry edge assignment = zero flicker, static-site compatible |
| Pagefind (not Algolia/Orama) | Build-time index, ~6 KB JS, no external service, first-class Astro integration |
| On-device `fm` as optional authoring accelerator | Free/private/offline drafts — alt text (incl. imported images via `ai-alt`) and inbox triage; never in the deployed site, always falls back to Claude (ADR-0021) |

Full ADRs are in `docs/decisions/` (ADR-0001 through ADR-0023, plus README).

## Testing

**Framework:** Vitest 3.1.1

```sh
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

**Test layout:**
- `tests/` — TypeScript tests (token calc, instruction validation, config, image gen, platform detection, pre-deploy checks)
- `test/` — JavaScript tests (BaseLayout, convert skill, scaffold .gitignore, Wix extraction + color utils)
- `test/fixtures/` — Sample HTML for Wix extraction tests

**Config:** `vitest.config.ts` includes both directories, aliases `./config.js` and `./platform.js` to template sources for import resolution.

## Version management

Versions must stay in sync across three files:
- `package.json`
- `.claude-plugin/plugin.json`
- `template/package.json`

Use `bin/release.ts` to bump all at once. It creates a git tag (`v*`) which triggers the CI release workflow.

The MCP server version reported on `initialize` is **not** a fourth file to bump — `server/index-tools.mjs` reads it from `.claude-plugin/plugin.json` at startup, so it tracks the plugin version automatically.

## Distribution channels

Anglesite ships two ways from one source — they coexist:

1. **Claude Code plugin** — the `skills/` tree, installed from the `Anglesite/anglesite` marketplace.
2. **Open Agent Skills** — a spec-compliant ([agentskills.io](https://agentskills.io) / [skills.sh](https://www.skills.sh)) export under `agent-skills/`, installable with `npx skills add Anglesite/anglesite/agent-skills/<skill>`.

`skills/` is the source of truth. `agent-skills/` is **generated** by `npm run build:agent-skills` (`bin/build-agent-skills.ts`) and committed so the skills.sh CLI can resolve skills by path. The transformer rewrites `${CLAUDE_PLUGIN_ROOT}` references into bundled `references/`, drops plugin-only frontmatter (`disable-model-invocation`, `user-invocable`, `argument-hint`) into spec `metadata`, and converts cross-skill links into plain mentions. **Never edit `agent-skills/` by hand** — edit `skills/` and rebuild. CI (`.github/workflows/test.yml`) fails if the export is stale. See `docs/dev/agent-skills.md` for the full contract and known limitations.

## CI/CD

**`.github/workflows/test.yml`** — Runs on PRs and pushes to `main`. Three jobs:
1. **`test`** — Node matrix [22, 24]; runs the full test suite on both the `engines` floor and the runtime `Anglesite-app` ships
2. **`agent-skills-export`** — verifies `agent-skills/` is current (`npm run build:agent-skills`); fails if stale
3. **`template-lockfile`** — verifies `template/package-lock.json` is in sync (`npm ci` inside `template/`)

When the app bumps its pinned Node version (`Anglesite-app/scripts/node-version.txt`), update the matrix to match.

**`.github/workflows/release.yml`** — Triggered on `v*` tags:
1. Verifies version consistency across all manifests
2. Runs `scripts/pack-plugin.sh` to build plugin ZIP
3. Creates GitHub Release with ZIP artifact

## Testing changes manually

```sh
mkdir /tmp/test-site
zsh scripts/scaffold.sh /tmp/test-site
cd /tmp/test-site
npm install
npm run dev
```

## Serena (optional, plugin development)

[Serena](https://github.com/oraios/serena) provides semantic, symbol-level code navigation via language servers. It's useful when working on the plugin itself (tracing cross-skill references, finding symbol usages across 56 skills). Not required — all standard tools work without it.

**Setup:**

```sh
# Index the project (one-time)
uvx -p 3.13 --from git+https://github.com/oraios/serena serena project index

# Start the MCP server
uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --project .
```

Config lives in `.serena/project.yml`. Requires Python 3.13 and [uv](https://docs.astral.sh/uv/).

## Security hooks

The `hooks/hooks.json` defines a PreToolUse hook that runs `scripts/pre-deploy-check.sh` before any Bash tool use. It enforces four mandatory scans before deploying to `main`:
1. **PII scan** — emails, phone numbers (configurable allowlists via `PII_EMAIL_ALLOW` and `PII_PHONE_ALLOW` in `.site-config`)
2. **Token scan** — exposed API keys and secrets
3. **Third-party script scan** — blocks unauthorized external JS
4. **Keystatic admin route scan** — ensures CMS admin is not publicly exposed
