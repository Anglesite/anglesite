# Architecture

## Stack decisions

**Astro 5** — Static site generator. Fast builds, zero JS by default, great for content sites.

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

System fonts by default (no external font loading). Override in brand.md if the owner chooses specific fonts.

## Pages

The scaffold ships with a home page and blog. Additional pages are created during `/design-interview` based on the business type, or added later via `/new-page`.

Common pages by business type:
- **Restaurant:** menu, hours/location, about, reservations, events
- **Retail:** products, about, location, events
- **Legal:** practice areas, attorneys, contact, testimonials
- **Farm:** what we grow, subscriptions, blog, events
- **Artist/maker:** portfolio, about, commissions, shop
- **Creator/influencer:** about, portfolio/media kit, collaborations, blog, links
- **Service:** services, about, testimonials, contact, booking

For other business types (healthcare, real estate, nonprofit, fitness, salon, trades, photography, pet services, hospitality, education), see `docs/smb/` for industry-specific pages, tools, compliance notes, and structured data guidance.

All sites include:
- `/` — Home page (customized during `/design-interview`)
- `/blog/` — Blog listing (last 30 days, link to archive)
- `/blog/[slug]` — Individual posts
- `/blog/archive/` — Older posts
- `/keystatic/` — CMS editor (dev only, blocked in production)

## Blog archive strategy

The blog listing page (`/blog/`) shows posts from the last 30 days, newest first. Older posts live at `/blog/archive/`, also newest first. This keeps the main blog page fresh without deleting anything.

Posts with `draft: true` are excluded from both pages in production builds.

## Customer management

Configured via `/setup-customers`. Asks what the owner already uses first, then recommends tools following the SaaS criteria (tool reduction, open source, affordable, values-aligned, ease of use). See `docs/smb/` for industry-specific tool and data tracking recommendations.

## Output

`static` mode in Astro config. All pages pre-rendered at build time. Keystatic integration runs server-side in dev mode only.
