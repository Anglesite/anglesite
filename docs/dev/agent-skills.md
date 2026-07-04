# Open Agent Skills export

Anglesite is distributed two ways from one source:

1. **Claude Code plugin** — the `skills/` tree, installed from the
   `Anglesite/anglesite` marketplace.
2. **Open Agent Skills** — a spec-compliant ([agentskills.io](https://agentskills.io) /
   [skills.sh](https://www.skills.sh)) export under `agent-skills/`, installable with
   `npx skills add Anglesite/anglesite/agent-skills/<skill>`.

The two coexist. `skills/` is the **source of truth**; `agent-skills/` is **generated**
by `bin/build-agent-skills.ts` (`npm run build:agent-skills`) and committed so the
skills.sh CLI can resolve individual skills by path.

## Why a build step (not dual-format files)

The plugin sources depend on machinery the Agent Skills spec does not support, so a
single file cannot satisfy both formats:

| Plugin feature | Spec status | Transform |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}/...` references | not supported (no variable substitution) | rewritten to relative `references/<path>`; the referenced file is bundled |
| `disable-model-invocation`, `user-invocable` | not in spec | dropped from frontmatter; intent preserved as `metadata.invocation` |
| `argument-hint` | not in spec | moved to `metadata.argument-hint` |
| cross-skill links to other `SKILL.md` | no spec mechanism | rewritten to a plain mention (``the `x` skill``); each skill installs independently |

## What the transformer does

Per `skills/<name>/SKILL.md` it emits `agent-skills/<name>/`:

- **Frontmatter** normalized to the spec: `name`, `description`, `license: ISC`,
  `compatibility` (Cloudflare/Node requirements inferred from `allowed-tools`),
  `allowed-tools` (preserved verbatim), and a `metadata` block (author, version,
  source, invocation, argument-hint).
- **Body** rewritten: `${CLAUDE_PLUGIN_ROOT}/` → `references/`; cross-skill links →
  mentions; `file.ts:symbol()` annotations preserved in prose but stripped from the
  copied path.
- **`references/`** containing every bundled file, mirroring its plugin-root path
  (e.g. `references/docs/decisions/0003-...md`). Runtime-computed paths
  (`docs/smb/<BUSINESS_TYPE>.md`) bundle their static parent directory so the path
  resolves at runtime.

`agent-skills/README.md` is a generated index with per-skill install commands.

## Validation

`bin/build-agent-skills.ts` validates names and descriptions against the spec rules
(name: 1–64 chars, lowercase/hyphens, no leading/trailing/consecutive hyphens;
description: 1–1024 chars) and prints warnings. `tests/build-agent-skills.test.ts`
unit-tests the transforms and asserts the committed `agent-skills/*/SKILL.md` matches a
fresh build. CI (`.github/workflows/test.yml`) re-runs the build and fails on any
`git diff` in `agent-skills/`.

## Keeping it in sync

Never edit `agent-skills/` by hand. Edit `skills/` and run:

```sh
npm run build:agent-skills   # all skills
npx tsx bin/build-agent-skills.ts seo deploy   # a subset (index not regenerated)
```

## Known limitations / follow-ups

- **Self-containment tradeoff.** Skills that reference a business-type guide
  (`docs/smb/<BUSINESS_TYPE>.md`) bundle the whole `docs/smb/` catalog (~66 files), so
  several skills duplicate it. This keeps each skill self-contained at the cost of repo
  size (~11 MB). A leaner mode (reference without bundling) is possible if desired.
- **Nested references.** A few bundled docs (e.g. `import`'s `docs/import/wix.md`)
  contain their own `${CLAUDE_PLUGIN_ROOT}` references that are not transitively
  rewritten. The build flags these as `NESTED REF`. Mostly affects the `import` skill.
- **Relative JS imports are not followed.** Bundled scripts keep their relative
  `import` statements but sibling modules referenced only via those imports are not
  copied (e.g. `canva-playwright.mjs` / `canva-safari.mjs` without `canva-colors.mjs`
  or `scripts/import/browser/safari-mcp.mjs`; `wix-playwright.mjs` without
  `color-utils.mjs`). Those scripts run in the plugin distribution but crash on import
  in an agent-skills install. Fix is to walk relative import graphs during bundling.
- **Body length.** `convert`, `deploy`, and `import` exceed the spec's recommended
  500-line `SKILL.md` budget. Functional, but candidates for splitting into
  `references/`.
- **`template/<path>` and the genuine source bug `compare-screenshots.mjs`** are
  surfaced as build warnings rather than silently bundled.
- **Registry listing.** `npx skills add <path>` works straight from git. Getting indexed
  by `npx skills find` is a separate skills.sh registry submission, not handled here.
