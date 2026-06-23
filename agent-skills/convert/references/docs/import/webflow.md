# Importing from Webflow

Webflow is a visual website builder popular with small businesses and agencies. It offers a CMS with structured content, a REST API for content retrieval, and a built-in export feature for static sites on paid plans.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Webflow.

## How it detects this platform

Check for Webflow indicators:
- `webflow.io` in the domain (e.g., `sitename.webflow.io`)
- `<meta name="generator" content="Webflow">` in the page source
- `assets.website-files.com` or `assets-global.website-files.com` in script/stylesheet URLs
- `data-wf-site` or `data-wf-page` attributes on the `<html>` or `<body>` tag
- `cdn.prod.website-files.com` for image assets

For custom domains, use WebFetch on the homepage and check for these markers.

## Extraction methods

### Sitemap + WebFetch (most reliable for all plans)

```sh
curl -s SITE_URL/sitemap.xml
```

Webflow auto-generates a sitemap. Parse it to discover all pages and CMS collection items (blog posts, portfolio entries, etc.).

Blog posts typically live under a `/blog/` or `/post/` prefix. CMS collection pages may use other prefixes depending on how the site was built.

For each post URL, use WebFetch with the standard blog post extraction prompt.

### RSS feed (if CMS blog is configured)

```sh
curl -s "SITE_URL/blog/rss.xml"
```

Some Webflow sites have RSS enabled. The feed path depends on how the collection was configured — try `/blog/rss.xml`, `/rss.xml`, or `/feed`. The RSS feed contains `<content:encoded>` with full HTML content.

### Webflow CMS API (if owner has API access)

The owner needs a Webflow API token from Site Settings → Integrations → API Access.

```sh
curl -s -H "Authorization: Bearer API_TOKEN" "https://api.webflow.com/v2/sites"
```

Get the site ID from the response, then list collections:
```sh
curl -s -H "Authorization: Bearer API_TOKEN" "https://api.webflow.com/v2/sites/SITE_ID/collections"
```

Find the blog collection ID, then fetch items:
```sh
curl -s -H "Authorization: Bearer API_TOKEN" "https://api.webflow.com/v2/collections/COLLECTION_ID/items?limit=100"
```

Paginate with `offset` parameter. Each item contains CMS fields as defined by the collection schema.

Tell the owner:
> "If you have access to the Webflow dashboard, I can use the API to get a
> more complete copy of your content. Go to Site Settings → Integrations →
> API Access and create a token. Otherwise, I can read the pages directly."

## Frontmatter mapping

| Webflow field | Anglesite field | Notes |
| --- | --- | --- |
| `name` (CMS item) or `<title>` | `title` | Direct copy |
| `post-summary` or first paragraph | `description` | CMS field name may vary — check collection schema |
| `published-on` or `<pubDate>` | `publishDate` | Convert to YYYY-MM-DD |
| `main-image` or first image | `image` | Download from Webflow CDN |
| `category` or `tag` references | `tags` | CMS reference fields — resolve to names |
| Post URL | `syndication` | Original Webflow URL |

CMS field names are project-specific. The API response includes the collection schema with field names and types.

## Content conversion

Apply the standard HTML-to-Markdown conversion from [hosted-platforms.md](hosted-platforms.md), plus these Webflow-specific adjustments:

- `<div class="w-richtext">` — Webflow's rich text wrapper → strip wrapper, keep inner content
- `<div class="w-embed">` — custom embed blocks → strip (these contain arbitrary HTML/JS)
- `<a>` with `w-inline-block` class — Webflow's styled link blocks → extract as plain link
- Nested `<div>` structures — Webflow generates deeply nested divs for layout → flatten aggressively
- `<img>` with `srcset` — use the largest image from the srcset or the `src` attribute
- Webflow interaction/animation attributes (`data-w-id`, `data-animation-type`) → strip
- `<div class="w-form">`, `<div class="w-lightbox">`, `<div class="w-video">` → strip (extract images from lightbox)

## Image handling

Webflow images are hosted on:
- `assets.website-files.com` (newer)
- `assets-global.website-files.com` (newer, global CDN)
- `cdn.prod.website-files.com` (current)
- `uploads-ssl.webflow.com` (legacy)

Image URLs may include auto-generated transform parameters. To get the original:
- Strip any query parameters (`?w=800`, etc.)
- The base URL is the full-resolution image

Download each image to `public/images/blog/`. Webflow CDN URLs may stop working after the site is deleted or the plan expires.

## URL patterns for redirects

Webflow blog URLs:
- `https://sitename.webflow.io/blog/post-slug` (staging)
- `https://example.com/blog/post-slug` (custom domain)
- `https://example.com/post/post-slug` (alternate collection slug)

```
/blog/slug /blog/slug 200
/post/slug /blog/slug 301
```

Webflow page URLs:
- `https://example.com/page-slug`

The URL structure depends on how the designer configured the CMS collection URLs. Check the sitemap to determine the actual pattern.

## Common issues

- **Deeply nested HTML**: Webflow's visual builder generates complex div structures for layout. The HTML-to-Markdown conversion needs to aggressively flatten and extract readable content.
- **CMS field names vary**: Unlike WordPress or Ghost, Webflow CMS field names are defined per project. The "blog post" collection may use `post-body`, `content`, `body`, or any custom name for the main content field.
- **Interactions and animations**: Webflow sites often use animations that rely on Webflow's JS runtime. These are stripped during import.
- **Custom code blocks**: `w-embed` blocks can contain arbitrary HTML, CSS, and JS. Strip these and note them for the owner to review.
- **Image CDN expiration**: Webflow CDN URLs are tied to the account. Download all images during import — they may stop working after the Webflow plan expires.
- **Ecommerce content**: Webflow Ecommerce products are CMS items but require Webflow's runtime for cart/checkout. Import product descriptions as pages but note that e-commerce functionality needs a replacement (Shopify, Square).
- **API rate limits**: The Webflow API has rate limits (60 requests/minute on most plans). Add brief pauses between API calls if importing large sites.
