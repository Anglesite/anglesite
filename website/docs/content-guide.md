# Content Guide

## Blog posts

Posts live in `src/content/posts/` as `.mdx` files. Julia creates them via Keystatic at `/keystatic/collection/posts`.

### Required frontmatter
- `title` — Post title
- `description` — For meta tags and listings (1–2 sentences)
- `publishDate` — YYYY-MM-DD format

### Optional frontmatter
- `image` — Path relative to public/ (e.g., `/images/blog/tomatoes.webp`)
- `imageAlt` — Required if image is set
- `tags` — Array: `weekly-share`, `farm-update`, `recipe`, `seasonal`, `events`, `furniture`
- `draft` — Boolean. Drafts excluded from production builds.
- `syndication` — Array of URLs. Added after sharing on social media.

### Schema sync

The blog schema is defined in two places that must stay in sync:
- `src/content/config.ts` — Astro uses this for type checking
- `keystatic.config.ts` — Keystatic uses this for the editor UI

If you add or change a field, update both files.

## Images

- Store in `public/images/blog/` (blog) or `public/images/pages/` (site pages)
- Optimize before adding: aim for <500KB per image
- Use `.webp` format when possible
- Always include `alt` text for accessibility

## POSSE workflow

Publish On (own) Site, Syndicate Elsewhere:
1. Write and publish the post on pairadocs.farm
2. Share on social media (Facebook, Instagram, Nextdoor)
3. Copy the share URLs
4. Edit the post in Keystatic → add URLs to the Syndication Links field
5. Save and publish again

The syndication URLs render as `u-syndication` links in the `h-entry` markup, connecting the original post to its copies.

## Blog archive

The blog listing page (`/blog/`) shows only posts from the last 30 days, newest first. Older posts move to `/blog/archive/`. This keeps the main page fresh without deleting content.

Implementation: both pages query the same content collection, filtered by `publishDate` relative to the current build date. The archive page shows everything older than 30 days. The blog listing links to the archive at the bottom.
