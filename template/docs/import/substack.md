# Importing from Substack

Substack is a newsletter and blogging platform. Content is primarily delivered via email but also published as web pages. Every Substack publication has a public RSS feed with full content.

## How it detects this platform

URL patterns:
- `publication-name.substack.com` — standard Substack URL
- Custom domains — Substack custom domains use `www.` prefix and redirect from the root domain

Check for `.substack.com` in the URL. For custom domains, use WebFetch on the homepage and look for Substack-specific markup (Substack JavaScript bundles, `substackcdn.com` asset URLs, or `/subscribe` and `/archive` paths).

## Extraction methods

### RSS feed (best)

Every Substack has a public RSS feed:

```sh
curl -s "SITE_URL/feed"
```

For standard Substack URLs:
```sh
curl -s "https://PUBLICATION.substack.com/feed"
```

The RSS feed contains **full HTML content** for public posts. Each `<item>` includes:
- `<title>` — post title
- `<description>` or `<content:encoded>` — full HTML content
- `<link>` — post URL
- `<pubDate>` — publication date
- `<enclosure>` — cover image (if set)
- `<dc:creator>` — author name

### Data export (if owner has dashboard access)

The owner can export from Dashboard → Settings → Exports. This produces a CSV of subscriber data and may include post content. The RSS feed is more reliable for content extraction.

### WebFetch (for completeness)

For any posts not captured by the RSS feed, use WebFetch on each post URL.

## Frontmatter mapping

| Substack field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` | `title` | Direct copy |
| First paragraph of content | `description` | Substack has no excerpt field — generate from content |
| `<pubDate>` | `publishDate` | Convert to YYYY-MM-DD |
| — | `tags` | Substack has no tag system — leave as `[]` |
| `<enclosure>` URL or first image | `image` | Download from Substack CDN |
| `<link>` | `syndication` | Original Substack URL |

## Content conversion

Substack RSS content arrives as HTML. Convert to Markdown with these Substack-specific adjustments:

**Elements to handle:**
- `<figure>` with `<figcaption>` → `![alt](src)`
- `<div class="captioned-image-container">` → extract image and caption
- `<a class="image-link">` wrapping images → extract image, discard link wrapper
- `<blockquote>` — may be a pull quote → keep as `>`
- `<hr>` — section dividers → keep
- `<div class="subscription-widget">` — subscribe prompts → strip entirely
- `<div class="paywall">` — paywall markers → strip (content after this is truncated for non-subscribers)
- Button elements (`<div class="button-wrapper">`) → strip
- Share/like widgets → strip
- Footnotes (`<div class="footnote">`) → convert to inline parenthetical or keep as-is

**Email-specific content to strip:**
- "View in browser" links
- Unsubscribe links
- "Share this post" buttons
- Subscribe prompts and CTAs

## Image handling

Substack images are hosted on Substack's CDN:
- `substackcdn.com/image/fetch/...` — primary CDN
- `substack-post-media.s3.amazonaws.com/public/images/...` — S3 storage

CDN URLs include width parameters (e.g., `w_1456`). These can be adjusted but the default sizes are usually sufficient.

Download each image to `public/images/blog/`. Substack CDN URLs are stable while the publication exists.

## URL patterns for redirects

Substack post URLs follow a consistent pattern:
- `https://publication.substack.com/p/post-slug`
- Custom domain: `https://custom-domain.com/p/post-slug`

```
/p/post-slug /blog/post-slug 301
```

The `/p/` prefix is consistent across all Substack publications.

## Newsletter subscriber migration

Substack is primarily a newsletter platform. The owner almost certainly has email subscribers they want to keep when migrating away.

### Exporting subscribers from Substack

The owner exports from Dashboard → Settings → Exports. This downloads a ZIP file containing:

- **Subscriber CSV** — email addresses with subscription date, status (active/paused/cancelled), and type (free/paid)
- **Post content** — may include post CSVs (but the RSS feed is better for content extraction)

The subscriber CSV columns:
- `email` — subscriber email address
- `created_at` — subscription date
- `active_subscription` — whether currently subscribed
- `type` — "free" or "paid"
- `expiry` — paid subscription expiration date (if applicable)
- `plan_id` — Stripe plan ID (paid subscribers only)

### Migration paths

**Substack → Ghost:** Ghost has a built-in Substack importer. In Ghost Admin → Settings → Advanced → Import/Export → Import, select "Substack" and upload the ZIP export. Ghost imports both content and subscribers automatically. This is the fastest path if the owner wants Ghost as their newsletter backend. See `docs/platforms/ghost-newsletter.md`.

**Substack → Buttondown:** Buttondown has a dedicated Substack import feature at buttondown.email → Settings → Importing. Upload the subscriber CSV. Buttondown handles the mapping automatically.

**Substack → Mailchimp:** Import the subscriber CSV into Mailchimp via Audience → Add contacts → Import contacts → CSV file. Map the `email` column to Mailchimp's email field.

### When to offer this

Always offer newsletter migration when importing from Substack — every Substack publication has subscribers. Ask the owner about their subscriber list after content import is complete. See the import skill's newsletter step for the conversation flow.

## Common issues

- **No tags or categories**: Substack does not have a tagging system. Imported posts will have empty tags. Suggest the owner add tags after import.
- **Paywalled content**: Posts marked as subscriber-only will have truncated content in the RSS feed. The owner needs to temporarily make posts public, or provide the content through the data export.
- **Newsletter vs blog**: Substack content is primarily email newsletters published to the web. Some formatting is email-optimized (centered text, large fonts, CTA buttons) — strip email-specific elements.
- **No dates in slugs**: Substack URLs use `/p/slug` with no date component, making redirect mapping straightforward.
- **Podcast content**: Some Substack publications include podcast episodes. These appear in the RSS feed with `<enclosure>` audio attachments. Skip audio content — import text posts only.
- **Thread posts**: Substack has a "Notes" feature (like short posts). These are separate from regular posts and are not included in the RSS feed.
