# Anglesite — Development Context

Anglesite is a Claude Code plugin (and npm package) that scaffolds and manages websites.

## Plugin structure

```
├── .claude-plugin/plugin.json    Plugin manifest
├── skills/                        Skills (9 total, 6 user-facing)
│   ├── start/SKILL.md             First-time setup + scaffolding
│   ├── deploy/SKILL.md            Build, scan, deploy
│   ├── check/SKILL.md             Health audit + troubleshooting
│   ├── domain/SKILL.md            DNS management
│   ├── import/SKILL.md            Import from website URL
│   ├── convert/SKILL.md           Convert SSG project to Anglesite
│   ├── design-interview/SKILL.md  Visual identity (model-only)
│   ├── animate/SKILL.md           CSS animations (model-only)
│   └── new-page/SKILL.md          Page creation (model-only)
├── settings.json                  Plugin settings (empty — permissions via allowed-tools)
├── hooks/hooks.json               PreToolUse hook for deploy safety scans
├── scripts/scaffold.sh            Copies template/ to user's project
├── scripts/pre-deploy-check.sh    Blocks deploy if security scans fail
├── bin/init.js                    CLI entry point (npx anglesite init)
├── bin/average-tokens.ts          Token cost calculator
├── bin/build-instructions.ts      Agent instruction validator
├── package.json                   npm package manifest
├── docs/                          Reference docs (read by skills via ${CLAUDE_PLUGIN_ROOT})
│   ├── smb/                       Business type guides (70 files)
│   ├── import/                    Platform migration guides (28 files)
│   ├── platforms/                 Tool integration guides (13 files)
│   └── decisions/                 ADRs — default technical choices (13 files)
└── template/                      Files scaffolded to user's project
    ├── src/                       Astro source (pages, layouts, styles)
    ├── public/                    Static assets
    ├── scripts/                   setup.ts, check-prereqs.ts, cleanup.ts, platform.ts
    ├── docs/                      Site-specific docs (~15 files) + workflows/
    ├── AGENTS.md                  Universal webmaster instructions (any agent)
    ├── CLAUDE.md                  Claude Code-specific additions (@imports AGENTS.md)
    ├── GEMINI.md                  Gemini CLI pointer (@imports AGENTS.md)
    └── ...                        Config (package.json, astro.config.ts, etc.)
```

Three levels of agent instructions:

- **This file** (root `CLAUDE.md`): For the developer building and maintaining the plugin.
- **`template/AGENTS.md`**: Universal webmaster instructions — read by Codex, Cursor, Copilot, and 20+ other tools.
- **`template/CLAUDE.md`**: Claude Code-specific additions — `@imports` AGENTS.md and adds slash commands, EXPLAIN_STEPS, shell rules.
- **`template/GEMINI.md`**: One-line pointer — `@AGENTS.md`. Gemini CLI reads this natively.

## How it works

**Claude Code plugin** (richest experience):
1. User installs the plugin from the marketplace (or `claude --plugin-dir .`)
2. `/anglesite:start` runs `scripts/scaffold.sh` to copy `template/` to the user's project
3. Start skill proceeds with discovery interview, design, and tool installation
4. All other skills (`/anglesite:deploy`, `/anglesite:check`, etc.) execute in the user's working directory

**npm package** (any agent):
1. `npx anglesite init my-site` copies `template/` + `docs/` to a new directory
2. `npm install && npm run dev` to start developing
3. Any AI agent reads `AGENTS.md` for project context and `docs/workflows/` for step-by-step guides

## Editing guidelines

- **Template files** go in `template/` — they're copied to the user's project during `/anglesite:start`
- **Skills** go in `skills/` — they reference user project files (relative) and plugin files (`${CLAUDE_PLUGIN_ROOT}`)
- **Tool permissions** are in each skill's `allowed-tools` frontmatter (not `settings.json`)
- **Cross-skill references** use `${CLAUDE_PLUGIN_ROOT}/skills/skill-name/SKILL.md`
- **The end user is non-technical.** Skills are their primary interface. Changes should not require CLI knowledge.
- **Cross-platform.** Template scripts detect macOS/Linux/Windows via `scripts/platform.ts`. Never use platform-specific commands (`sips`, `pfctl`, `dscacheutil`, `osascript`, `open`, `sed -i ""`) without a cross-platform alternative or guard.
- **Privacy and security are non-negotiable.** The deploy skill scans for PII, exposed tokens, third-party scripts, and Keystatic admin routes.
- **Reference docs** go in `docs/` at the plugin root — skills read them via `${CLAUDE_PLUGIN_ROOT}/docs/`. The npm init script copies them to the user's project for non-plugin agents.
- **Site-specific docs** go in `template/docs/` — these are scaffolded to the user's project and updated per-site.
- **Documentation must stay in sync.** Update docs when you change behavior.

## Key decisions

| Decision | Why |
|---|---|
| Claude Code Plugin | Marketplace distribution, versioning, namespace isolation |
| Astro (not Next/Nuxt) | Zero client JS by default, best for static content sites |
| Keystatic (not headless CMS) | Local `.mdx` files, no external API dependency |
| Cloudflare Pages (not Vercel/Netlify) | Free, fast, Git integration auto-deploys from `main` |
| GitHub (not GitLab) | `gh` CLI browser OAuth is simplest for non-technical users; private repos free |
| Vanilla CSS | No build-time framework overhead, custom properties for theming |
| Industry tools first | Recommend purpose-built solutions (Square, Shopify, Clio, etc.) over generic databases |

## Testing changes

```sh
# Via scaffold script (plugin development)
mkdir /tmp/test-site
zsh scripts/scaffold.sh /tmp/test-site
cd /tmp/test-site
npm install
npm run dev

# Via npm CLI (end-user experience)
node bin/init.js init /tmp/test-site
cd /tmp/test-site
npm install
npm run dev
```
