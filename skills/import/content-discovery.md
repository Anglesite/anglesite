# Step 1b — Platform-specific content discovery

Use the instructions below for the detected PLATFORM. Each section describes how
to fetch blog posts and static pages. Build BLOG_POSTS and STATIC_PAGES lists
from the results.

## WordPress

Fetch posts, pages, categories, and tags via the REST API:

```sh
curl -s "SITE_URL/wp-json/wp/v2/posts?per_page=100&page=1"
```

```sh
curl -s "SITE_URL/wp-json/wp/v2/pages?per_page=100&page=1"
```

```sh
curl -s "SITE_URL/wp-json/wp/v2/categories?per_page=100"
```

```sh
curl -s "SITE_URL/wp-json/wp/v2/tags?per_page=100"
```

Paginate posts and pages: if the response contains 100 items, fetch `&page=2`,
`&page=3`, etc. until the response is empty or returns a 400 error.

Each post JSON object contains: `title.rendered`, `content.rendered`, `date`,
`slug`, `excerpt.rendered`, `featured_media` (media ID), `categories` (ID array),
`tags` (ID array), `link` (the original URL).

Build BLOG_POSTS from the posts response and STATIC_PAGES from the pages response.
Build lookup maps for category IDs → names and tag IDs → names.

## Squarespace

Ask the owner:
> "Squarespace lets you export your content as an XML file, which gives me the
> most complete version of your posts and pages. Would you like to do that?
>
> Go to your Squarespace dashboard → Settings → Import & Export → Export.
> Download the XML file and tell me where you saved it."

**If they provide a WXR file:** Read it with the Read tool. Parse the XML
`<item>` elements. Each item has:
- `<title>` → title
- `<content:encoded>` → full HTML content
- `<wp:post_date>` → publish date
- `<wp:post_type>` → "post" or "page"
- `<wp:post_name>` → slug
- `<category domain="post_tag">` → tags
- `<category domain="category">` → categories

Build BLOG_POSTS from items where `<wp:post_type>` is "post" and STATIC_PAGES
from items where it is "page".

**If they decline or can't export:** Fall back to RSS + sitemap + WebFetch.

```sh
curl -s "SITE_URL/blog?format=rss"
```

```sh
curl -s SITE_URL/sitemap.xml
```

The RSS feed contains the 20 most recent blog posts with full content. The
sitemap lists all pages. Posts not in the RSS feed will be fetched via WebFetch
in Step 2.

## Wix

```sh
curl -s SITE_URL/sitemap.xml
```

Parse the sitemap index to find child sitemaps. Fetch each:

```sh
curl -s SITE_URL/blog-posts-sitemap.xml
```

```sh
curl -s SITE_URL/pages-sitemap.xml
```

From the blog posts sitemap, extract each post's `<loc>` URL, slug (path segment
after `/post/`), and `<lastmod>` date.

From the pages sitemap, extract each page's `<loc>` URL and path. Filter out Wix
system pages — skip URLs containing `/blank`, `/_api`, `/apps/`, `/#`, `?`, or
`/_partials`.

Then fetch the RSS feed for blog metadata:

```sh
curl -s SITE_URL/blog-feed.xml
```

For each `<item>`, extract `<title>`, `<pubDate>`, `<description>` (excerpt),
`<enclosure url="...">` (hero image), and `<dc:creator>`. Match items to
BLOG_POSTS by `<link>` URL. The RSS feed contains only excerpts — full content
requires WebFetch in Step 2.

**Important:** Wix RSS feeds contain only blog posts, never static pages. All
pages discovered from the sitemap will need WebFetch extraction in Step 3.

## Ghost

If the owner provides a Content API key, use the API:

```sh
curl -s "SITE_URL/ghost/api/content/posts/?key=API_KEY&limit=100&include=tags,authors&formats=plaintext"
```

Paginate with `&page=2`, etc. Each post contains `title`, `html`, `slug`,
`published_at`, `feature_image`, `tags[]`, and `url`.

For pages:
```sh
curl -s "SITE_URL/ghost/api/content/pages/?key=API_KEY&limit=100&include=tags"
```

If no API key, fall back to the RSS feed:
```sh
curl -s SITE_URL/rss/
```

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/ghost.md` for full field mapping and content conversion details.

## Medium

```sh
curl -s "SITE_URL/feed"
```

For standard Medium profiles: `https://medium.com/feed/@USERNAME`

The RSS feed contains full HTML content in `<content:encoded>`, plus title,
date, tags (as `<category>` elements), and post URL. The feed typically returns
only the 10–20 most recent posts. For older posts, use WebFetch on each URL.

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/medium.md` for image CDN handling and URL patterns.

## Substack

```sh
curl -s "SITE_URL/feed"
```

The RSS feed contains full HTML content for public posts. Each `<item>` includes
title, content, date, author, and enclosure (cover image). Paywalled posts have
truncated content.

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/substack.md` for content conversion details.

## Blogger

```sh
curl -s "SITE_URL/feeds/posts/default?max-results=500"
```

The Atom feed contains full post content, labels, dates, and author info.
Paginate with `start-index` if over 500 posts.

Differentiate posts from pages by `<category>` term:
- Posts: `kind#post`
- Pages: `kind#page`
- Comments: `kind#comment` (skip)

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/blogger.md` for XML structure and image handling.

## Shopify

```sh
curl -s "SITE_URL/blogs/news.atom"
```

The default blog handle is `news`. Try other handles (`blog`, `journal`) if 404.
Check the sitemap for blog URLs:
```sh
curl -s SITE_URL/sitemap.xml
```

The Atom feed contains full article content, tags, author, and date.

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/shopify.md` for CDN URL patterns and store-specific issues.

## Weebly

```sh
curl -s "SITE_URL/blog/feed/"
```

The RSS feed may contain excerpts only. For full content, use WebFetch on each
post URL. Discover pages from the sitemap:
```sh
curl -s SITE_URL/sitemap.xml
```

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/weebly.md` for content extraction details.

## Tumblr

If the owner provides an API key:
```sh
curl -s "https://api.tumblr.com/v2/blog/BLOG_IDENTIFIER/posts?api_key=API_KEY&limit=20&offset=0"
```

Paginate with `offset` incremented by 20.

Without an API key, use the RSS feed:
```sh
curl -s "SITE_URL/rss"
```

Tumblr has multiple post types (text, photo, quote, link, chat, audio, video).
Import text and photo posts as blog posts. Ask the owner about other types.

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/tumblr.md` for post type mapping and image CDN details.

## Webflow

Check for an RSS feed first:
```sh
curl -s "SITE_URL/blog/rss.xml"
```

If no RSS feed, discover content via the sitemap:
```sh
curl -s SITE_URL/sitemap.xml
```

If the owner has an API token (from Site Settings → Integrations → API Access):
```sh
curl -s -H "Authorization: Bearer API_TOKEN" "https://api.webflow.com/v2/sites"
```

Then list collections and fetch items via the API. Without API access, use
WebFetch on each page URL discovered from the sitemap.

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/webflow.md` for CMS field mapping and content extraction details.

## GoDaddy Website Builder

GoDaddy has no API and usually no RSS feed. Discover pages from the sitemap:
```sh
curl -s SITE_URL/sitemap.xml
```

If no sitemap, WebFetch the homepage to extract navigation links. For each page,
use WebFetch with the standard extraction prompt. GoDaddy sites are typically
small (5–15 pages).

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/godaddy.md` for detection signals and content extraction details.

## Carrd

Carrd sites are single-page. Use WebFetch on SITE_URL to extract all content
in one call. For Carrd Pro multi-page sites, check for internal navigation
links and WebFetch each page.

Carrd imports produce **pages** (not blog posts) since Carrd sites don't have
blogs.

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/carrd.md` for content structuring details.

## Micro.blog

```sh
curl -s "SITE_URL/feed.json"
```

Micro.blog uses JSON Feed as its primary format. The feed contains full HTML
content, tags, and dates. Paginate by following the `next_url` field.

Tell the owner:
> "If you can export your data from micro.blog (Account → Export), I'll get
> the most complete copy including all your images."

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/microblog.md` for untitled post handling and image details.

## WriteFreely / Write.as

```sh
curl -s "SITE_URL/api/collections/USERNAME/posts"
```

The WriteFreely API returns content in **Markdown** (not HTML), making this one
of the cleanest import sources. No content conversion is needed beyond
frontmatter mapping.

For Write.as:
```sh
curl -s "https://write.as/api/collections/USERNAME/posts"
```

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/writefreely.md` for API details and untitled post handling.

## Unknown platform

```sh
curl -s SITE_URL/sitemap.xml
```

```sh
curl -s SITE_URL/feed
```

```sh
curl -s SITE_URL/rss.xml
```

Use whatever sitemap or feed is found. If no sitemap exists, WebFetch the
homepage to identify the main navigation links, then build STATIC_PAGES from
those. Build BLOG_POSTS from any RSS/feed items found.
