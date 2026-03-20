# Importing from WriteFreely / Write.as

WriteFreely is open-source federated blogging software. Write.as is the hosted version. Both support ActivityPub federation and have a simple API for content retrieval.

See [hosted-platforms.md](hosted-platforms.md) for image optimization pipeline and missing field fallbacks. WriteFreely is unique among hosted platforms — its API returns raw Markdown, so the standard HTML-to-Markdown conversion rules don't apply. This doc covers only what's specific to WriteFreely.

## How it detects this platform

URL patterns:
- `username.write.as` — Write.as hosted
- Custom domains — check for WriteFreely markers

Detection signals:
- `<meta name="generator" content="WriteFreely">` in the page source
- `<link rel="me" href="...@write.as">` or similar ActivityPub references
- `/api/collections/` endpoint responding with JSON
- Minimal page design with the WriteFreely footer ("Powered by WriteFreely")
- `writefreely` in CSS/JS asset paths

## Extraction methods

### WriteFreely API (best — no auth required for public posts)

List all posts in a collection:
```sh
curl -s "SITE_URL/api/collections/USERNAME/posts"
```

For Write.as:
```sh
curl -s "https://write.as/api/collections/USERNAME/posts"
```

The response is JSON with:
- `data[].id` — post ID
- `data[].slug` — URL slug (may be empty for untitled posts)
- `data[].title` — post title (empty for untitled)
- `data[].body` — post body in **Markdown** (not HTML)
- `data[].created` — ISO 8601 timestamp
- `data[].updated` — ISO 8601 timestamp
- `data[].tags` — array of tag objects with `tag` field
- `data[].views` — view count

This is ideal — the content is already in Markdown and requires minimal conversion.

### RSS feed (alternative)

```sh
curl -s "SITE_URL/feed/"
```

The RSS feed contains full HTML content in `<content:encoded>`. The API is preferred since it returns raw Markdown.

### Data export (Write.as accounts)

Write.as users can export from Settings → Export. This produces a ZIP with:
- Individual `.txt` files for each post (Markdown content)
- A CSV index with metadata

## Frontmatter mapping

| WriteFreely field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | May be empty — generate from first line |
| First paragraph of `body` | `description` | Generate from content |
| `created` | `publishDate` | Convert from ISO 8601 to YYYY-MM-DD |
| `tags[].tag` | `tags` | Extract tag strings from tag objects |
| First image in body | `image` | Download if external |
| Post URL | `syndication` | Original WriteFreely URL |

### Handling untitled posts

WriteFreely supports untitled posts (the slug becomes a random ID like `a1b2c3d4e5`). Generate a title from the first sentence of the body, truncated at 60 characters.

## Content conversion

WriteFreely API returns content as **Markdown** — this is the cleanest import source. Minimal conversion needed:

**Adjustments:**
- WriteFreely uses standard CommonMark Markdown — compatible with Markdoc
- Check for and strip any HTML embedded in the Markdown (WriteFreely allows inline HTML)
- Image URLs may reference external hosts — download to local
- Math blocks (`$$...$$`) — WriteFreely supports LaTeX math → keep as-is or note for review
- Code blocks with language hints — keep as-is

**No conversion needed for:**
- Headings, lists, links, blockquotes, emphasis — standard Markdown
- Horizontal rules — standard Markdown

## Image handling

WriteFreely/Write.as has limited image support:
- Write.as Pro users can upload images to `i.snap.as/` CDN
- Free users typically link to external image hosts (Imgur, etc.)
- Self-hosted WriteFreely instances may store images at various paths

Scan the Markdown body for image references (`![alt](url)`) and download each to `public/images/blog/`.

`i.snap.as` URLs are stable for Write.as Pro accounts but should be downloaded for self-hosting.

## URL patterns for redirects

Write.as post URLs:
- `https://write.as/USERNAME/post-slug` — titled posts
- `https://write.as/USERNAME/a1b2c3d4e5` — untitled posts (random ID)
- `https://username.write.as/post-slug` — subdomain format

Self-hosted WriteFreely:
- `https://example.com/USERNAME/post-slug`
- `https://example.com/post-slug` (single-user instance)

```
/USERNAME/post-slug /blog/post-slug 301
/post-slug /blog/post-slug 301
```

## Common issues

- **Markdown source**: Unlike most platforms, WriteFreely returns Markdown directly. This means almost no content conversion is needed — just frontmatter mapping and image downloading.
- **Untitled posts**: Many WriteFreely users write without titles (microblog style). Generate titles for the Anglesite schema.
- **Minimal metadata**: WriteFreely posts have very little metadata — no featured images, no excerpts, no categories. Generate descriptions from content.
- **Federation URLs**: Posts may have been federated via ActivityPub. The original URL is the canonical source — federated copies on Mastodon etc. are not imported.
- **Single-user vs multi-user**: Self-hosted WriteFreely instances may be single-user (no username in the URL path) or multi-user. Check the API response structure.
- **snap.as image CDN**: Write.as Pro uses `i.snap.as` for image hosting. These URLs are stable but tied to the account.
- **Math content**: WriteFreely is popular with academic writers. Posts may contain LaTeX math notation — preserve it but note that Markdoc doesn't render math natively.
