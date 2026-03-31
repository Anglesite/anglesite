# Anglesite — Development Context

Anglesite is a Claude plugin that scaffolds and manages websites for small businesses. It works with Claude Cowork (non-technical site owners, GUI) and Claude Code (developers, CLI). It generates Astro + Keystatic sites deployed to Cloudflare Pages.

**Version:** 0.16.4 · **License:** ISC · **Node:** >=22 · **Module system:** ESM

## Plugin structure

```
├── .claude-plugin/plugin.json    Plugin manifest (name, version, metadata)
├── marketplace.json              Marketplace distribution config
├── skills/                       Skills (40 total: 17 user-facing, 23 model-only)
│   ├── start/SKILL.md            First-time setup + scaffolding
│   ├── deploy/SKILL.md           Build, scan, deploy to Cloudflare Pages
│   ├── check/SKILL.md            Health audit + troubleshooting
│   ├── update/SKILL.md           Update dependencies + template files
│   ├── domain/SKILL.md           DNS management (email, Bluesky, verification)
│   ├── import/SKILL.md           Import from website URL
│   ├── convert/SKILL.md          Convert existing SSG project to Anglesite
│   ├── contact/SKILL.md          Contact form (Workers + Turnstile)
│   ├── backup/SKILL.md           Back up changes to GitHub
│   ├── stats/SKILL.md            Plain-language site analytics
│   ├── newsletter/SKILL.md       Email newsletter setup + subscribe form
│   ├── add-store/SKILL.md        Ecommerce intake (user-facing)
│   ├── design-interview/SKILL.md Visual identity (model-only)
│   ├── animate/SKILL.md          CSS animations (model-only)
│   ├── new-page/SKILL.md         Page creation (model-only)
│   ├── syndicate/SKILL.md        Social media post generation (model-only)
│   ├── seasonal/SKILL.md         Seasonal content suggestions (model-only)
│   ├── optimize-images/SKILL.md  Image optimization pipeline (model-only)
│   ├── og-images/SKILL.md       Satori-based OG image generation (model-only)
│   ├── business-info/SKILL.md    Hours, location, LocalBusiness JSON-LD (model-only)
│   ├── themes/SKILL.md           Visual theme picker with tldraw (model-only)
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
│   └── menu/SKILL.md            Restaurant menu import, creation, and management (user-facing)
├── settings.json                 Plugin settings (empty — permissions via allowed-tools)
├── hooks/hooks.json              PreToolUse hook for deploy safety scans
├── scripts/
│   ├── scaffold.sh               Copies template/ to user's project (zsh, rsync)
│   ├── update.sh                 Compares template files against scaffolded site
│   ├── pre-deploy-check.sh       Blocks deploy if security scans fail
│   ├── pack-plugin.sh            Builds distributable plugin ZIP
│   └── import/                   Wix-specific extraction scripts
│       └── wix/
│           ├── wix-playwright.js Browser-based content + CSS token extraction
│           ├── wix-extract.js    Curl+regex fallback for Wix HTML parsing
│           └── color-utils.js    RGB/hex conversion, luminance, color classification
├── server/                       MCP annotation server + shared modules (Node.js, ESM)
│   ├── annotations.mjs           Annotation store (CRUD + persistence)
│   ├── selector.mjs              CSS selector generation from element metadata
│   ├── messages.mjs              WebSocket message schema (overlay ↔ server)
│   └── index.mjs                 MCP stdio server entry point
├── bin/
│   ├── average-tokens.ts         Token cost calculator for start skill
│   ├── build-instructions.ts     Agent instruction file validator
│   └── release.ts                Semantic version bumper (updates all manifests)
├── package.json                  Dev dependencies and test scripts
├── vitest.config.ts              Test configuration
├── docs/                         Reference docs (read by skills via ${CLAUDE_PLUGIN_ROOT})
│   ├── smb/                      Business type guides (66 files, 50+ verticals)
│   ├── import/                   Platform migration guides (28 files)
│   ├── platforms/                Tool integration guides (19 files)
│   ├── decisions/                ADRs — architecture decision records (16 files)
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

1. User installs the plugin from the marketplace (or `claude --plugin-dir .` for development)
2. `/anglesite:start` runs `scripts/scaffold.sh` to copy `template/` to the user's project
3. Start skill proceeds with discovery interview, design, and tool installation
4. All other skills (`/anglesite:deploy`, `/anglesite:check`, etc.) execute in the user's working directory

## Skills reference

**User-facing** (invoked via `/anglesite:<name>`, have `disable-model-invocation: true`):

| Skill | Purpose |
|---|---|
| `start` | First-time setup: scaffolding, discovery interview, design, tool installation, preview |
| `deploy` | Build, 4-point security scan, deploy to Cloudflare Pages |
| `check` | Health audit, troubleshooting, diagnostics |
| `update` | Update dependencies and template files to the latest version |
| `domain` | DNS record management (email, Bluesky, domain verification) |
| `import` | Import content from external website URL |
| `convert` | Convert existing SSG project (Hugo, Jekyll, Next.js, etc.) to Anglesite |
| `contact` | Contact form via Cloudflare Workers + Turnstile |
| `backup` | Back up site changes to GitHub with descriptive summary |
| `stats` | Plain-language site analytics from Cloudflare |
| `newsletter` | Email newsletter setup (Buttondown/Mailchimp) + subscribe form |
| `add-store` | Ecommerce intake: routes to Stripe, Polar, or coming-soon paths |
| `booking` | Embed appointment scheduling (Cal.com or Calendly) |
| `seo` | SEO audit, metadata editing, Schema.org, sitemap, LLM/GEO optimization |
| `search` | On-site search via Pagefind (build-time index, ~6 KB JS) |
| `photography` | Site-type-specific shot list generator and phone photography tips |
| `menu` | Restaurant menu import (PDF/photo), creation, and editing |

**Model-only** (called programmatically by other skills, `user-invokable: false`):

| Skill | Purpose |
|---|---|
| `design-interview` | Visual identity and branding questionnaire |
| `animate` | CSS animations (hover, scroll reveals, transitions) |
| `creative-canvas` | Interactive visual effects and creative coding (p5.js, Three.js, GSAP, Tone.js, D3.js) |
| `new-page` | Create new page with SEO and accessibility |
| `syndicate` | Generate social media posts from blog post (POSSE) |
| `seasonal` | Surface seasonal content suggestions by business type |
| `optimize-images` | Resize, convert to WebP, strip EXIF, generate srcset |
| `og-images` | Satori-based OG image generation for social sharing previews |
| `business-info` | Hours, address, phone, LocalBusiness JSON-LD |
| `themes` | Pre-built visual theme picker with tldraw swatches |
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
- **Reference docs** go in `docs/` at the plugin root — skills read them via `${CLAUDE_PLUGIN_ROOT}/docs/`.
- **Site-specific docs** go in `template/docs/` — these are scaffolded to the user's project and updated per-site.
- **Documentation must stay in sync.** Update docs when you change behavior.

## Key decisions

| Decision | Why |
|---|---|
| Claude Code Plugin | Marketplace distribution, versioning, namespace isolation |
| Astro (not Next/Nuxt) | Zero client JS by default, best for static content sites |
| Keystatic (not headless CMS) | Local `.mdoc` files, no external API dependency |
| Cloudflare Pages (not Vercel/Netlify) | Free, fast, Git integration auto-deploys from `main` |
| GitHub (not GitLab) | `gh` CLI browser OAuth is simplest for non-technical users; private repos free |
| Vanilla CSS | No build-time framework overhead, custom properties for theming |
| Industry tools first | Recommend purpose-built solutions (Square, Shopify, Clio, etc.) over generic databases |
| Edge A/B testing (not client-side) | Build-time variants + Pages Function assignment = zero flicker, static-site compatible |
| Pagefind (not Algolia/Orama) | Build-time index, ~6 KB JS, no external service, first-class Astro integration |

Full ADRs are in `docs/decisions/` (ADR-0001 through ADR-0015).

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

## CI/CD

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

## Security hooks

The `hooks/hooks.json` defines a PreToolUse hook that runs `scripts/pre-deploy-check.sh` before any Bash tool use. It enforces four mandatory scans before deploying to `main`:
1. **PII scan** — emails, phone numbers (configurable allowlist via `PII_EMAIL_ALLOW` in `.site-config`)
2. **Token scan** — exposed API keys and secrets
3. **Third-party script scan** — blocks unauthorized external JS
4. **Keystatic admin route scan** — ensures CMS admin is not publicly exposed
