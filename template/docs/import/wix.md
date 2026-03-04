# Importing from Wix

Wix has the most restrictive content export of any major platform. There is no content API, no full export feature, and pages are JavaScript-rendered (Wix Thunderbolt), making standard HTML scraping unreliable. The import skill uses a combination of sitemaps, RSS metadata, and WebFetch page-by-page extraction.

## How it detects this platform

The import skill uses WebFetch on the homepage and checks for `wix` or `Thunderbolt` in the page source, or `static.wixstatic.com` in asset URLs.

## Extraction methods

### Sitemap for content discovery

Wix generates a sitemap index at `/sitemap.xml` containing:
- `/blog-posts-sitemap.xml` — all blog post URLs with `<lastmod>` dates
- `/pages-sitemap.xml` — all static page URLs
- `/blog-categories-sitemap.xml` — category listing (usually just `/blog`)

The sitemap provides the complete list of URLs but no content.

### RSS feed for blog metadata

Wix publishes an RSS feed at `/blog-feed.xml` containing:

| RSS field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` | `title` | CDATA-wrapped |
| `<description>` | `description` | **Excerpt only** — truncated with `...` |
| `<pubDate>` | `publishDate` | RFC 822 → YYYY-MM-DD |
| `<enclosure url="...">` | `image` | Hero image URL from `static.wixstatic.com` |
| `<dc:creator>` | — | Author first name (informational) |
| `<link>` | `syndication` | Original Wix post URL |

The RSS feed does NOT contain full post content — only excerpts. It also has no categories or tags.

### WebFetch for full content (only option)

Each blog post and static page must be individually fetched via WebFetch. Because Wix pages are JavaScript-rendered, simple `curl` or HTML parsing won't work — the AI-powered WebFetch processes the rendered page and extracts structured content.

## Content conversion

WebFetch returns clean Markdown, so minimal conversion is needed. Watch for:
- Wix embed blocks (videos, maps, social feeds) — note for manual review
- Wix lightbox image links (`?lightbox=true` parameters) — strip the parameter
- Wix app content (Booking, Stores, Events) — cannot be imported, flag for replacement

## Image handling

Wix images are served from `static.wixstatic.com` with transform parameters embedded in the URL:

```
https://static.wixstatic.com/media/ASSET_ID~mv2.jpg/v1/fill/w_980,h_551,al_c,q_85/file.jpg
```

To download the original image, strip everything from `/v1/` onward and append `?w=1200` for a reasonable size:

```
https://static.wixstatic.com/media/ASSET_ID~mv2.jpg?w=1200
```

The `ASSET_ID~mv2` portion is the stable media identifier.

## URL patterns for redirects

Wix blog posts always use `/post/slug`:

| Wix URL | Anglesite URL | Redirect |
| --- | --- | --- |
| `/post/my-post-slug` | `/blog/my-post-slug` | `/post/my-post-slug /blog/my-post-slug 301` |
| `/page-name` | `/page-name` | Only if path changes |
| `/blog` | `/blog` | None needed |
| `/blog/` | `/blog` | `/blog/ /blog 301` |

## Common issues

- **Full content not available in any feed**: Unlike WordPress and Squarespace, Wix provides no way to get full post content without visiting each page. This makes imports slower (one WebFetch per post).
- **No categories or tags in RSS**: The RSS feed has no `<category>` elements. Tags must be extracted by WebFetch from the rendered post page.
- **Image transform parameters**: Failing to strip `/v1/fill/...` from Wix image URLs may result in cropped or low-quality downloads.
- **Multilingual content**: Some Wix sites have content in multiple languages (separate sitemaps like `/es_es-sitemap.xml`). Import the primary language first.
- **Wix app pages**: Pages powered by Wix Booking, Stores, or Events contain no static content — they're generated at runtime. Flag these for replacement with industry tools.
- **Rate limiting**: Wix may throttle rapid requests. If WebFetch fails on multiple consecutive pages, pause briefly between requests.
