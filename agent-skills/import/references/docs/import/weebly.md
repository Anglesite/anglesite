# Importing from Weebly

Weebly is a drag-and-drop website builder (now owned by Square). It has limited export capabilities — there is no content API and no structured export format. The RSS feed and WebFetch are the primary extraction methods.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Weebly.

## How it detects this platform

Check for Weebly indicators:
- `weebly.com` in the domain (e.g., `sitename.weebly.com`)
- `<meta name="generator" content="Weebly">` in the page source
- `cdnjs.weebly.com` in script URLs
- "Powered by Weebly" in the footer

For custom domains, use WebFetch on the homepage and check for these markers.

## Extraction methods

### RSS feed (blog only)

```sh
curl -s "SITE_URL/blog/feed/"
```

The RSS feed contains blog posts with:
- `<title>` — post title
- `<description>` or `<content:encoded>` — post content (may be excerpt or full HTML)
- `<link>` — post URL
- `<pubDate>` — publication date

The feed may contain only excerpts. If content appears truncated, use WebFetch on each post URL for full content.

### WebFetch (all content)

For blog posts not fully captured by the RSS feed, and for static pages, use WebFetch on each URL:

1. First, discover all pages from the site's navigation. WebFetch the homepage and extract all internal links.
2. Also check the sitemap:

```sh
curl -s SITE_URL/sitemap.xml
```

3. For each blog post or page URL, use WebFetch with the standard extraction prompt.

### Site archive (if owner has account access)

The owner can download a site archive from the Weebly editor: General settings → Archive section → "Download recent export." This produces a ZIP file with HTML files, but the format is not well documented and may be incomplete.

## Frontmatter mapping

| Weebly field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` or WebFetch title | `title` | Direct copy |
| First paragraph | `description` | Generate from content — Weebly has no excerpt field |
| `<pubDate>` or WebFetch date | `publishDate` | Convert to YYYY-MM-DD |
| — | `tags` | Weebly blogs have limited categorization — typically `[]` |
| First image in content | `image` | Download from Weebly hosting |
| Post/page URL | `syndication` | Original Weebly URL |

## Content conversion

Apply the standard HTML-to-Markdown conversion from [hosted-platforms.md](hosted-platforms.md), plus these Weebly-specific adjustments:

- `<div class="wsite-section-wrap">` and `<div class="wsite-section-elements">` → strip wrappers, keep content
- `<div class="paragraph">` — Weebly paragraph wrappers → unwrap
- `<div class="wsite-image">` wrapping `<img>` → extract image
- `<div class="wsite-button">` — CTA buttons → convert to link or strip
- `<div class="wsite-form">` — forms require Weebly's runtime → strip
- E-commerce elements (Weebly/Square store features) → strip

## Image handling

Weebly images may be hosted at:
- `uploads/` paths on the Weebly domain
- `files/theme/` paths
- Third-party CDN URLs

Extract image URLs from `<img>` tags in the content. Download each to `public/images/blog/`.

Weebly image URLs are tied to the account — they will stop working if the site is deleted or the account is cancelled. Download all images during import.

## URL patterns for redirects

Weebly blog URLs:
- `https://sitename.weebly.com/blog/post-slug` (current format)
- `https://sitename.weebly.com/blog/post-slug.html` (older format)

Weebly page URLs:
- `https://sitename.weebly.com/page-name.html`

```
/blog/slug /blog/slug 200
/blog/slug.html /blog/slug 301
/page-name.html /page-name 301
```

## Common issues

- **Very limited export**: Weebly has the worst export capabilities of any major platform. The RSS feed may be incomplete, and there's no content API. WebFetch per page is often the only reliable method.
- **Image expiration**: Images are hosted on Weebly's infrastructure and will become unavailable after the site is deleted. Download all images during import.
- **Drag-and-drop layout loss**: Weebly's visual layouts (columns, spacers, dividers) don't translate to Markdown. Content will be linearized.
- **Forms and interactive elements**: Weebly forms, maps, and interactive widgets cannot be imported. Note these for the owner.
- **Square integration**: Newer Weebly sites may use Square's e-commerce features. These are runtime-dependent and cannot be imported.
- **Custom domains**: Weebly custom domain sites can't be identified from the URL alone. Check the page source for Weebly markers.
