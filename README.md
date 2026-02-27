# Anglesite

A website scaffold for non-technical users. Download the zip, expand it, open the folder in Claude Desktop's Code tab, and your AI webmaster handles the rest.

## What's inside

The `website/` directory is a complete Astro + Keystatic static site with:

- Blog engine with a visual editor (Keystatic CMS)
- Cloudflare Pages hosting with zero third-party JavaScript
- macOS app bundle with a task menu for common actions
- Built-in Claude Code commands for setup, design, deployment, and maintenance
- iCloud sync support (heavy directories excluded via `.nosync` symlinks)

## Who this is for

Small businesses, farms, artists, or anyone who wants a fast, private, professional website without learning to code. The site owner interacts through a task menu app and Claude Desktop — no terminal required after initial setup.

## Getting started

1. Download and unzip
2. Open the `website/` folder in Claude Desktop's Code tab
3. Type `/setup` and follow the prompts

The setup command installs Node.js, creates a Cloudflare Pages project, and deploys the site. A design interview (`/design-interview`) customizes colors, fonts, and branding. The whole process takes about 30 minutes.

## Stack

| Component | Technology |
|---|---|
| Site generator | Astro 5 |
| Content editor | Keystatic |
| Hosting | Cloudflare Pages |
| Analytics | Cloudflare Web Analytics |
| Language | TypeScript (strict) |
| Styling | Vanilla CSS with custom properties |
| Membership (optional) | Airtable |

## Available commands

| Command | What it does |
|---|---|
| `/setup` | First-time bootstrap: tools, hosting, first deploy |
| `/design-interview` | Conversational visual identity intake |
| `/deploy` | Build, security scan, deploy to Cloudflare |
| `/check` | Health audit (build, privacy, security, accessibility) |
| `/fix` | Diagnose and fix common problems |
| `/update` | Update dependencies safely |
| `/new-page` | Create a new page with SEO and accessibility |
| `/setup-airtable` | Set up CSA membership management |
| `/draft-email` | Draft emails to members |

## Project structure

```
website/
├── .claude/commands/   Claude Code slash commands
├── docs/               Architecture, hosting, content, and app documentation
├── src/                Astro source (pages, layouts, components, content)
├── public/             Static assets, security headers, robots.txt
├── scripts/            Shell scripts (task menu, setup, prerequisites)
├── CLAUDE.md           Webmaster instructions (read by Claude Code)
└── README.md           End-user guide (read by the site owner)
```

## Customization

The scaffold ships with placeholder content. After `/setup` and `/design-interview`, the site reflects the owner's brand. Blog posts are created through the Keystatic visual editor — no code editing needed.

To adapt this scaffold for a different project, update:

- `package.json` — project name
- `astro.config.ts` — site URL
- `keystatic.config.ts` — content schema
- `CLAUDE.md` — webmaster context
- `README.md` — end-user instructions
- `scripts/farm.sh` — task menu actions
- `.claude/commands/` — slash commands

## License

Private. Not open source.
