# Importing from Micro.blog

Micro.blog is an IndieWeb-native blogging and social platform. It supports microformats, Webmention, and ActivityPub natively. Content is available via a JSON Feed, RSS, and the Micropub/Micro.blog API.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, and missing field fallbacks. This doc covers only what's specific to Micro.blog.

## How it detects this platform

URL patterns:
- `username.micro.blog` — standard Micro.blog domain
- Custom domains — check for `micro.blog` in the page source, or the JSON Feed at `SITE_URL/feed.json`

Also check for:
- `<link rel="micropub" href="https://micro.blog/micropub">` in the page head
- `<link rel="authorization_endpoint" href="https://micro.blog/indieauth/...">`
- `micro.blog` in generator meta tag or feed metadata

## Extraction methods

### JSON Feed (best — no auth required)

```sh
curl -s "SITE_URL/feed.json"
```

Micro.blog uses JSON Feed (jsonfeed.org) as its primary feed format. The feed contains:
- `items[].id` — unique identifier (URL)
- `items[].title` — post title (empty for short microblog posts)
- `items[].content_html` — full HTML content
- `items[].content_text` — plain text version
- `items[].date_published` — ISO 8601 timestamp
- `items[].url` — permalink
- `items[].tags` — array of tag strings
- `items[].image` — hero image URL (if set)

The feed may be paginated with `next_url` at the top level. Follow pagination to get all posts.

### RSS feed (alternative)

```sh
curl -s "SITE_URL/feed.xml"
```

Standard RSS 2.0 with `<content:encoded>` for full HTML content.

### Micro.blog API (if owner has a token)

```sh
curl -s -H "Authorization: Bearer TOKEN" "https://micro.blog/posts/USERNAME"
```

Returns JSON with the user's posts. This is useful for accessing draft posts and photos.

### Data export

The owner can export from micro.blog → Account → Export. This produces a ZIP containing:
- `feed.json` — all posts in JSON Feed format
- `uploads/` — all uploaded images and media

Tell the owner:
> "Micro.blog has a great export feature. If you go to your Account page and
> click Export, you'll get a ZIP file with all your posts and images. That
> gives me the most complete copy."

## Frontmatter mapping

| Micro.blog field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | May be empty for microblog posts — generate from first line of content |
| First paragraph or `content_text` | `description` | Generate from content |
| `date_published` | `publishDate` | Convert from ISO 8601 to YYYY-MM-DD |
| `tags` | `tags` | Direct array copy |
| `image` or first image in content | `image` | Download |
| `url` or `id` | `syndication` | Original Micro.blog URL |

### Handling untitled posts

Micro.blog posts often have no title (microblog-style short posts). For these:
- If the post is under 280 characters, generate a title from the first sentence (truncate at 60 chars, add ellipsis)
- If longer, use the first heading in the content, or generate from the first sentence

## Content conversion

Micro.blog content is clean HTML. Convert to Markdown:

**Elements to handle:**
- `<img>` tags — images may be hosted on `micro.blog/photos/` or `cdn.micro.blog/`
- `<a>` tags — may contain `@username` mentions linking to micro.blog profiles → keep the link
- `<video>` and `<audio>` tags — Micro.blog supports media posts → note for manual review
- Emoji shortcodes — Micro.blog uses standard Unicode emoji, no conversion needed

**Elements to strip:**
- Microformats markup (class names like `h-entry`, `p-name`, `e-content`) — strip class attributes, keep content
- Webmention/IndieWeb metadata in the HTML → strip

## Image handling

Micro.blog images are hosted at:
- `micro.blog/photos/NNNN/` — uploaded photos
- `cdn.micro.blog/` — CDN-served images
- External URLs — Micro.blog supports linking to external images

For data export ZIPs, copy images from the `uploads/` directory.

Download each image to `public/images/blog/`. Micro.blog CDN URLs are stable but download for self-hosting per ADR-0011.

## URL patterns for redirects

Micro.blog post URLs:
- `https://username.micro.blog/YYYY/MM/DD/post-slug.html`
- `https://username.micro.blog/YYYY/MM/DD/NNNNNN.html` (auto-generated ID for untitled posts)

```
/YYYY/MM/DD/post-slug.html /blog/post-slug 301
/YYYY/MM/DD/NNNNNN.html /blog/generated-slug 301
```

For custom domains, the same path structure applies.

## Common issues

- **Untitled posts**: Many Micro.blog posts have no title. Generate titles from content for the Anglesite schema.
- **Short posts**: Microblog-style posts may be very short (a sentence or two). These still import as blog posts but may feel sparse. Consider flagging very short posts for the owner to review or merge.
- **ActivityPub cross-posts**: Some posts may be cross-posted from Mastodon or other ActivityPub sources. The `syndication` field preserves the original URL.
- **Photo posts**: Micro.blog has a dedicated photo posting flow. These posts may contain only an image with a caption — generate a title from the caption.
- **Podcast episodes**: Micro.blog supports podcasting. Audio enclosures in the feed should be noted for the owner but not imported as blog posts.
- **IndieWeb metadata**: Micro.blog content may include microformats2 markup. Strip the class attributes during conversion but preserve the content structure.
