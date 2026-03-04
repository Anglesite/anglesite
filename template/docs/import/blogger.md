# Importing from Blogger

Blogger (Blogspot) is Google's free blogging platform. Content is stored on Google's infrastructure with excellent export options — an Atom XML export and a full-featured API.

## How it detects this platform

URL patterns:
- `blogname.blogspot.com` — standard Blogger domain
- Custom domains — check for `<meta name="generator" content="Blogger"/>` in the page source, or DNS CNAME pointing to `ghs.googlehosted.com`

Also check the Atom feed endpoint: `SITE_URL/feeds/posts/default` — if this returns valid Atom XML, it's a Blogger site.

## Extraction methods

### Atom feed (best — no auth required)

```sh
curl -s "SITE_URL/feeds/posts/default?max-results=500&alt=rss"
```

The `alt=rss` parameter returns RSS 2.0 format. Without it, the default is Atom 1.0. Both contain full post content.

For Atom format (includes more metadata):
```sh
curl -s "SITE_URL/feeds/posts/default?max-results=500"
```

The feed supports pagination with `start-index` parameter:
```sh
curl -s "SITE_URL/feeds/posts/default?max-results=150&start-index=1"
curl -s "SITE_URL/feeds/posts/default?max-results=150&start-index=151"
```

Each entry contains:
- `<title>` — post title
- `<content type="html">` — full HTML content
- `<published>` — ISO 8601 timestamp
- `<updated>` — last modified timestamp
- `<category term="label-name">` — labels (multiple elements)
- `<link rel="alternate" href="...">` — post URL
- `<author><name>` — author name
- `<summary>` — excerpt (if set)

### XML backup (if owner has dashboard access)

The owner can export from Blogger dashboard → Theme → More → Backup Download. This produces an Atom XML file with all posts, pages, comments, and settings.

In the backup XML, differentiate entry types by the `<category>` element:
- Posts: `term="http://schemas.google.com/blogger/2008/kind#post"`
- Pages: `term="http://schemas.google.com/blogger/2008/kind#page"`
- Comments: `term="http://schemas.google.com/blogger/2008/kind#comment"`

### Blogger API v3 (requires Google API key)

If the owner has a Google API key:
```sh
curl -s "https://www.googleapis.com/blogger/v3/blogs/BLOG_ID/posts?key=API_KEY&maxResults=500"
```

Returns JSON with full post content. The feed approach is simpler and doesn't require authentication.

## Frontmatter mapping

| Blogger field | Anglesite field | Notes |
| --- | --- | --- |
| `<title>` | `title` | Direct copy |
| `<summary>` or first paragraph | `description` | Generate from content if no summary |
| `<published>` | `publishDate` | Convert from ISO 8601 to YYYY-MM-DD |
| `<category term="...">` | `tags` | Labels — filter out Blogger system categories (those with `scheme="http://schemas.google.com/g/2005#kind"`) |
| First image in content | `image` | Download from Google CDN |
| Post URL | `syndication` | Original Blogger URL |
| `<app:draft>true</app:draft>` | `draft` | `true` if draft element is present |

## Content conversion

Blogger content is HTML. Convert to Markdown with these Blogger-specific adjustments:

**Elements to handle:**
- `<div class="separator">` wrapping images → extract `<img>` and `<a>` tags
- `<a>` wrapping `<img>` — Blogger wraps images in links to full-size versions → extract image with the link href as the image source (it's the full-size URL)
- `<br/>` tags — Blogger uses `<br/>` liberally instead of proper paragraphs → convert double `<br/>` to paragraph breaks
- `<span>` with inline styles — Blogger's WYSIWYG editor adds font-size, color, and font-family styles → strip all inline styles
- `<div>` wrapping paragraphs → unwrap to plain text
- `<table>` — keep as-is (Markdown tables) if simple; note for review if complex

**Elements to strip:**
- `<script>` tags (Blogger widgets)
- `<iframe>` embeds (Google Maps, YouTube) → note for manual review
- Adsense blocks
- Social sharing widgets

## Image handling

Blogger images are hosted on Google's CDN:
- `blogger.googleusercontent.com/img/...`
- `lh3.googleusercontent.com/...` (Google Photos CDN)
- `bp.blogspot.com/...` (legacy)

Image URLs are stable and don't expire (they're on Google's infrastructure). Download them anyway for self-hosting.

Blogger wraps images in `<a>` links pointing to the full-size version. Use the `<a href>` URL (not the `<img src>` URL) for the highest resolution.

Copy to `public/images/blog/SLUG-hero.webp` (or `SLUG-body-N.webp` for inline images).

## URL patterns for redirects

Blogger's default permalink structure:
- `https://blogname.blogspot.com/YYYY/MM/post-slug.html`

```
/YYYY/MM/post-slug.html /blog/post-slug 301
```

For custom domains:
- `https://example.com/YYYY/MM/post-slug.html`

The year/month/slug pattern is consistent. Extract from the `<link rel="alternate">` URL in the feed.

## Common issues

- **Country-specific redirects**: Blogger historically redirected to country-specific domains (`blogname.blogspot.co.uk`, `.com.au`, etc.). This was deprecated in 2018 but old links may still exist. Generate redirects for the `.com` domain only.
- **HTML formatting quality**: Blogger's WYSIWYG editor produces verbose HTML with many `<br/>`, `<span>`, and `<div>` tags. The HTML-to-Markdown conversion needs to handle this gracefully.
- **Labels vs tags**: Blogger calls them "labels." They map directly to Anglesite tags.
- **Pages vs posts**: Blogger distinguishes pages (static content) from posts (blog entries). In the Atom feed, check the `<category>` with scheme `blogger/2008/kind` to differentiate.
- **Comment import**: Blogger exports include comments as separate entries. Skip comments during import — they don't map to Anglesite's content model.
- **Image links**: Blogger wraps every image in a link to the full-size version. Use the link target (full-size URL) when downloading, not the inline thumbnail.
- **Very old blogs**: Blogs from the early 2000s may have unusual formatting. The Atom feed handles these fine, but the HTML content may need more aggressive cleanup.
