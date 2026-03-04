# Importing from GoDaddy Website Builder

GoDaddy Website Builder (also known as GoDaddy Websites + Marketing) is a drag-and-drop website builder bundled with GoDaddy domain purchases. It has no content API, no RSS feed, and no structured export. WebFetch and sitemap scraping are the only extraction methods.

## How it detects this platform

Check for GoDaddy indicators:
- `godaddysites.com` in the domain (staging/preview URLs)
- `img1.wsimg.com` — GoDaddy's image CDN in `<img>` tags
- `secureservercdn.net` in script or stylesheet URLs
- `websites.godaddy.com` references in the page source
- `<meta name="generator" content="GoDaddy Website Builder">` (not always present)
- GoDaddy footer badge ("Built with GoDaddy Website Builder")
- `gdwb` or `wsgd` in script/CSS class names

For custom domains (common — most GoDaddy users register their domain through GoDaddy), use WebFetch on the homepage and check for these markers.

## Extraction methods

### Sitemap + WebFetch (only option)

```sh
curl -s SITE_URL/sitemap.xml
```

GoDaddy auto-generates a sitemap listing all published pages. Parse it to discover URLs.

GoDaddy sites are typically small (5–15 pages) and rarely have a blog. If the sitemap is missing, WebFetch the homepage and extract navigation links.

For each page URL, use WebFetch with the standard extraction prompt. GoDaddy pages are JavaScript-rendered — if WebFetch returns empty or incomplete content, the page may require browser rendering. In that case, tell the owner:

> "Some of your pages use features that are hard to read automatically.
> Could you copy and paste the text from those pages? I'll format it for
> the new site."

### Blog content (if present)

Some GoDaddy sites have a blog feature. Blog posts appear under `/blog/` or a custom path. Check the sitemap for blog-like URLs.

```sh
curl -s "SITE_URL/blog/feed"
```

GoDaddy's blog may offer an RSS feed, though it's not guaranteed. If no feed exists, scrape blog post URLs from the sitemap and use WebFetch on each.

## Frontmatter mapping

| GoDaddy field | Anglesite field | Notes |
| --- | --- | --- |
| Page `<title>` or `<h1>` | `title` | Extract from WebFetch |
| `<meta name="description">` | `description` | Usually present on GoDaddy sites |
| Publication date (if blog) | `publishDate` | May not be available — use current date as fallback |
| — | `tags` | GoDaddy blogs have no tagging — use `[]` |
| Hero image | `image` | Download from `img1.wsimg.com` |
| Page URL | `syndication` | Original GoDaddy URL |

## Content conversion

GoDaddy content arrives as HTML from WebFetch. Convert to Markdown:

**Elements to handle:**
- GoDaddy section wrappers (`<section>`, nested `<div>` containers) → flatten and extract content
- Image galleries → extract individual images
- Button elements → convert to links or strip
- Text blocks with inline styles → strip styles, keep text
- `<h1>` through `<h6>` → map to Markdown headings (GoDaddy often uses `<h2>` for section titles)

**Elements to strip:**
- GoDaddy navigation and footer
- Social media icon bars
- "Built with GoDaddy" badge
- Map embeds (Google Maps iframe)
- Contact forms (GoDaddy's built-in form builder)
- Appointment booking widgets (GoDaddy Appointments)
- Online store elements (GoDaddy Payments / Square integration)
- Chat widgets
- Pop-up/banner overlays
- Analytics and tracking scripts

## Image handling

GoDaddy images are hosted on:
- `img1.wsimg.com` — primary image CDN
- `secureservercdn.net` — alternate CDN

Image URLs include size parameters. To get larger versions:
- Look for `rs:fill:NNNN:NNNN` or similar resize parameters in the URL
- Remove or increase the size values
- If no resize parameters, use the URL as-is

Download each image to `public/images/blog/` or `public/images/pages/`. GoDaddy CDN URLs are tied to the account and will stop working after the site is deleted.

## URL patterns for redirects

GoDaddy page URLs are simple:
- `https://example.com/page-name`
- `https://example.com/blog/post-title` (if blog exists)

```
/page-name /page-name 200
/blog/post-title /blog/post-title 200
```

Most GoDaddy sites have simple path structures. If old and new paths match, use `200` (passthrough).

## Common issues

- **No export capability**: GoDaddy has no content export, no API, and often no RSS feed. WebFetch is the only extraction method. This makes it the second-hardest platform to import from (after Wix).
- **JavaScript rendering**: Some GoDaddy pages rely heavily on client-side JavaScript. If WebFetch returns incomplete content, the owner may need to copy-paste text manually.
- **Very small sites**: Most GoDaddy sites have fewer than 10 pages. The import is fast but the content is often sparse — the new site may need more content.
- **Image CDN expiration**: GoDaddy CDN URLs stop working when the account is closed. Download all images during import.
- **GoDaddy Appointments**: Many GoDaddy business sites use the built-in appointment scheduling. This can't be imported — recommend Cal.com or Calendly as a replacement.
- **GoDaddy Online Store**: Some sites use GoDaddy's e-commerce features. These require runtime infrastructure — recommend Shopify or Square as replacements.
- **SEO data**: GoDaddy sites often have good `<meta>` tags (GoDaddy's builder prompts users to add them). Preserve these as page descriptions.
- **Contact information**: GoDaddy business sites prominently display phone, email, and address. Extract these for the owner's new site but verify they want them publicly displayed.
