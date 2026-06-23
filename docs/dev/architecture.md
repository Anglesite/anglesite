# Plugin Structure

```
├── .claude-plugin/plugin.json    Plugin manifest (name, version, metadata)
├── skills/                       See docs/dev/skill-registry.md (auto-generated)
├── settings.json                 Plugin settings (empty — permissions via allowed-tools)
├── hooks/hooks.json              PreToolUse hook for deploy safety scans
├── scripts/
│   ├── scaffold.sh               Copies template/ to user's project (zsh, rsync)
│   ├── update.sh                 Compares template files against scaffolded site
│   ├── pre-deploy-check.sh       Blocks deploy if security scans fail
│   ├── pack-plugin.sh            Builds distributable plugin ZIP
│   ├── design-import/            Canva/Figma extraction scripts
│   │   ├── canva-playwright.mjs  Browser-based Canva content extraction
│   │   ├── canva-colors.mjs      Canva color token extraction
│   │   ├── canva-fonts.mjs       Canva font extraction
│   │   ├── comparison.mjs        Design comparison utilities
│   │   ├── infer-axes.mjs        Layout axis inference
│   │   ├── layout-heuristics.mjs Layout detection heuristics
│   │   └── text-hierarchy.mjs    Text hierarchy analysis
│   └── import/                   Platform-specific extraction scripts
│       ├── menu-extract.mjs      Menu extraction from PDF/photo
│       ├── wix/
│       │   ├── wix-playwright.mjs Browser-based content + CSS token extraction
│       │   ├── wix-extract.mjs    Curl+regex fallback for Wix HTML parsing
│       │   └── color-utils.mjs    RGB/hex conversion, luminance, color classification
│       └── wordpress/
│           ├── wp-xml-parse.mjs   WordPress WXR export parser
│           └── wp-content-clean.mjs WordPress content cleanup
├── server/                       MCP annotation server + shared modules (Node.js, ESM)
│   ├── annotations.mjs           Annotation store (CRUD + persistence)
│   ├── selector.mjs              CSS selector generation from element metadata
│   ├── messages.mjs              WebSocket message schema (overlay ↔ server)
│   └── index.mjs                 MCP stdio server entry point
├── bin/
│   ├── build-instructions.ts     Agent instruction file validator
│   ├── build-agent-skills.ts     Generates agent-skills/ (Open Agent Skills export)
│   ├── generate-skill-registry.ts  Generates docs/dev/skill-registry.md from frontmatter
│   └── release.ts                Semantic version bumper (updates all manifests)
├── package.json                  Dev dependencies and test scripts
├── vitest.config.ts              Test configuration
├── docs/                         Reference docs (read by skills via ${CLAUDE_PLUGIN_ROOT})
│   ├── smb/                      Business type guides (67 files, ~59 verticals)
│   ├── import/                   Platform migration guides (29 files)
│   ├── platforms/                Tool integration guides (23 files)
│   ├── dev/                      Plugin development docs (this directory)
│   └── decisions/                ADRs — architecture decision records (24 files)
├── template/                     Files scaffolded to user's project
│   ├── src/                      Astro source (pages, layouts, styles)
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

## How it works

1. User installs the plugin from the marketplace (or `claude --plugin-dir .` for development)
2. `/anglesite:start` runs `scripts/scaffold.sh` to copy `template/` to the user's project
3. Start skill proceeds with discovery interview, design, and tool installation
4. All other skills (`/anglesite:deploy`, `/anglesite:check`, etc.) execute in the user's working directory
