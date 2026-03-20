# Importing from Medium

Medium is a hosted blogging platform popular with writers and tech bloggers. Content is stored on Medium's servers with no public API for content retrieval. The RSS feed is the primary extraction method.

See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, pagination patterns, and missing field fallbacks. This doc covers only what's specific to Medium.

## How it detects this platform

URL patterns:
- `username.medium.com` — standard Medium profile
- `medium.com/@username` — legacy format (redirects to above)
- Custom domains — check the RSS feed at `SITE_URL/feed` or look for `medium.com` in page source meta tags

For custom domains, use WebFetch on the homepage and check for Medium-specific markup (Medium's JavaScript bundle, `data-post-id` attributes, or `miro.medium.com` image URLs).

## Extraction methods

### RSS feed (best for public content)

```sh
curl -s "SITE_URL/feed"
```

For standard Medium URLs:
```sh
curl -s "https://medium.com/feed/@USERNAME"
```

For publications:
```sh
curl -s "https://medium.com/feed/PUBLICATION_NAME"
```

The RSS feed contains **full HTML content** in `<content:encoded>` (not excerpts), plus:
- `<title>` — post title
- `<author>` — author name
- `<category>` — tags (multiple elements, one per tag)
- `<link>` — canonical URL
- `<pubDate>` — publication date

The feed returns the most recent posts (typically 10–20).

### Data export (if owner has account access)

The owner can request a data download: Settings → Security & Apps → "Download your information". This produces a ZIP with HTML files for each post, but **images are not included** — they remain on Medium's CDN.

### WebFetch (for older posts or custom domains)

For posts not in the RSS feed, use WebFetch on each post URL with the standard blog post extraction prompt.

## Frontmatter mapping

| Medium field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` | `title` | Direct copy |
| First paragraph of content | `description` | Medium has no excerpt field — generate from content |
| `<pubDate>` | `publishDate` | Convert to YYYY-MM-DD |
| `<category>` elements | `tags` | Multiple `<category>` tags in the RSS |
| First image in content | `image` | Download from Medium CDN |
| `<link>` | `syndication` | Original Medium URL |

## Content conversion

Apply the standard HTML-to-Markdown conversion from [hosted-platforms.md](hosted-platforms.md), plus these Medium-specific adjustments:

- `<h3>` — Medium uses `<h3>` for subheadings (not `<h2>`) → convert to `##`
- `<h4>` → convert to `###`
- `<pre>` code blocks → fenced code blocks (Medium doesn't specify language)
- Embedded tweets, YouTube, GitHub gists → note for manual review
- Medium member prompts and subscription CTAs → strip
- "Read more" links → strip
- Clap/response buttons and social sharing UI
- `<div class="section-divider">` — decorative dividers

## Image handling

Medium images are hosted on Medium's CDN:
- `miro.medium.com/v2/resize:fit:1400/...` — primary image domain
- `cdn-images-1.medium.com` — older image domain

Image URLs contain resize parameters. To get the largest version, modify the URL:
- Strip `/resize:fit:NNNN/` or `/max/NNNN/` from the URL path to get the original
- Or replace the size parameter with a larger value

Download each image to `public/images/blog/`. Medium CDN URLs are stable and don't expire.

## URL patterns for redirects

Medium post URLs include a trailing post ID:
- `https://username.medium.com/post-title-slug-a1b2c3d4e5f6`
- The last 12 characters after the final `-` are the post ID

For redirects, use the full original slug:
```
/post-title-slug-a1b2c3d4e5f6 /blog/post-title-slug 301
```

If the site used a custom domain, the path is just `/{slug}`.

## Common issues

- **No full content API**: Medium's official API does not return post content. The RSS feed is the primary extraction method.
- **Limited feed size**: The RSS feed typically returns only the 10–20 most recent posts. For older posts, use WebFetch on each URL (find URLs via the author's archive page or sitemap).
- **Custom domains**: Medium publications can use custom domains. The same RSS feed pattern works (`CUSTOM_DOMAIN/feed`).
- **Paywalled content**: Posts behind Medium's paywall may have truncated content in the RSS feed. The owner needs to make posts public before export, or use the data download.
- **Image CDN stability**: Medium CDN image URLs are stable and don't expire, but download them anyway for self-hosting per ADR-0011.
- **No categories**: Medium uses tags only (no categories). Tags in the RSS appear as multiple `<category>` elements.
- **Subtitle field**: Medium posts can have a subtitle that appears in the RSS `<content:encoded>` as a `<h4>` immediately after the title. Consider merging it into the description.
