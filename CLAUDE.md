# Anglesite — Project Context

Anglesite is a Claude Code plugin that acts as an AI webmaster for small business websites. It's distributed via the marketplace. The end user installs the plugin, runs `/anglesite:start`, and the plugin scaffolds and manages their site.

## Repository layout

```
Anglesite/
├── CLAUDE.md              ← You are here. Meta-project context.
├── README.md              ← Plugin overview and installation.
├── bin/average-tokens.ts  ← Token cost calculator.
└── website/               ← The Anglesite plugin.
    ├── .claude-plugin/    ← Plugin manifest
    ├── skills/            ← User-invocable skills (10)
    ├── settings.json      ← Plugin permissions
    ├── scripts/           ← scaffold.sh (plugin-level)
    ├── template/          ← Files scaffolded to user's project
    │   ├── src/           ← Astro source
    │   ├── public/        ← Static assets
    │   ├── scripts/       ← setup.sh, check-prereqs.sh, cleanup.sh
    │   ├── docs/          ← Reference documentation
    │   ├── CLAUDE.md      ← Webmaster instructions (scaffolded)
    │   └── ...            ← Config files
    ├── CLAUDE.md          ← Plugin development context
    └── README.md          ← Plugin README
```

The two levels of CLAUDE.md serve different audiences:

- **This file** (root): For the developer building and maintaining the plugin itself.
- **`website/CLAUDE.md`**: For the developer working on the plugin skills and template.
- **`website/template/CLAUDE.md`**: For the AI webmaster operating the deployed site on behalf of the end user.

## What the plugin provides

- 10 user-invocable skills (`/anglesite:start`, `/anglesite:deploy`, etc.)
- Astro 5 + Keystatic CMS project template
- Cloudflare Pages deployment via Wrangler
- iCloud sync with `.nosync` symlinks for heavy directories
- Privacy-first: zero third-party JS, security headers, PII scanning before deploy
- Business-type discovery during setup (56 industry types)
- Industry-specific tool recommendations for customer management

## Working on the plugin

When editing files in `website/`, you're changing what the end user receives:

- **Skills** (`website/skills/`) define the commands. Each skill has a `SKILL.md` with YAML frontmatter.
- **Template files** (`website/template/`) are scaffolded to the user's project during `/anglesite:start`.
- **Plugin permissions** (`website/settings.json`) define allowed bash commands.
- **The end user is non-technical.** Skills are their primary interface. Changes should not require CLI knowledge.
- **Privacy and security are non-negotiable.** The deploy skill scans for PII, exposed tokens, third-party scripts, and Keystatic admin routes.
- **Documentation must stay in sync.** The `template/docs/` directory is the source of truth. Update docs when you change behavior.

## Key decisions

| Decision | Why |
|---|---|
| Claude Code Plugin | Marketplace distribution, versioning, namespace isolation |
| Astro (not Next/Nuxt) | Zero client JS by default, best for static content sites |
| Keystatic (not headless CMS) | Local `.mdx` files, no external API dependency |
| Cloudflare Pages (not Vercel/Netlify) | Free, fast, direct Wrangler deploy without Git integration |
| Vanilla CSS | No build-time framework overhead, custom properties for theming |
| iCloud + .nosync | Automatic backup on the user's existing infrastructure |
| Industry tools first | Recommend purpose-built solutions (Square, Shopify, Clio, etc.) over generic databases |

## Testing changes

1. Scaffold a test project:
   ```sh
   mkdir /tmp/test-site && zsh website/scripts/scaffold.sh /tmp/test-site
   ```
2. `cd /tmp/test-site && npm install && npm run dev` — local dev server
3. `npm run build` — verify production build succeeds
4. Walk through `/anglesite:start` mentally — does the first-run experience still work?
5. Verify `/anglesite:deploy` security gates haven't been bypassed
