# Importing from Shopify

Shopify is an e-commerce platform with built-in blogging. Blog content is secondary to the store, but many Shopify sites have substantial blog sections. The Atom feed is the easiest extraction method.

## How it detects this platform

Check for Shopify indicators:
- `cdn.shopify.com` in image or script URLs
- `/collections/` or `/products/` URL paths
- Use WebFetch on the homepage and check for `Shopify` in the source (Shopify JavaScript globals, `shopify-section` classes, or `cdn.shopify.com` asset URLs)

## Extraction methods

### Atom feed (best — no auth required)

Every Shopify blog has an Atom feed:

```sh
curl -s "SITE_URL/blogs/news.atom"
```

The default blog handle is `news`. Other common handles: `blog`, `journal`, `articles`. If the feed returns a 404, try variations or use WebFetch to find the blog URL.

To discover blog handles, check the site's navigation or:

```sh
curl -s SITE_URL/sitemap.xml
```

The sitemap often lists blog URLs under `blogs/HANDLE/`.

The Atom feed contains:
- `<title>` — article title
- `<content type="html">` — full HTML content
- `<published>` — ISO 8601 timestamp
- `<link href="...">` — article URL
- `<author><name>` — author name
- `<summary>` — excerpt
- `<category term="tag">` — tags (multiple elements)

### Admin API (requires store access)

If the owner can provide API access:

```sh
curl -s "SITE_URL/admin/api/2024-01/blogs.json" -H "X-Shopify-Access-Token: TOKEN"
```

Then for each blog:
```sh
curl -s "SITE_URL/admin/api/2024-01/blogs/BLOG_ID/articles.json?limit=250" -H "X-Shopify-Access-Token: TOKEN"
```

The Admin API returns JSON with more metadata than the Atom feed, including `summary_html`, `image` (featured image object), and `metafields`.

The Atom feed approach is preferred — it requires no authentication.

## Frontmatter mapping

| Shopify field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` | `title` | Direct copy |
| `<summary>` or first paragraph | `description` | Prefer summary; generate from content if missing |
| `<published>` | `publishDate` | Convert from ISO 8601 to YYYY-MM-DD |
| `<category term="...">` | `tags` | Shopify tags from the article |
| First image in content | `image` | Download from Shopify CDN |
| Article URL | `syndication` | Original Shopify URL |

## Content conversion

Shopify blog content is HTML from a rich text editor. Convert to Markdown:

**Elements to handle:**
- Product embeds and "Buy" buttons → strip (these depend on Shopify's runtime)
- `<img>` with Shopify CDN URLs → download and replace
- Internal links to `/products/...` or `/collections/...` → keep URL, note for review
- `<table>` — sometimes used for product comparison → keep as Markdown table if simple

**Elements to strip:**
- Product widgets and add-to-cart buttons
- Shopify section wrappers (`<div class="shopify-section">`)
- JavaScript-dependent content

## Image handling

Shopify images are served from Shopify's CDN:
- `cdn.shopify.com/s/files/1/SHOP_ID/...` — primary format
- `STORE_DOMAIN/cdn/shop/...` — newer format (auto-redirects)

Image URLs may include size suffixes (e.g., `_800x.jpg`, `_1024x1024.jpg`). To get the original size, remove the size suffix before the extension.

Download to `public/images/blog/`. Shopify CDN URLs remain stable as long as the store exists.

## URL patterns for redirects

Shopify blog URLs always include `/blogs/`:
- `https://store.com/blogs/news/article-slug`
- `https://store.com/blogs/blog/my-post`

```
/blogs/news/slug /blog/slug 301
/blogs/blog/slug /blog/slug 301
```

The `/blogs/` prefix is hardcoded in Shopify and cannot be changed.

## Common issues

- **Blog is secondary to store**: Shopify sites are primarily e-commerce. The blog may have few posts. Ask the owner if they want to import the blog content.
- **Product references in posts**: Blog posts often reference products with embedded buy buttons or product cards. These won't work after import — strip them and note for the owner.
- **Multiple blogs**: Shopify stores can have multiple blogs (e.g., "News" and "Recipes"). Check each blog's Atom feed.
- **No blog at all**: Many Shopify stores don't use the blog feature. If no `/blogs/` URLs exist in the sitemap, skip blog import.
- **Store migration**: This guide covers blog content only. Product catalogs, customer data, and store features are not importable. If the owner is leaving Shopify entirely, they need a separate e-commerce solution for products.
