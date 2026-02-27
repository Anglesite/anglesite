# Anglesite — Project Context

Anglesite is a website scaffold distributed as a zip file. The end user expands the zip, opens the `website/` folder in Claude Desktop's Code tab, and uses slash commands to set up and manage their site.

## Repository layout

```
Anglesite/
├── CLAUDE.md        ← You are here. Meta-project context.
├── README.md        ← How to use and customize the scaffold.
└── website/         ← The distributable scaffold.
    ├── CLAUDE.md    ← Webmaster instructions (read when user opens website/ in Claude Code)
    ├── README.md    ← End-user guide
    └── ...          ← Astro site, scripts, docs, commands
```

The two levels of CLAUDE.md serve different audiences:

- **This file** (root): For the developer building and maintaining the scaffold itself.
- **`website/CLAUDE.md`**: For the AI webmaster operating the deployed site on behalf of the end user.

## What the scaffold provides

- Astro 5 + Keystatic CMS static site
- Cloudflare Pages deployment via Wrangler
- Claude Code slash commands for setup, design, deploy, and maintenance
- iCloud sync with `.nosync` symlinks for heavy directories
- Privacy-first: zero third-party JS, security headers, PII scanning before deploy
- Business-type discovery during setup (farm, restaurant, legal, retail, maker, artist, service)
- Industry-specific tool recommendations for customer management (Airtable as fallback)

## Working on the scaffold

When editing files in `website/`, you're changing what the end user receives. Keep in mind:

- **The end user is non-technical.** Slash commands are their primary interface. Changes should not require CLI knowledge.
- **Privacy and security are non-negotiable.** The deploy gate in `/deploy` scans for PII, exposed tokens, third-party scripts, and Keystatic admin routes. Don't weaken these checks.
- **Documentation must stay in sync.** The `docs/` directory is the source of truth for architecture, hosting, content, and customer management. Update docs when you change behavior.
- **Shell commands must not be chained.** The Claude Code permission system in `website/.claude/settings.json` allows specific single commands. Chained commands (`&&`, `||`, `;`) trigger permission prompts that confuse the end user.

## Key decisions

| Decision | Why |
|---|---|
| Astro (not Next/Nuxt) | Zero client JS by default, best for static content sites |
| Keystatic (not headless CMS) | Local `.mdx` files, no external API dependency |
| Cloudflare Pages (not Vercel/Netlify) | Free, fast, direct Wrangler deploy without Git integration |
| Vanilla CSS | No build-time framework overhead, custom properties for theming |
| iCloud + .nosync | Automatic backup on the user's existing infrastructure |
| Industry tools first | Recommend purpose-built solutions (Square, Shopify, Clio, etc.) over generic databases |

## Testing changes

1. `cd website && npm install && npm run dev` — local dev server at localhost:4321
2. `npm run build` — verify the production build succeeds
3. `npm run check` — TypeScript and Astro diagnostics
4. Walk through `/setup` mentally — does the first-run experience still work?
5. Verify `/deploy` security gates haven't been bypassed
