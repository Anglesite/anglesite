# Architecture

## Stack decisions

**Astro 5** — Static site generator. Fast builds, zero JS by default, great for content sites.

**Keystatic CMS** — Browser-based editor at `/keystatic`. Writes `.mdx` files directly. No database.

**TypeScript strict** — Build-time errors instead of runtime failures. Better error messages from Claude Code.

**Cloudflare Pages** — Free hosting with edge CDN. Direct deploy via Wrangler (no GitHub needed).

**Cloudflare Web Analytics** — Free, privacy-first (no cookies). Auto-injected into Pages projects.

**Airtable** — Member management, weekly deliveries, egg tracking, payments. Accessed via forms with unique URLs (no login required).

## Content collections

Blog posts in `src/content/posts/`. Schema defined in both `src/content/config.ts` (Astro) and `keystatic.config.ts` (editor). Keep them in sync.

## Styling

CSS custom properties in `src/styles/global.css`. Values set during `/design-interview` and documented in `docs/brand.md`:
- `--color-primary`, `--color-accent`, `--color-bg`, `--color-text`
- `--font-heading`, `--font-body`
- `--space-*` for consistent spacing

System fonts by default (no external font loading). Override in brand.md if Julia chooses specific fonts.

## Pages

### Live now
- `/` — Home: hero with farm photos, mission statement, 4 section cards linking to subpages
- `/blog/` — Blog listing (last month of posts, link to archive)
- `/blog/[slug]` — Individual posts
- `/blog/archive/` — Older posts (more than 1 month old)
- `/csa/` — CSA program: what they sell, how subscriptions work, inquiry email link
- `/keystatic/` — CMS editor (dev only, blocked in production)

### Coming soon (placeholder pages)
- `/furniture/` — Dogwood Dazed custom furniture and woodworking by Harry
- `/stay/` — LEED house Airbnb listing

Coming-soon pages show a brief description and "coming soon" message. When Julia's ready to launch them, she asks the webmaster to build them out.

## Home page structure

The landing page has:
1. **Hero** — Farm photos (tractor Xmas card, logo from Facebook), description, mission statement. Sustainability theme.
2. **Blog** card — Latest post preview, link to `/blog/`
3. **CSA** card — Description, photo of produce & eggs, link to `/csa/`
4. **Furniture** card — Description, photo, link to `/furniture/` (coming soon)
5. **Stay** card — Description, photo, link to `/stay/` (coming soon)

## Blog archive strategy

The blog listing page (`/blog/`) shows posts from the last 30 days, newest first. Older posts live at `/blog/archive/`, also newest first. This keeps the main blog page fresh without deleting anything.

Posts with `draft: true` are excluded from both pages in production builds.

## Customer interactions via Airtable

All member-facing features use Airtable forms with unique URLs — no login system needed:
- **Preference form** — each member gets a unique URL to update favorites, allergies, dislikes
- **Weekly delivery info** — Julia updates the Weekly Delivery table; members get a summary email via `/draft-email`
- **Payment reminders** — Venmo payment links (pre-filled amount + note) included in emails

See `docs/airtable.md` for full table schemas and form details.

## Email

Julia sends email from Mail.app using her @pairadocs.farm address (iCloud custom domain). The webmaster drafts emails via `/draft-email` and opens them in Mail.app with `mailto:` links. Julia reviews and sends manually.

Custom domain email requires iCloud+ and DNS records in Cloudflare. Set up via `/setup-email`.

## Output

`static` mode in Astro config. All pages pre-rendered at build time. Keystatic integration runs server-side in dev mode only.
