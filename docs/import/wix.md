# Importing from Wix

Wix has the most restrictive content export of any major platform. There is no content API, no full export feature, and pages are JavaScript-rendered (Wix Thunderbolt), making standard HTML scraping unreliable. The import skill uses a combination of sitemaps, RSS metadata, and WebFetch page-by-page extraction.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Wix.

## How it detects this platform

The import skill uses WebFetch on the homepage and checks for `wix` or `Thunderbolt` in the page source, or `static.wixstatic.com` in asset URLs.

## Extraction methods

### Sitemap for content discovery

Wix generates a sitemap index at `/sitemap.xml` containing child sitemaps:
- `/blog-posts-sitemap.xml` — all blog post URLs with `<lastmod>` dates
- `/pages-sitemap.xml` — all static page URLs
- `/blog-categories-sitemap.xml` — category listing (usually just `/blog`)
- `/store-products-sitemap.xml` — product pages (if Wix Stores is installed)
- Other app-specific sitemaps may also appear

**Always parse the sitemap index** to discover all child sitemaps rather than
hardcoding the names above — Wix may add or rename them.

The sitemap provides the complete list of URLs but no content.

**Known issue — incomplete sitemaps:** Wix dynamic pages (those powered by
collections/databases) may not appear in the sitemap at all. This is a
long-standing Wix bug. To catch missing pages, also extract navigation links
from the homepage via WebFetch and cross-reference with the sitemap. Any nav
link not found in the sitemap should be added to STATIC_PAGES.

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

**Limitations to know:**
- The feed typically returns only the **last 2–3 weeks** of posts, not the full
  archive. The blog posts sitemap is the authoritative source for the complete
  post list.
- Wix may **disable full-text RSS** if the feed is called too frequently,
  reverting to links only. If the feed returns no `<description>` content,
  proceed with WebFetch extraction — don't retry the feed repeatedly.
- The feed never contains static pages — those always require WebFetch.

### WebFetch for full content (only option)

Each blog post and static page must be individually fetched via WebFetch. Because Wix pages are JavaScript-rendered (Wix Thunderbolt / React), simple `curl` or HTML parsing won't work — the rendered HTML contains an empty `<div id="SITE_CONTAINER"></div>` until JavaScript executes. The AI-powered WebFetch processes the rendered page and extracts structured content.

### Extracting metadata from WebFetch

When WebFetching each page, also extract:
- **Meta description** (`<meta name="description">`): Wix generates per-page
  meta descriptions. Use this as the Anglesite `description` field — it's
  typically better than generating one from content.
- **OG tags** (`og:title`, `og:description`, `og:image`): Wix sets these via
  its Social Share settings. The `og:image` can serve as a fallback hero image
  if the RSS `<enclosure>` is missing.
- **Structured data (JSON-LD)**: Wix generates schema.org markup for blog posts
  (`BlogPosting`), local business pages, and products. Extract `datePublished`,
  `author.name`, `description`, and `image` from the JSON-LD — these are often
  more accurate than RSS fields.

Include these in the WebFetch prompt for blog posts:
> "Also extract from the page metadata:
> 6. The meta description (from the meta tag, not generated)
> 7. The og:image URL (if different from inline images)
> 8. Any JSON-LD structured data — especially datePublished and author name"

## Content conversion

WebFetch returns clean Markdown, so minimal conversion is needed. Watch for:
- Wix embed blocks (videos, maps, social feeds) — note for manual review
- Wix lightbox image links (`?lightbox=true` parameters) — strip the parameter
- Wix app content (Booking, Stores, Events) — cannot be imported, flag for replacement

## Image handling

Wix images are served from `static.wixstatic.com` with transform parameters embedded in the URL:

```
https://static.wixstatic.com/media/ASSET_ID~mv2.jpg/v1/fill/w_980,h_551,al_c,q_85,usm_0.66_1.00_0.01/file.webp
```

The transform parameters (`/v1/fill/...`) control:
- `w_` / `h_` — width and height
- `al_c` — alignment (center)
- `q_85` — JPEG quality (0–100)
- `usm_` — unsharp mask (sharpening)
- `fill` — resize mode (also `fit`, `crop`)

Wix may also auto-convert to WebP in the URL, even if the original is JPEG.

**To download a web-optimized image**, strip everything from `/v1/` onward and
append `?w=1200`:

```
https://static.wixstatic.com/media/ASSET_ID~mv2.jpg?w=1200
```

**To download the true original** (no transforms, no resize), use the base
media URL with no parameters:

```
https://static.wixstatic.com/media/ASSET_ID~mv2.jpg
```

Use `?w=1200` by default for hero images (keeps file sizes reasonable). Use the
bare URL only if the owner specifically wants originals or if the `?w=1200`
version appears too small.

The `ASSET_ID~mv2` portion is the stable media identifier. **Original filenames
are not preserved** — Wix replaces them with asset IDs, so downloaded images
will have opaque names like `7986bd_f56edc6b839c4e3cb8caa6b922bb612a~mv2.jpg`.
Rename to `SLUG-hero.webp` (or `SLUG-body-N.webp`) per the standard naming
convention.

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
- **Image transform parameters**: Failing to strip `/v1/fill/...` from Wix image URLs may result in cropped, sharpened, or low-quality downloads. Also watch for Wix auto-converting to WebP in the URL path.
- **Multilingual content**: Some Wix sites have content in multiple languages (separate sitemaps like `/es_es-sitemap.xml`). Import the primary language first.
- **Wix app pages**: Pages powered by Wix Booking, Stores, or Events contain no static content — they're generated at runtime. Flag these for replacement with industry tools.
- **Rate limiting**: Wix may throttle rapid requests. If WebFetch fails on multiple consecutive pages, pause briefly between requests.
- **Dynamic pages missing from sitemap**: Pages powered by Wix collections/databases may not appear in the sitemap at all. Always cross-reference with homepage navigation links.
- **RSS feed may degrade**: Wix has been known to disable full-text RSS or revert to links-only if the feed is called too frequently. Don't retry the feed — fall back to WebFetch.
- **Higher SEO risk than other migrations**: Wix URL structures differ significantly from most platforms (`/post/slug` for blog, flat paths for pages). Comprehensive redirect mapping is critical. Expect a 10–20% traffic dip in the first 4–6 weeks even with perfect redirects — warn the owner about this.
