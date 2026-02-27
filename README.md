# Anglesite

A website scaffold for non-technical users. Download the zip, expand it, open the folder in Claude Desktop's Code tab, and your AI webmaster handles the rest.

## Philosophy

- Anglesite builds Astro websites hosted on Cloudflare
- Anglesite is an opinonated webmaster
  - IndieWeb first
  - Accessible sites by design
  - Avoid external runtime dependencies
  - Leverage Astro and NPM modules rather than re-invent the wheel through custom code.
  - Advise the website owner on best practices
  - Some SaaS use is unavoidabile, when helping the user select solutions use the following criteria
    - Tool reduction, suggest Cloudlfare Analytics before introducing a new tool
    - Open Source
    - Free or at cost
    - Federated, non-profits, co-ops, B-Corps, and Public Benifit Corperations are prefered over commerical solutions.
    - Ease of use, unusable software is rarely used

## What's inside

The `website/` directory is a complete Astro + Keystatic static site with:

- Blog engine with a visual editor (Keystatic CMS)
- Cloudflare Pages hosting with zero third-party JavaScript
- Built-in Claude Code commands for setup, design, deployment, and maintenance
- iCloud sync support (heavy directories excluded via `.nosync` symlinks)
- Business-type discovery that tailors the site to your industry

## Who this is for

Small businesses — farms, restaurants, legal firms, retailers, makers, artists, service providers — who want a fast, private, professional website without learning to code. The site owner interacts through Claude Desktop — no terminal required after initial setup.

## Getting started

1. Download and unzip
2. Open the `website/` folder in Claude Desktop's Code tab
3. Type `/setup` and follow the prompts

The setup command asks about your business, installs tools, and personalizes the site. A design interview (`/design-interview`) customizes colors, fonts, and layout. The whole process takes about 30 minutes.

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
| `/setup` | First-time bootstrap: business discovery, tools, personalization |
| `/design-interview` | Conversational visual identity intake |
| `/deploy` | Build, security scan, deploy to Cloudflare |
| `/check` | Health audit (build, privacy, security, accessibility) |
| `/fix` | Diagnose and fix common problems |
| `/update` | Update dependencies safely |
| `/new-page` | Create a new page with SEO and accessibility |
| `/setup-customers` | Set up customer/client management (recommends industry tools) |
| `/setup-email` | Set up custom domain email via iCloud |
| `/draft-email` | Draft emails to customers |

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

The scaffold ships with placeholder content. After `/setup` and `/design-interview`, the site reflects the owner's brand. Blog posts are created through the Keystatic visual editor — no code editing needed.

To adapt this scaffold for a different project, update:

- `CLAUDE.md` — webmaster context
- `README.md` — end-user instructions
- `keystatic.config.ts` — content schema
- `.claude/commands/` — slash commands

## License

Private. Not open source.
