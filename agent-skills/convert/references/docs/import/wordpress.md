# Importing from WordPress

WordPress powers ~43% of the web. It has the best content extraction options of any platform — a REST API, WXR XML export, and RSS feeds with full content.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to WordPress.

## How it detects this platform

The import skill checks if `SITE_URL/wp-json/` returns HTTP 200. If it does, this is a WordPress site with an active REST API.

## Extraction methods (in order of preference)

### 1. REST API (best)

WordPress exposes a public JSON API at `/wp-json/wp/v2/`. No authentication needed for published content.

**Endpoints:**

| Endpoint | Returns |
| --- | --- |
| `/wp-json/wp/v2/posts?per_page=100&page=N` | Blog posts (paginated) |
| `/wp-json/wp/v2/pages?per_page=100&page=N` | Static pages (paginated) |
| `/wp-json/wp/v2/categories?per_page=100` | Category taxonomy |
| `/wp-json/wp/v2/tags?per_page=100` | Tag taxonomy |
| `/wp-json/wp/v2/media/ID` | Single media item (image URL) |

**Post JSON fields:**

| WordPress field | Anglesite field | Notes |
| --- | --- | --- |
| `title.rendered` | `title` | HTML entities may need decoding |
| `excerpt.rendered` | `description` | Strip HTML tags, truncate to 1–2 sentences |
| `date` | `publishDate` | ISO 8601 → YYYY-MM-DD |
| `slug` | filename | Used as `.mdoc` filename |
| `content.rendered` | body | Full HTML → convert to Markdown |
| `featured_media` | `image` | Media ID → fetch `/wp-json/wp/v2/media/ID` for `source_url` |
| `categories` | `tags` | Array of IDs → look up names from categories endpoint |
| `tags` | `tags` | Array of IDs → look up names from tags endpoint |
| `link` | `syndication` | The original WordPress URL |

Paginate by incrementing `&page=N` until the response is empty or returns 400.

### 2. WXR XML export

If the owner has admin access, they can export from wp-admin → Tools → Export. This produces a WXR (WordPress eXtended RSS) XML file containing all posts, pages, comments, and taxonomy terms.

Parse `<item>` elements. Key fields: `<title>`, `<content:encoded>` (full HTML), `<wp:post_date>`, `<wp:post_name>` (slug), `<wp:post_type>` (post or page), `<category domain="post_tag">`, `<category domain="category">`.

### 3. RSS feed (fallback)

The feed at `/feed/` usually contains full post content in `<content:encoded>`. Limited to the most recent 10–20 posts by default.

## Content conversion

WordPress content is rendered HTML. Apply the standard HTML-to-Markdown conversion from [hosted-platforms.md](hosted-platforms.md), plus these WordPress-specific adjustments:

- Strip WordPress block comments (`<!-- wp:paragraph -->`, `<!-- /wp:paragraph -->`)
- Strip class attributes with `wp-block-*` prefixes
- Strip shortcodes like `[gallery]`, `[caption]`, `[embed]` — extract the content if possible

## Image handling

WordPress images live at `/wp-content/uploads/YYYY/MM/filename.ext`. The URLs are stable and predictable. Download as-is — no URL manipulation needed.

The featured image requires a second API call: fetch `/wp-json/wp/v2/media/FEATURED_MEDIA_ID` and use the `source_url` field.

## URL patterns for redirects

WordPress has multiple permalink structures. Use the `link` field from the API to determine the actual URLs:

| Permalink setting | Example URL |
| --- | --- |
| Day and name | `/2024/03/15/my-post/` |
| Month and name | `/2024/03/my-post/` |
| Post name | `/my-post/` |
| Numeric | `/?p=123` |

Generate redirects based on the actual URL paths, not assumptions.

## Common issues

- **REST API disabled**: Some security plugins or hosts disable the REST API. If `/wp-json/` returns 403/401, fall back to RSS feed + WebFetch.
- **Password-protected posts**: These won't appear in the public API response. The owner may need to remove protection before import.
- **Custom post types**: Portfolios, testimonials, products, etc. may be at `/wp-json/wp/v2/TYPE_NAME`. Probe for common types and ask the owner.
- **Multisite installs**: The API path may be `/subsite/wp-json/wp/v2/posts`. Check the site URL carefully.
- **HTML entities in titles**: `title.rendered` may contain `&#8217;` for apostrophes, `&amp;` for ampersands. Decode these.
- **Gutenberg block markup**: Modern WordPress posts contain block comments (`<!-- wp:heading -->`) that must be stripped. The `content.rendered` field has them already rendered to HTML, but fragments sometimes leak through.
