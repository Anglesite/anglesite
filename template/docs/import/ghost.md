# Importing from Ghost

Ghost is an open-source publishing platform (48k GitHub stars) focused on professional blogging and newsletters. Content is stored as HTML (internally as MobileDoc JSON), with a clean Content API for extraction.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Ghost.

## How it detects this platform

Check the page source for `<meta name="generator" content="Ghost">` or probe `SITE_URL/ghost/api/content/` for a response. The RSS feed is at `/rss/` (not `/feed/`).

## Extraction methods

### Content API (best)

Ghost's Content API provides read-only JSON access to all published content. It requires an API key, which the owner creates in Ghost Admin → Integrations → Custom Integration.

```sh
curl -s "SITE_URL/ghost/api/content/posts/?key=API_KEY&limit=100&include=tags,authors&formats=plaintext"
```

Paginate using `&page=2`, `&page=3`, etc. The response includes `meta.pagination.pages` for the total page count.

Each post object contains:
- `title` — post title
- `slug` — URL slug
- `html` — full HTML content
- `plaintext` — plain text version (requires `formats=plaintext`)
- `custom_excerpt` — manually set excerpt (may be null)
- `feature_image` — hero image URL
- `published_at` — ISO 8601 timestamp
- `tags` — array of tag objects (requires `include=tags`)
- `url` — full post URL

Pages are at a separate endpoint:

```sh
curl -s "SITE_URL/ghost/api/content/pages/?key=API_KEY&limit=100&include=tags"
```

### RSS feed (fallback)

If the owner can't provide an API key:

```sh
curl -s SITE_URL/rss/
```

The RSS feed contains full HTML content in `<content:encoded>`, plus title, date, and link.

### JSON export (if owner has admin access)

The owner can export from Ghost Admin → Settings → Advanced → Import/Export. This produces a JSON file containing all posts, pages, tags, and settings.

## Frontmatter mapping

| Ghost field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `custom_excerpt` or `plaintext` (first paragraph) | `description` | Prefer `custom_excerpt`; if null, generate from first paragraph |
| `published_at` | `publishDate` | Convert from ISO 8601 to YYYY-MM-DD |
| `feature_image` | `image` | Download to `public/images/blog/` |
| `tags[].name` | `tags` | Extract tag names from tag objects |
| `url` | `syndication` | Original Ghost URL |
| `status: "draft"` | `draft` | `true` if status is "draft" |

## Content conversion

Ghost content arrives as rendered HTML. Apply the standard HTML-to-Markdown conversion from [hosted-platforms.md](hosted-platforms.md), plus these Ghost-specific adjustments:
- `<figure>` with `<figcaption>` → `![alt](src)` (use caption as alt if no alt attribute)
- `<div class="kg-card">` — Ghost's card system wrapper → strip wrapper, keep content
- `<div class="kg-bookmark-card">` — bookmark embeds → convert to `[title](url)`
- `<div class="kg-gallery-card">` — image galleries → sequential images
- `<pre><code>` — code blocks → fenced code blocks with language class
- `<!--kg-card-begin: html-->` / `<!--kg-card-end: html-->` → strip markers, keep HTML content, convert to Markdown
- Email signup forms and newsletter CTAs → strip entirely

## Image handling

Ghost images are served from `SITE_URL/content/images/`:
- `https://example.com/content/images/2024/03/photo.jpg`

The URL includes a date-based directory structure. Download each image and flatten to `public/images/blog/SLUG-hero.webp`.

For feature images, the `feature_image` field contains the full URL. For inline images, extract from the HTML content.

## URL patterns for redirects

Ghost's default URL pattern is `/{slug}/`:
- `https://example.com/my-blog-post/` → `/blog/my-blog-post`

```
/slug/ /blog/slug 301
```

Ghost supports custom routing via `routes.yaml`, so check the actual `url` field from the API response rather than assuming a pattern.

## Newsletter subscriber migration

Ghost is a newsletter platform as well as a blog. When importing from Ghost, the owner likely has email subscribers they want to keep.

### Exporting subscribers from Ghost

**Via Ghost Admin UI (easiest):** Ghost Admin → Members → Export. This downloads a CSV with all subscriber emails, names, subscription dates, and membership tiers.

**Via Admin API (programmatic):**

```sh
curl -s "GHOST_URL/ghost/api/admin/members/?limit=100&page=1" \
  -H "Authorization: Bearer JWT_TOKEN"
```

The Admin API requires a JWT token generated from the Admin API key (different from the Content API key). Each member object contains:
- `email` — subscriber email address
- `name` — subscriber name
- `created_at` — subscription date
- `status` — "free", "paid", or "comped"
- `subscribed` — boolean (opted in to emails)
- `labels` — array of label objects

Paginate with `&page=2`, `&page=3`, etc.

### Migration paths

**Ghost → Ghost (keep using Ghost as newsletter backend):** No subscriber migration needed. The owner keeps their Ghost instance running for email delivery. See `docs/platforms/ghost-newsletter.md` for how to connect Ghost as the newsletter backend for the Anglesite site.

**Ghost → Buttondown:** Export the members CSV from Ghost Admin. Import it into Buttondown at buttondown.email → Subscribers → Import. Buttondown accepts standard CSV with email and name columns.

**Ghost → Mailchimp:** Export the members CSV from Ghost Admin. Import into Mailchimp via Audience → Add contacts → Import contacts → CSV file.

### When to offer this

During the import, after content has been imported, check if the Ghost site has newsletter features enabled. If the Content API shows posts with `email_only` visibility or the owner mentions a newsletter, ask about subscriber migration. See the import skill's newsletter step for the conversation flow.

## Common issues

- **API key required**: The Content API needs a key. If the owner can't provide one, fall back to the RSS feed at `/rss/`.
- **MobileDoc format**: Ghost stores content internally as MobileDoc JSON, but the Content API converts to HTML automatically. Do not try to parse MobileDoc directly.
- **Newsletter content**: Ghost combines blogging with email newsletters. Some posts may be email-only (members-only content). The Content API only returns publicly accessible posts unless using the Admin API.
- **Members-only posts**: Posts with `visibility: "members"` or `visibility: "paid"` may have truncated content in the Content API. The API key only grants access to public content.
- **Self-hosted vs Ghost(Pro)**: Ghost can be self-hosted or on Ghost(Pro). The extraction method is the same — the Content API works on both.
