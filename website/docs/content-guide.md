# Content Guide

## Blog posts

Posts live in `src/content/posts/` as `.mdx` files. The owner creates them via Keystatic at `/keystatic/collection/posts`.

### Required frontmatter
- `title` — Post title
- `description` — For meta tags and listings (1–2 sentences)
- `publishDate` — YYYY-MM-DD format

### Optional frontmatter
- `image` — Path relative to public/ (e.g., `/images/blog/photo.webp`)
- `imageAlt` — Required if image is set
- `tags` — Array of strings. Default tags: `news`, `update`, `event`. Updated by `/design-interview` to match the business.
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
1. Write and publish the post on the website
2. Share on social media
3. Copy the share URLs
4. Edit the post in Keystatic → add URLs to the Syndication Links field
5. Save and publish again

The syndication URLs render as `u-syndication` links in the `h-entry` markup, connecting the original post to its copies.

## What to write about

Content brings people to the site. Help the owner think about what their customers want to know.

**Restaurant** — New menu items, seasonal specials, behind-the-scenes photos, event announcements, chef spotlights, community involvement.

**Retail** — New products, restocks, sale announcements, how-to guides for products, customer stories, local event participation.

**Legal / professional services** — Answers to common client questions, explainers on legal topics, case study summaries (anonymized), team updates, community involvement.

**Farm / CSA** — What's in season, harvest updates, farm life photos, subscription info, recipes using farm products, market schedule.

**Artist / maker** — New work, process photos, commission availability, exhibition announcements, inspiration and influences, behind-the-scenes.

**Content creator / influencer** — Behind-the-scenes of content creation, brand partnership announcements, personal takes on industry trends, audience Q&A recaps, event appearances, product reviews (owned, not just on social), collaboration highlights, media kit updates.

**Service business** — Tips related to the service, client success stories, process explanations, availability updates, FAQ answers, industry news.

Aim for 1–4 posts per month. Consistency matters more than frequency. One good post a month beats four rushed ones.

## Why each page matters

- **Home** — First impression. Should answer: who are you, what do you do, why should I care?
- **About** — Builds trust. Search engines reward sites with clear identity.
- **Blog** — Brings search traffic. Write about problems your customers have.
- **Service/product pages** — What search engines look for when someone searches "restaurant near me" or "family lawyer in [city]."
- **Contact** — Make it easy. Phone, email, location, hours. Don't hide it.
- **Testimonials** — Social proof. Real quotes from real customers.

## Blog archive

The blog listing page (`/blog/`) shows only posts from the last 30 days, newest first. Older posts move to `/blog/archive/`. This keeps the main page fresh without deleting content.

Implementation: both pages query the same content collection, filtered by `publishDate` relative to the current build date. The archive page shows everything older than 30 days. The blog listing links to the archive at the bottom.
