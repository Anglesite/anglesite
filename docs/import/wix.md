# Importing from Wix

Wix has the most restrictive content export of any major platform. There is no content API, no full export feature, and pages are JavaScript-rendered (Wix Thunderbolt). The import skill uses a combination of sitemaps, RSS metadata, and two extraction backends: **Playwright** (preferred — extracts content + design tokens in one pass) and **curl + regex** (fallback — content only).

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
- The feed is **hard-limited to 20 posts** (confirmed by Wix support). For
  blogs with larger archives, the blog posts sitemap is the authoritative
  source for the complete post list.
- Wix may **disable full-text RSS** if the feed is called too frequently,
  reverting to links only. If the feed returns no `<description>` content,
  proceed with WebFetch extraction — don't retry the feed repeatedly.
- The feed never contains static pages — those always require WebFetch.

### Wix Blog REST API (if owner has API access)

If the owner has a Wix API key (from the Wix Developers dashboard), the Blog
REST API can extract all posts with pagination — bypassing the 20-post RSS limit:

```sh
curl -s -H "Authorization: API_KEY" \
  "https://www.wixapis.com/blog/v3/posts?fieldsToInclude=CONTENT&paging.limit=100"
```

**Critical:** You must include `fieldsToInclude=CONTENT` — without it, the API
returns only metadata (title, slug, dates) and a `contentId` placeholder instead
of actual post content. Paginate with `paging.offset`.

This is faster and more reliable than WebFetch for blog posts, but it requires
the owner to create an API key. Don't ask for it unless the site has more than
20 blog posts (where RSS falls short). The API does **not** cover static pages —
those still require WebFetch.

### Playwright extraction (preferred — content + styling)

When Playwright is available, a single browser session extracts both content
and computed CSS styles from the rendered page. This is the preferred method
because it:
- Gets complete content via TreeWalker on the rendered DOM (not regex)
- Extracts computed colors, fonts, and spacing via `getComputedStyle()`
- Captures all JS-rendered navigation links (including dynamic sub-navs)
- Handles Wix accordions and FAQ content that curl+regex misses

**Location:** `${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-playwright.js`

**Workflow:**

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-playwright.js "PAGE_URL"
```

The script outputs JSON with both `tokens` and `content`:

```json
{
  "tokens": {
    "--color-bg": "#f3f3f3",
    "--color-text": "#4a4a4a",
    "--color-primary": "#116dff",
    "--color-accent": "#156600",
    "--color-muted": "#6b6b6b",
    "--font-heading": "\"Open Sans\"",
    "--font-body": "\"Open Sans\""
  },
  "content": {
    "body": "Markdown-formatted content...",
    "images": [{"src": "...", "alt": "..."}],
    "title": "Page Title",
    "navLinks": [{"text": "About", "href": "https://..."}]
  }
}
```

Use `--content-only` to skip style extraction, or `--styles-only` to skip
content. Extract styles from the **homepage only** — they apply site-wide.

**Dependency:** Playwright requires a browser binary (~150 MB on first install).
Offer to install it:
> "I can extract your site's colors and fonts automatically, but I need to
> install a browser tool first (~150 MB). Want me to?"

If they say yes: `npx playwright install chromium`

**Color classification logic:** The script samples `getComputedStyle()` from
visible elements and classifies colors by saturation:
- Saturation < 0.15 → gray (text/muted candidates)
- Saturation ≥ 0.15 → brand (primary/accent candidates)
- Browser defaults (`#0000ee`, `#551a8b`, `#000000`, `#ffffff`) are excluded

The extracted tokens map directly to `src/styles/global.css` custom properties.

### curl + regex extraction (fallback — content only)

When Playwright is not available, fall back to `curl` + the regex-based
extraction scripts. These parse Wix's SSR'd HTML — content is buried in
deeply nested `<span>` tags inside `data-hook="rcv-block*"` elements.

**Location:** `${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-extract.js`

**Workflow for each post or page:**

```sh
curl -sL "PAGE_URL" > /tmp/page.html
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-extract.js post /tmp/page.html
```

The script outputs JSON to stdout:

```json
{
  "body": "Markdown-formatted post body with ## headings...",
  "images": [{"src": "https://static.wixstatic.com/media/...", "alt": "..."}]
}
```

**Available subcommands:**

| Command | Input | Output |
| --- | --- | --- |
| `post <file>` | Downloaded blog post HTML | `{body, images}` — body text between `data-hook="post-description"` and `data-hook="post-footer"`, with headings converted to `##` |
| `page <file>` | Downloaded static page HTML | `{body, images}` — full page text with nav, footer, and duplicates removed |
| `meta <file>` | Any downloaded HTML | `{title, date, description, author, image}` — from JSON-LD (`BlogPosting`) with OG tag fallback |
| `image <url>` | Wix CDN URL string | Normalized URL with transforms stripped and `?w=1200` appended |

**How the post extractor works:**
- Isolates the region between `data-hook="post-description"` and `data-hook="post-footer"` — these are stable Wix conventions
- Extracts text from nested `<span>` tags within `data-hook="rcv-block*"` elements
- Detects headings by font-size (24px+) and font-weight (bold)
- Filters out empty spans, `\xa0` placeholders, and sub-3-char fragments
- Extracts inline `<img>` elements with src and alt attributes

**How the page extractor works:**
- Strips `<script>`, `<style>`, `<nav>`, and `<footer>` blocks
- Extracts span text from remaining `<div>` elements
- Filters navigation items (Home, Blog, About, Contact, More) and footer boilerplate (copyright, "Paid for by...")
- Deduplicates text (Wix often renders the same string multiple times in nested spans)

### WebFetch (fallback only)

WebFetch should only be used as a fallback when the extraction scripts return
empty content (e.g., if Wix changes their HTML structure). In practice, WebFetch
returns nothing useful for most Wix pages because the AI summarizer sees only
minified JS and an empty `SITE_CONTAINER` div.

## Content conversion

The extraction scripts return Markdown-ready text with `##` headings. Watch for:
- Wix embed blocks (videos, maps, social feeds) — note for manual review
- Wix lightbox image links (`?lightbox=true` parameters) — strip the parameter
- Wix app content (Booking, Stores, Events) — cannot be imported, flag for replacement

## Image handling

Wix images are served from `static.wixstatic.com` with transform parameters embedded in the URL:

```
https://static.wixstatic.com/media/ASSET_ID~mv2.jpg/v1/fill/w_980,h_551,al_c,q_85,usm_0.66_1.00_0.01/file.webp
```

The transform parameters (`/v1/{operation}/...`) control:
- `fill` — scale + crop to exact dimensions (may clip edges)
- `fit` — scale to fit within dimensions (preserves aspect ratio)
- `crop` — crop by pixel coordinates (`x`, `y`, `w`, `h`)
- `w_` / `h_` — width and height in pixels
- `al_c` — alignment (center)
- `q_85` — JPEG quality (0–100)
- `usm_` — unsharp mask (sharpening)

Wix may auto-convert to WebP in the URL, even if the original is JPEG. You can
also force a format by changing the output filename extension (`.webp`, `.png`,
`.jpg`) in the URL path.

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

- **Full content not available in any feed**: Unlike WordPress and Squarespace, Wix provides no way to get full post content without visiting each page. Use the bundled extraction scripts with `curl` — they are faster and more reliable than WebFetch for Wix.
- **No categories or tags in RSS**: The RSS feed has no `<category>` elements. Tags must be extracted by WebFetch from the rendered post page.
- **Image transform parameters**: Failing to strip `/v1/fill/...` from Wix image URLs may result in cropped, sharpened, or low-quality downloads. Also watch for Wix auto-converting to WebP in the URL path.
- **Multilingual content**: Some Wix sites have content in multiple languages (separate sitemaps like `/es_es-sitemap.xml`). Import the primary language first.
- **Wix app pages**: Pages powered by Wix Booking, Stores, or Events contain no static content — they're generated at runtime. Flag these for replacement with industry tools.
- **Rate limiting**: Wix may throttle rapid `curl` requests. If downloads fail on multiple consecutive pages, pause briefly between requests.
- **Dynamic pages missing from sitemap**: Pages powered by Wix collections/databases may not appear in the sitemap at all. Always cross-reference with homepage navigation links.
- **Canonical tag conflict**: If the owner changed a page's default canonical tag in Wix SEO settings, that page disappears from the sitemap entirely. This can cause pages to be missed during discovery.
- **RSS feed may degrade**: Wix has been known to disable full-text RSS or revert to links-only if the feed is called too frequently. Don't retry the feed — fall back to the extraction scripts.
- **Higher SEO risk than other migrations**: Wix URL structures differ significantly from most platforms (`/post/slug` for blog, flat paths for pages). Comprehensive redirect mapping is critical. Expect a 10–20% traffic dip in the first 4–6 weeks even with perfect redirects — warn the owner about this.
