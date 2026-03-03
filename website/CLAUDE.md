# Anglesite Plugin — Development Context

Anglesite is a Claude Code plugin that scaffolds and manages websites for small businesses.

## Plugin structure

```
├── .claude-plugin/plugin.json    Plugin manifest
├── skills/                        User-invocable skills (10)
│   ├── start/SKILL.md             First-time setup + scaffolding
│   ├── deploy/SKILL.md            Build, scan, deploy
│   ├── design-interview/SKILL.md  Visual identity intake
│   ├── check/SKILL.md             Health audit
│   └── ...                        setup, fix, domain, new-page, update, setup-customers
├── settings.json                  Plugin permissions
├── scripts/scaffold.sh            Copies template/ to user's project
└── template/                      Files scaffolded to user's project
    ├── src/                       Astro source (pages, layouts, styles)
    ├── public/                    Static assets
    ├── scripts/                   setup.sh, check-prereqs.sh, cleanup.sh
    ├── docs/                      Reference documentation (80+ files)
    ├── CLAUDE.md                  Webmaster instructions
    ├── AGENTS.md                  Cross-tool AI instructions
    └── ...                        Config files (package.json, astro.config.ts, etc.)
```

## How it works

1. User installs the plugin from the marketplace (or `claude --plugin-dir ./`)
2. `/anglesite:start` runs `scripts/scaffold.sh` to copy `template/` to the user's project
3. Start skill proceeds with business interview, design, and tool installation
4. All other skills (`/anglesite:deploy`, `/anglesite:check`, etc.) execute in the user's working directory — relative paths to `docs/`, `scripts/` work because they were scaffolded

## Editing guidelines

- **Template files** go in `template/` — they're copied to the user's project during `/anglesite:start`
- **Skills** go in `skills/` — they reference user project files (relative) and plugin files (`${CLAUDE_PLUGIN_ROOT}`)
- **Plugin permissions** are in `settings.json` at the plugin root
- **Cross-skill references** use `${CLAUDE_PLUGIN_ROOT}/skills/skill-name/SKILL.md`

## Testing changes

```sh
mkdir /tmp/test-site
zsh scripts/scaffold.sh /tmp/test-site
cd /tmp/test-site
npm install
npm run dev
```
