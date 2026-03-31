# Editing Guidelines

- **Template files** go in `template/` — they're copied to the user's project during `/anglesite:start`
- **Skills** go in `skills/` — they reference user project files (relative) and plugin files (`${CLAUDE_PLUGIN_ROOT}`)
- **Tool permissions** are in each skill's `allowed-tools` frontmatter (not `settings.json`)
- **Cross-skill references** use `${CLAUDE_PLUGIN_ROOT}/skills/skill-name/SKILL.md`
- **The end user is non-technical.** Skills are their primary interface. Changes should not require CLI knowledge.
- **Cross-platform.** Template scripts detect macOS/Linux/Windows via `scripts/platform.ts`. Never use platform-specific commands (`sips`, `pfctl`, `dscacheutil`, `osascript`, `open`, `sed -i ""`) without a cross-platform alternative or guard.
- **Privacy and security are non-negotiable.** The deploy skill scans for PII, exposed tokens, third-party scripts, and Keystatic admin routes.
- **Reference docs** go in `docs/` at the plugin root — skills read them via `${CLAUDE_PLUGIN_ROOT}/docs/`.
- **Site-specific docs** go in `template/docs/` — these are scaffolded to the user's project and updated per-site.
- **Documentation must stay in sync.** Update docs when you change behavior.
- **Skill registry** is auto-generated. After adding or changing a skill, run `npm run registry` to update `docs/dev/skill-registry.md`. The test suite will fail if the registry is stale.

## Key decisions

| Decision | Why |
|---|---|
| Claude Code Plugin | Marketplace distribution, versioning, namespace isolation |
| Astro (not Next/Nuxt) | Zero client JS by default, best for static content sites |
| Keystatic (not headless CMS) | Local `.mdoc` files, no external API dependency |
| Cloudflare Pages (not Vercel/Netlify) | Free, fast, Git integration auto-deploys from `main` |
| GitHub (not GitLab) | `gh` CLI browser OAuth is simplest for non-technical users; private repos free |
| Vanilla CSS | No build-time framework overhead, custom properties for theming |
| Industry tools first | Recommend purpose-built solutions (Square, Shopify, Clio, etc.) over generic databases |
| Edge A/B testing (not client-side) | Build-time variants + Pages Function assignment = zero flicker, static-site compatible |

Full ADRs are in `docs/decisions/` (ADR-0001 through ADR-0014).
