# Importing from Squarespace

Squarespace sites are server-rendered HTML with content stored in Squarespace's proprietary database. The best extraction path is the built-in XML export, which uses WordPress's WXR format.

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

Squarespace blogs publish an RSS feed at `/blog?format=rss`. This contains the 20 most recent posts with content. Useful as a fallback or supplement to the WXR export.

### 3. WebFetch (fallback)

For pages not in the export or RSS feed, use WebFetch on each page URL. Squarespace pages are server-rendered HTML (not JS-dependent like Wix), so WebFetch extracts content reliably.

## Content conversion

Squarespace HTML is cleaner than WordPress but may contain:
- `<div class="sqs-block">` wrappers — strip
- `<div class="sqs-html-content">` — strip wrapper, keep inner content
- `<figure>` / `<figcaption>` — convert to Markdown image + caption text
- Squarespace-specific data attributes (`data-block-type`, `data-layout-label`) — strip
- Newsletter signup blocks — remove entirely
- Social media embed blocks — note as needing manual review

## Image handling

Squarespace images are served from `images.squarespace-cdn.com`. The URLs follow the pattern:

```
https://images.squarespace-cdn.com/content/v1/SITE_ID/ASSET_ID/image.jpg
```

Download the URL as-is — no transform parameter stripping needed (unlike Wix).

**Critical warning:** Squarespace CDN image URLs stop working after the owner cancels their Squarespace subscription. The import skill must:
1. Download ALL images during import
2. Verify no external image URLs remain after build (`grep` for `squarespace-cdn.com`)
3. Warn the owner before they cancel

## URL patterns for redirects

Squarespace blog posts use `/blog/slug`. Static pages use `/page-name`.

| Squarespace URL | Anglesite URL | Redirect |
| --- | --- | --- |
| `/blog/slug` | `/blog/slug` | None needed (same path) |
| `/page-name` | `/page-name` | None needed if path matches |
| `/gallery` | `/gallery` or `/` | Depends on site structure |

## Common issues

- **Gallery pages not in export**: Squarespace galleries contain images but the export only includes text content. Gallery images must be scraped from the live page before cancellation.
- **Custom CSS lost**: Code injection and custom CSS are not exported. The owner should save these manually if they contain brand-specific overrides.
- **Form submissions lost**: Contact form data is not exported. The owner should export form submissions separately from Settings → Form Submissions.
- **E-commerce products not in WXR**: Products must be exported separately as CSV from Commerce → Inventory.
- **Member-only content**: Gated content behind Squarespace's member areas is not included in the public export.
