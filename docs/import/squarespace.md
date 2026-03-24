# Importing from Squarespace

Squarespace sites are server-rendered HTML with content stored in Squarespace's proprietary database. The best extraction path is the built-in XML export, which uses WordPress's WXR format.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Squarespace.

## How it detects this platform

The import skill uses WebFetch on the homepage and checks for `squarespace` in script URLs, meta tags, or the `X-ServedBy` header.

## Extraction methods (in order of preference)

### 1. WXR XML export (best)

Squarespace can export content as a WordPress-compatible XML file.

**How the owner exports:**
1. Log in to the Squarespace dashboard
2. Go to Settings → Import & Export → Export
3. Choose "WordPress" format
4. Download the XML file

**What's included:** Blog posts with full text content, publish dates, categories, tags, and basic page content (text blocks).

**What's NOT included:** Product catalogs, gallery images, form configurations, custom CSS, code injection blocks, member areas, or complex layout blocks.

Parse the WXR XML the same way as a WordPress export:

| WXR field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` | `title` | Direct copy |
| `<content:encoded>` | body | Full HTML → convert to Markdown |
| `<wp:post_date>` | `publishDate` | YYYY-MM-DD HH:MM:SS → YYYY-MM-DD |
| `<wp:post_name>` | filename | Slug for `.mdoc` filename |
| `<wp:post_type>` | — | "post" or "page" — used to sort into lists |
| `<category domain="post_tag">` | `tags` | Tag names |
| `<category domain="category">` | `tags` | Category names (merge with tags) |

### 2. RSS feed

Squarespace blogs publish an RSS feed at `COLLECTION_URL?format=rss`. The collection URL is **not always `/blog`** — it depends on how the owner configured their site. Common patterns include `/blog`, `/news`, `/journal`, `/posts`, or any custom path. Discover the correct collection URL from the sitemap or homepage navigation links before requesting the RSS feed.

The feed contains up to 20 recent posts with full content. Some sites return fewer (as few as 10). Useful as a fallback or supplement to the WXR export.

### 3. WebFetch (fallback)

For pages not in the export or RSS feed, use WebFetch on each page URL. Squarespace pages are server-rendered HTML (not JS-dependent like Wix), so WebFetch extracts content reliably.

## Content conversion

Apply the standard HTML-to-Markdown conversion from [hosted-platforms.md](hosted-platforms.md), plus these Squarespace-specific adjustments:

- `<div class="sqs-block">` and `<div class="sqs-html-content">` wrappers → strip wrapper, keep inner content
- Squarespace-specific data attributes (`data-block-type`, `data-layout-label`) → strip
- Newsletter signup blocks → remove entirely
- Social media embed blocks → note as needing manual review

## Image handling

Squarespace images are served from `images.squarespace-cdn.com`. The URLs follow the pattern:

```
https://images.squarespace-cdn.com/content/v1/SITE_ID/ASSET_ID/image.jpg
```

### CDN URL normalization

Squarespace adds `?format=NNNw` parameters to control image width. Blog post body images often appear without a format parameter (full size), but **gallery and listing thumbnails** use small widths like `?format=100w` or `?format=300w`. Downloading these gives you a tiny thumbnail, not the original.

**Rules:**
- If the URL has no `?format=` parameter → use as-is (already full size)
- If the URL has `?format=NNNw` where NNN < 1200 → strip the parameter or replace with `?format=2500w`
- If the URL has `?format=originalw` or `?format=original` → use as-is

```
# Thumbnail (bad — only 100px wide)
https://images.squarespace-cdn.com/content/v1/SITE_ID/ASSET_ID/image.jpg?format=100w

# Full size (good)
https://images.squarespace-cdn.com/content/v1/SITE_ID/ASSET_ID/image.jpg?format=2500w

# Also full size (good — no param)
https://images.squarespace-cdn.com/content/v1/SITE_ID/ASSET_ID/image.jpg
```

Squarespace CDN URLs expire after cancellation — see the CDN expiration warning in [hosted-platforms.md](hosted-platforms.md).

## URL patterns for redirects

Squarespace blog post URLs depend on the collection URL and permalink format configured by the owner. Common patterns:

| Squarespace URL | Example | Notes |
| --- | --- | --- |
| `/blog/slug` | `/blog/my-great-post` | Default blog collection |
| `/news/YYYY/M/slug` | `/news/2026/3/my-great-post` | Date-based with custom collection |
| `/journal/slug` | `/journal/my-great-post` | Custom collection name |
| `/page-name` | `/about` | Static pages |
| `/gallery` | `/gallery` | Portfolio/gallery pages |

**Important:** Do not assume `/blog/slug`. Use the actual URLs from the RSS feed, WXR export, or sitemap to determine the pattern. Generate redirect rules from the real old paths.

| Old URL | New URL | Redirect |
| --- | --- | --- |
| `/blog/slug` | `/blog/slug` | None needed (same path) |
| `/news/YYYY/M/slug` | `/blog/slug` | 301 (path changed) |
| `/page-name` | `/page-name` | None needed if path matches |
| `/gallery` | `/gallery` or `/` | Depends on site structure |

## Content conversion extras

Beyond the standard conversions in [hosted-platforms.md](hosted-platforms.md), handle these Squarespace-specific patterns:

### Accordion blocks

Squarespace has a native accordion block (`sqs-block-accordion`). When scraping via WebFetch, accordion panels may be collapsed and their content hidden. Look for accordion structures and ensure all panel content is extracted — WebFetch the page and specifically ask for accordion/FAQ content. If content appears truncated, the page likely has collapsed accordions.

### Summary blocks (blog listing excerpts)

Squarespace "summary blocks" show excerpts of blog posts on other pages (e.g., a homepage blog feed). When extracting static page content, strip these — they're duplicates of the blog posts already being imported separately. Look for repeated post titles with truncated text and "Read More" links.

### Tags and categories

Squarespace WXR exports include tags via `<category domain="post_tag">` and categories via `<category domain="category">`. However, RSS feeds often omit categories entirely. When using RSS as the extraction source, check the post page for tags displayed in the footer or sidebar. Common patterns:

- `<a class="blog-tag" href="/blog/tag/TAG">TAG</a>`
- `<span class="blog-categories-list">` containing tag links
- Tags may appear under the post body, before the comments section

If no tags are found in either RSS or the page HTML, leave `tags: []`.

## Common issues

- **Gallery pages not in export**: Squarespace galleries contain images but the export only includes text content. Gallery images must be scraped from the live page before cancellation. Gallery thumbnails use `?format=100w` — replace with `?format=2500w` to get full-size images.
- **Blog collection URL varies**: The blog may not be at `/blog`. Check the sitemap or navigation for the actual collection URL before attempting RSS fetch. A 404 on `/blog?format=rss` usually means the collection has a different name.
- **Custom CSS lost**: Code injection and custom CSS are not exported. The owner should save these manually if they contain brand-specific overrides.
- **Form submissions lost**: Contact form data is not exported. The owner should export form submissions separately from Settings → Form Submissions.
- **E-commerce products not in WXR**: Products must be exported separately as CSV from Commerce → Inventory.
- **Member-only content**: Gated content behind Squarespace's member areas is not included in the public export.
- **Date-based URLs**: Some Squarespace blogs use `/collection/YYYY/M/slug` URLs. These always need 301 redirects to `/blog/slug` since Anglesite uses flat blog paths.
