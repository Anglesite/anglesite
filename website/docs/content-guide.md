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

## Your website is the center

The owner's website is the hub of their online presence. Social media platforms come and go, change their algorithms, or shut down — but the website is theirs. Every piece of content should live on the website first. Social media posts should drive people back to the website, not the other way around.

This means:
- **Publish here first.** The blog post, the announcement, the photo gallery — it goes on the website before anywhere else.
- **Social media is distribution, not home base.** Facebook, Instagram, Nextdoor, Google Business Profile — these are places to share a link and a teaser, not the full content.
- **Every social post should link back.** When sharing on social media, always include a link to the full content on the website. This drives traffic, builds search ranking, and ensures the owner controls the audience relationship.
- **Leads belong to the owner.** Someone who visits the website can be reached again — through the blog, through email, through a return visit. Someone who only sees a Facebook post is at the mercy of the algorithm.

### POSSE workflow

Publish On (own) Site, Syndicate Elsewhere:
1. Write and publish the post on the website
2. Share on social media with a link back to the website
3. Copy the social media share URLs
4. Edit the post in Keystatic → add URLs to the Syndication Links field
5. Save and publish again

The syndication URLs render as `u-syndication` links in the `h-entry` markup, connecting the original post to its copies.

### Where to share

Help the owner identify where their customers already are:
- **Facebook** — Still dominant for local businesses, events, community groups. Share blog post link with a short teaser and photo.
- **Instagram** — Visual businesses (restaurants, florists, tattoo, photography, makers). Post the photo with a caption that says "link in bio" pointing to the website.
- **Nextdoor** — Hyperlocal. Great for trades, cleaning, pet services, childcare, repair shops. Share a helpful tip with a link to the full article.
- **Google Business Profile** — Post updates directly. Helps local search ranking. Link to the website.
- **LinkedIn** — Professional services, accounting, insurance, B2B. Share expertise posts with a link.
- **TikTok / YouTube** — If the owner creates video content. The website hosts the permanent version; social gets the clip.

The owner doesn't need to be on every platform. Pick 1–2 where their customers actually are.

## What to post about

Content brings people to the website. Help the owner think about what their customers want to know. Every post is an opportunity to demonstrate expertise, build trust, and give people a reason to visit.

### Post types

Not everything has to be a long blog post. Mix formats:

- **Blog posts** — Longer, evergreen content. Tips, guides, how-tos, explainers. Great for search traffic. Published on the website, shared everywhere.
- **Photo posts** — Before/after shots, new products, behind the scenes, event photos. Quick to create, highly shareable. Post the photo on the website with a caption, then share on social.
- **Announcements** — New hours, new services, holiday closures, event dates. Short and factual. Post on the website first so there's a permanent link, then share on social.
- **Seasonal/timely** — Holiday specials, seasonal tips, weather-related advice. Plan these ahead — they're predictable and high-traffic.
- **Customer stories** — Testimonials, case studies, "before and after" features (with permission). The most persuasive content there is.

### Ideas by business type

**Restaurant** — New menu items, seasonal specials, behind-the-scenes photos, event announcements, chef spotlights, community involvement.

**Retail** — New products, restocks, sale announcements, how-to guides for products, customer stories, local event participation.

**Legal / professional services** — Answers to common client questions, explainers on legal topics, case study summaries (anonymized), team updates, community involvement.

**Farm / CSA** — What's in season, harvest updates, farm life photos, subscription info, recipes using farm products, market schedule.

**Artist / maker** — New work, process photos, commission availability, exhibition announcements, inspiration and influences, behind-the-scenes.

**Content creator / influencer** — Behind-the-scenes of content creation, brand partnership announcements, personal takes on industry trends, audience Q&A recaps, event appearances, product reviews (owned, not just on social), collaboration highlights, media kit updates.

**Service business** — Tips related to the service, client success stories, process explanations, availability updates, FAQ answers, industry news.

For all other business types, check `docs/smb/` — each file has a "Content ideas" section with industry-specific suggestions.

### Frequency

Aim for 1–4 posts per month. Consistency matters more than frequency. One good post a month beats four rushed ones. Social shares can happen more often — reshare older blog posts, post quick photos, respond to community events.

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
