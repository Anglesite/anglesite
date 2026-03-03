# Anglesite

A Claude Code plugin that acts as an AI webmaster for small business websites. Scaffolds, designs, and deploys Astro + Keystatic sites on Cloudflare Pages.

## Installation

Install from the Claude Code marketplace:

```
claude plugin install anglesite
```

Or install locally during development:

```
claude --plugin-dir ./website
```

## Usage

1. Create a new directory for your site
2. Run `/anglesite:start` — the plugin scaffolds the project, interviews the owner, designs the site, and installs tools
3. Run `/anglesite:deploy` — builds, security-scans, and deploys to Cloudflare Pages

## Available skills

| Skill | What it does |
|---|---|
| `/anglesite:start` | First-time setup: business discovery, design, tools, preview |
| `/anglesite:design-interview` | Redo the visual identity |
| `/anglesite:deploy` | Build, security scan, deploy, domain setup |
| `/anglesite:check` | Health audit (build, privacy, security, accessibility) |
| `/anglesite:fix` | Diagnose and fix common problems |
| `/anglesite:update` | Update dependencies safely |
| `/anglesite:new-page` | Create a new page with SEO and accessibility |
| `/anglesite:setup` | Reinstall tools and dependencies |
| `/anglesite:setup-customers` | Set up customer/client management |
| `/anglesite:domain` | Manage DNS records (email, Bluesky, etc.) |

## Stack

| Component | Technology |
|---|---|
| Site generator | Astro 5 |
| Content editor | Keystatic |
| Hosting | Cloudflare Pages |
| Analytics | Cloudflare Web Analytics |
| Language | TypeScript (strict) |
| Styling | Vanilla CSS with custom properties |

## Development

See [CLAUDE.md](website/CLAUDE.md) for plugin development context.

## License

Private. Not open source.
