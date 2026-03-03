# Anglesite

A Claude Code plugin that acts as an AI webmaster for small business websites. Install the plugin, run `/anglesite:start`, and your webmaster handles the rest.

## Philosophy

Anglesite is an opinionated webmaster. These principles guide every recommendation:

- **The website is the center** — The owner's site is their primary online presence. Publish here first, syndicate elsewhere (POSSE). Social media and map listings are distribution channels, not home base.
- **IndieWeb first** — Microformats (h-card, h-entry), Webmention, IndieAuth. The owner controls their identity and content.
- **Accessible by design** — WCAG AA minimum. Semantic HTML, color contrast, keyboard navigation, alt text. Not an afterthought.
- **No external runtime dependencies** — Zero third-party JavaScript in production. Self-host fonts. Cloudflare Web Analytics is the only exception.
- **Platform-neutral** — Cover Google, Apple, and Microsoft ecosystems plus open source alternatives. Don't default to one vendor — help the owner reach customers on whichever platform their community uses.
- **Locale-aware** — Every community is different. Some towns live on Nextdoor, others on Facebook groups, others on Yelp. The webmaster helps the owner figure out where their customers actually are.
- **Leverage Astro and NPM** — Use existing modules rather than writing custom code. Check if Astro or an NPM package already solves the problem.
- **SaaS selection criteria** — When the owner needs a tool, evaluate in this order:
  1. **Tool reduction** — Can an existing tool handle this? Exhaust Cloudflare, iCloud, and tools already in `.site-config` before introducing anything new.
  2. **Open source** — Prefer open-source solutions.
  3. **Free or affordable** — Free tiers and low-cost plans over expensive subscriptions.
  4. **Values-aligned** — Federated services, nonprofits, co-ops, B-Corps, and Public Benefit Corporations over purely commercial alternatives.
  5. **Ease of use** — Unusable software is rarely used. A polished commercial tool that the owner will actually use beats an open-source tool they won't.

### Documentation principles

The `template/docs/smb/` directory contains industry-specific guidance for 56 business types. Each file follows a consistent structure (pages, tools, compliance, content ideas, key dates, structured data, data tracking). The webmaster reads only the file(s) matching the owner's business type — not all files. Keep reference material focused and avoid cross-file duplication.

## What's inside

Anglesite is a Claude Code plugin with:

- 10 user-invocable skills for setup, design, deployment, and maintenance
- Astro 5 + Keystatic CMS project template (scaffolded during `/anglesite:start`)
- Cloudflare Pages hosting with zero third-party JavaScript
- iCloud sync support (heavy directories excluded via `.nosync` symlinks)
- Business-type discovery that tailors the site to your industry (56 types)

## Who this is for

Small businesses — farms, restaurants, legal firms, retailers, makers, artists, content creators, service providers — who want a fast, private, professional website without learning to code. The site owner interacts through Claude Desktop — no terminal required after initial setup.

## Getting started

1. Install [Claude Desktop](https://claude.ai/download) (free, requires an Anthropic account)
2. Install the Anglesite plugin from the marketplace
3. Create a new directory for your site and open it in Claude Desktop
4. Type `/anglesite:start` and follow the prompts

The start command scaffolds your project, introduces your webmaster, learns about your business, designs the site with you, and installs the tools to preview it — all in one session. When you're ready to go live, `/anglesite:deploy` handles Cloudflare, domains, and publishing. The whole process takes about 45 minutes.

## Stack

| Component | Technology |
|---|---|
| Site generator | Astro 5 |
| Content editor | Keystatic |
| Hosting | Cloudflare Pages |
| Analytics | Cloudflare Web Analytics |
| Language | TypeScript (strict) |
| Styling | Vanilla CSS with custom properties |
| Customer management (optional) | Industry tools or Airtable |

## Available skills

| Skill | What it does |
|---|---|
| `/anglesite:start` | First-time setup: scaffolding, business discovery, design, tools, preview |
| `/anglesite:design-interview` | Redo the visual identity (can run anytime after start) |
| `/anglesite:deploy` | Build, security scan, deploy, domain setup |
| `/anglesite:check` | Health audit (build, privacy, security, accessibility) |
| `/anglesite:fix` | Diagnose and fix common problems |
| `/anglesite:update` | Update dependencies safely |
| `/anglesite:new-page` | Create a new page with SEO and accessibility |
| `/anglesite:setup` | Reinstall tools and dependencies |
| `/anglesite:setup-customers` | Set up customer/client management (recommends industry tools) |
| `/anglesite:domain` | Manage DNS records (email, Bluesky verification, etc.) |

## Plugin structure

```
├── .claude-plugin/         Plugin manifest
├── skills/                 User-invocable skills (10)
│   ├── start/SKILL.md      First-time setup + scaffolding
│   ├── deploy/SKILL.md     Build, scan, deploy
│   └── …
├── settings.json           Plugin permissions
├── scripts/scaffold.sh     Copies template/ to user's project
├── template/               Files scaffolded to user's project
│   ├── src/                Astro source (pages, layouts, styles, content)
│   ├── public/             Static assets, security headers
│   ├── scripts/            setup.sh, check-prereqs.sh, cleanup.sh
│   ├── docs/               Reference documentation (80+ files)
│   │   ├── smb/            Industry-specific guidance (56 business types)
│   │   └── platforms/      SaaS integration guides (Square, Yelp, …)
│   ├── CLAUDE.md           Webmaster instructions (Claude Code)
│   ├── AGENTS.md           Shared webmaster guide (all AI tools)
│   └── README.md           End-user guide
├── CLAUDE.md               Plugin development context
└── README.md               This file
```

## Customization

The template ships with placeholder content. After `/anglesite:start`, the site reflects the owner's brand. Blog posts are created through the Keystatic visual editor — no code editing needed.

To adapt this plugin for a different project, update:

- `template/CLAUDE.md` — webmaster context
- `template/AGENTS.md` — cross-tool instructions
- `template/keystatic.config.ts` — content schema
- `skills/` — plugin skills

<!-- token-efficiency-start -->
## Token Efficiency

Estimated cost per `/anglesite:start` session (~30 turns):

| Model | Cached input | New input | Output | Est. cost |
|---|---|---|---|---|
| Opus | 430k | 410k | 25k | $8.83 |
| Sonnet | 430k | 410k | 25k | $1.77 |

<details>
<summary>Context budget breakdown</summary>

### Always-loaded context (every turn)

| File | Tokens |
|---|---|
| System prompt (est.) | 2,000 |
| CLAUDE.md | 229 |
| AGENTS.md | 1,608 |
| **Subtotal** | **3,837** |

### Skill + on-demand reads

| File | Tokens | Loaded after |
|---|---|---|
| start/SKILL.md | 2,533 | Skill invocation |
| smb/README.md | 2,614 | Step 1 |
| Avg SMB type (1 of 56 files) | 1,619 | Step 1 |
| design-interview/SKILL.md | 1,321 | Step 2 |
| design-system.md | 2,905 | Step 2 |
| **Subtotal** | **10,992** | |

### Session model

| Parameter | Value |
|---|---|
| Turns | 30 |
| Context per turn (after step 2) | 14,829 |
| New content per turn | ~850 |
| Total input (all API calls) | 840k |
| Total output | 25k |

</details>

*Generated by `bin/average-tokens.ts` — do not edit manually.*
<!-- token-efficiency-end -->

## License

Private. Not open source.
