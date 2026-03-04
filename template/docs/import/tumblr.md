# Importing from Tumblr

Tumblr is a microblogging and social networking platform. It supports multiple post types (text, photo, quote, link, chat, audio, video) and has a full API for content extraction. The RSS feed works for simpler imports.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Tumblr.

## How it detects this platform

URL patterns:
- `blogname.tumblr.com` — standard Tumblr subdomain
- Custom domains — DNS CNAME points to `domains.tumblr.com` or A record to `66.6.44.4`

Check for Tumblr indicators in the page source:
- `media.tumblr.com` in image URLs
- Tumblr theme JavaScript files
- `<meta name="generator" content="Tumblr">`

## Extraction methods

### RSS feed (simplest — no auth required)

```sh
curl -s "SITE_URL/rss"
```

For standard Tumblr URLs:
```sh
curl -s "https://BLOGNAME.tumblr.com/rss"
```

Tag-filtered feeds:
```sh
curl -s "https://BLOGNAME.tumblr.com/tagged/TAG_NAME/rss"
```

The RSS feed contains published posts with title, content (HTML), date, and link.

### Tumblr API v2 (best — requires API key)

Register an application at `tumblr.com/oauth/applications` to get a Consumer Key (API key).

```sh
curl -s "https://api.tumblr.com/v2/blog/BLOGNAME.tumblr.com/posts?api_key=API_KEY&limit=20&offset=0"
```

Paginate with `offset`: increment by 20 until `response.posts` is empty.

The API response includes:
- `response.blog.posts` — total post count
- `response.posts[]` — array of post objects, each with:
  - `id` / `id_string` — post ID
  - `post_url` — canonical URL
  - `type` — post type (text, photo, quote, link, chat, audio, video)
  - `timestamp` — Unix timestamp
  - `date` — ISO 8601 date string
  - `tags` — array of tag strings
  - `title` — post title (text posts only)
  - `body` — HTML content (text posts)
  - Type-specific fields (see post types below)

### Official data export (if owner has account access)

The owner can export from Settings → select blog → Export. This produces a ZIP with:
- `/Posts/` folder — one HTML file per post
- `/Media/` folder — all uploaded images and media

Limited to 4 exports per blog per month, retained for 3 days.

## Post types and content mapping

Tumblr has 7 post types. Map each to blog content:

| Post type | Key fields | Conversion |
| --- | --- | --- |
| `text` | `title`, `body` | Title → `title`, body HTML → Markdown content |
| `photo` | `photos[]`, `caption` | First photo → `image`, caption → content |
| `quote` | `text`, `source` | Quote text → blockquote content, source → attribution |
| `link` | `url`, `title`, `description` | Title → `title`, description → content, include URL |
| `chat` | `dialogue[]` | Format as content with speaker names |
| `audio` | `caption`, `artist`, `track_name` | Caption → content, note audio for manual review |
| `video` | `caption`, `video_url` | Caption → content, note video for manual review |

**Recommendation**: Import `text` and `photo` posts as blog posts. For `quote`, `link`, and `chat` types, ask the owner if they want these imported — they may be more like social media posts than blog content.

## Frontmatter mapping

| Tumblr field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Text posts only — for other types, generate from content |
| First paragraph or caption | `description` | Generate from body or caption content |
| `date` or `timestamp` | `publishDate` | Convert to YYYY-MM-DD |
| `tags` | `tags` | Direct copy — Tumblr tags are simple strings |
| `photos[0].original_size.url` or feature image | `image` | Download from Tumblr CDN |
| `post_url` | `syndication` | Original Tumblr URL |

**Untitled posts**: Many Tumblr posts (especially photos, quotes, links) have no title. Generate a title from the first line of content, or from the date and type (e.g., "Photo — March 15, 2024").

## Content conversion

For text posts, `body` contains HTML. Convert to Markdown as with other platforms.

**Tumblr-specific elements to handle:**
- `<figure>` with Tumblr image classes → extract image
- `<a class="tumblr_blog">` — reblog attribution links → keep or strip
- `<blockquote class="tumblr_quote">` → `>`
- Reblog chains (nested `<blockquote>` with attributions) → flatten or strip reblog content, keeping only the original post
- `<p class="tmblr-attribution">` → strip (reblog source attribution)
- Read-more markers (`<a class="tmblr-truncated-link">`) → strip

**For photo posts:**
- Extract the highest resolution image from `photos[].original_size.url`
- Use `caption` as the post body content
- If multiple photos, create an image for each or note for gallery treatment

## Image handling

Tumblr images are hosted on Tumblr's CDN:
- `media.tumblr.com` — primary domain
- `66.media.tumblr.com`, `64.media.tumblr.com` — numbered CDN instances

Image URLs include resolution variants:
- `_1280.jpg` — largest standard size
- `_500.jpg` — medium
- `_250.jpg` — thumbnail

When using the API, `photos[].original_size.url` gives the highest available resolution. When parsing HTML, look for the largest `_NNNN` suffix in image URLs.

Download to `public/images/blog/`. Tumblr CDN URLs are stable.

## URL patterns for redirects

Tumblr post URLs:
- `https://blogname.tumblr.com/post/POST_ID/slug`
- `https://blogname.tumblr.com/post/POST_ID` (also works)

For custom domains:
- `https://custom-domain.com/post/POST_ID/slug`

```
/post/POST_ID/slug /blog/slug 301
/post/POST_ID /blog/slug 301
```

The post ID is numeric and unique. The slug is optional in the URL.

## Common issues

- **Microblogging culture**: Tumblr posts are often very short — a single image, a one-line quote, or a reblogged post. Ask the owner which post types and what minimum content length to import.
- **Reblog content**: Many Tumblr "posts" are reblogs of other people's content. These should typically be skipped — they're not original content. Check for `reblogged_from_name` in the API response.
- **No titles on most posts**: Only text posts have titles, and many don't use them. Photo, quote, and link posts are titleless by default.
- **Very high post counts**: Active Tumblr blogs can have thousands of posts. Ask the owner which types and date ranges to import rather than importing everything.
- **NSFW content**: Tumblr has NSFW blogs. The API includes an `is_nsfw` flag on the blog object. Handle appropriately.
- **Rate limits**: The Tumblr API allows 300 calls per minute per IP. With 20 posts per request, a 1,000-post blog takes 50 requests — well within limits.
