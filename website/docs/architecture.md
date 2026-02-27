# Architecture

## Stack decisions

**Astro 5.16** — Static site generator. Fast builds, zero JS by default, great for content sites.

**Keystatic CMS** — Browser-based editor at `/keystatic`. Writes `.mdx` files directly. No database.

**TypeScript strict** — Build-time errors instead of runtime failures. Better error messages from Claude Code.

**Cloudflare Pages** — Free hosting with edge CDN. Direct deploy via Wrangler (no GitHub needed).

**Cloudflare Web Analytics** — Free, privacy-first (no cookies). Auto-injected into Pages projects.

## Content collections

Blog posts in `src/content/posts/`. Schema defined in both `src/content/config.ts` (Astro) and `keystatic.config.ts` (editor). Keep them in sync.

## Styling

CSS custom properties in `src/styles/global.css`. Values set during `/design-interview` and documented in `docs/brand.md`:
- `--color-primary`, `--color-accent`, `--color-bg`, `--color-text`
- `--font-heading`, `--font-body`
- `--space-*` for consistent spacing

System fonts by default (no external font loading). Override in brand.md if Julia chooses specific fonts.

## Pages

- `/` — Home page
- `/blog/` — Blog listing
- `/blog/[slug]` — Individual posts
- `/keystatic/` — CMS editor (dev only, blocked in production)

Additional pages added via `/new-page` command.

## Output

`hybrid` mode in Astro config. Static pages pre-rendered. Keystatic integration requires this setting.
