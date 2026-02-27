# Anglesite

A website scaffold for non-technical users. Download the zip, expand it, open the folder in Claude Desktop's Code tab, and your AI webmaster handles the rest.

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

The `docs/smb/` directory contains industry-specific guidance for 42+ business types. Each file follows a consistent structure (pages, tools, compliance, content ideas, key dates, structured data, data tracking). The webmaster reads only the file(s) matching the owner's business type — not all files. Keep reference material focused and avoid cross-file duplication.

## What's inside

The `website/` directory is a complete Astro + Keystatic static site with:

- Blog engine with a visual editor (Keystatic CMS)
- Cloudflare Pages hosting with zero third-party JavaScript
- Built-in Claude Code commands for setup, design, deployment, and maintenance
- iCloud sync support (heavy directories excluded via `.nosync` symlinks)
- Business-type discovery that tailors the site to your industry

## Who this is for

Small businesses — farms, restaurants, legal firms, retailers, makers, artists, content creators, service providers — who want a fast, private, professional website without learning to code. The site owner interacts through Claude Desktop — no terminal required after initial setup.

## Getting started

1. Download and unzip
2. Open the `website/` folder in Claude Desktop's Code tab
3. Type `/start` and follow the prompts

The start command introduces your webmaster, learns about your business, designs the site with you, and installs the tools to preview it — all in one session. When you're ready to go live, `/deploy` handles Cloudflare, domains, and publishing. The whole process takes about 45 minutes.

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

## Available commands

| Command | What it does |
|---|---|
| `/start` | First-time setup: business discovery, design interview, tools, preview |
| `/design-interview` | Redo the visual identity (can run anytime after `/start`) |
| `/deploy` | Build, security scan, deploy, domain setup |
| `/check` | Health audit (build, privacy, security, accessibility) |
| `/fix` | Diagnose and fix common problems |
| `/update` | Update dependencies safely |
| `/new-page` | Create a new page with SEO and accessibility |
| `/setup` | Reinstall tools and dependencies |
| `/setup-customers` | Set up customer/client management (recommends industry tools) |
| `/domain` | Manage DNS records (email, Bluesky verification, etc.) |

## Project structure

```
website/
├── .claude/commands/   Claude Code slash commands
├── docs/               Architecture, hosting, content, and customer docs
├── src/                Astro source (pages, layouts, components, content)
├── public/             Static assets, security headers, robots.txt
├── scripts/            Shell scripts (setup, prerequisites)
├── CLAUDE.md           Webmaster instructions (read by Claude Code)
└── README.md           End-user guide (read by the site owner)
```

## Customization

The scaffold ships with placeholder content. After `/start`, the site reflects the owner's brand. Blog posts are created through the Keystatic visual editor — no code editing needed.

To adapt this scaffold for a different project, update:

- `CLAUDE.md` — webmaster context
- `README.md` — end-user instructions
- `keystatic.config.ts` — content schema
- `.claude/commands/` — slash commands

## License

Private. Not open source.
