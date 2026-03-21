---
name: import
description: "Import content from a website URL (WordPress, Squarespace, Wix, Webflow, GoDaddy, Ghost, Medium, Substack, Blogger, Shopify, Weebly, Tumblr, Micro.blog, WriteFreely, Carrd)"
argument-hint: "[website URL]"
allowed-tools: ["WebFetch", "Bash(curl *)", "Bash(npx sharp-cli *)", "Bash(mkdir *)", "Bash(npm run build)", "Bash(npm install)", "Bash(zsh *)", "Bash(git add *)", "Bash(git commit *)", "Bash(ls *)", "Bash(wc *)", "Bash(grep *)", "Bash(find src/content/posts *)", "Bash(find public/images *)", "Write", "Read", "Glob", "Edit"]
disable-model-invocation: true
---

Import blog posts, pages, and images from a live website URL. Supports
WordPress, Squarespace, Wix, Webflow, GoDaddy, Ghost, Medium, Substack,
Blogger, Shopify, Weebly, Tumblr, Micro.blog, WriteFreely, and Carrd. Detects
the platform automatically and uses the best extraction method. Migrates content
into the site's Markdoc collection, downloads images, and generates redirect
mappings so existing links and search rankings are preserved.

To convert an existing static site generator project (Hugo, Jekyll, Eleventy,
etc.) in the current directory, use `/anglesite:convert` instead.

## Shared guidance

Before reading the platform-specific doc, read `docs/import/hosted-platforms.md`
for HTML-to-Markdown conversion rules, image CDN handling, pagination patterns,
missing field fallbacks, and redirect best practices.

The platform-specific docs (`docs/import/PLATFORM.md`) cover only what's unique
to that platform — detection signals, API/feed endpoints, platform-specific HTML
elements, and CDN URL patterns. The shared docs cover everything common.

## Import principles

These apply to every import regardless of platform:

1. **Content accuracy over visual fidelity.** The first pass prioritizes getting all content moved correctly. Design tweaks come after.
2. **Download all images locally.** No external image dependencies — even stable CDNs. The site must render without any network calls to the old platform (ADR-0011).
3. **Generate descriptions from content.** If the platform has no excerpt field, use the first 1–2 sentences of the post body.
4. **Generate titles for untitled posts.** Microblog-style posts (Micro.blog, WriteFreely, Tumblr) need titles — use the first sentence, truncated at 60 characters.
5. **Preserve provenance.** Every imported post gets a `syndication` URL pointing to the original. This maintains the content trail (ADR-0006).
6. **Strip all third-party embeds.** YouTube, Twitter, Instagram embeds become comments noting what was there. No third-party JavaScript (ADR-0008).
7. **Don't replicate platform features.** Booking, store, events, forums can't be imported — redirect and recommend purpose-built replacements.
8. **Build must pass.** Fix every build error before presenting results to the owner (ADR-0012).
9. **Warn before cancellation.** For platforms where CDN URLs expire, explicitly warn the owner to verify all images are saved before they cancel their old account.

## Architecture decisions

- [ADR-0002 Keystatic CMS](docs/decisions/0002-keystatic-local-cms.md) — content lands as `.mdoc` files in `src/content/posts/`, the same format Keystatic edits
- [ADR-0006 IndieWeb POSSE](docs/decisions/0006-indieweb-posse.md) — imported posts get `syndication` URLs pointing back to their originals so the provenance trail is preserved
- [ADR-0008 No third-party JS](docs/decisions/0008-no-third-party-javascript.md) — tracking scripts, embedded iframes, and widget code must be stripped during import
- [ADR-0011 Owner ownership](docs/decisions/0011-owner-controls-everything.md) — imported content must not depend on the old platform to display correctly
- [ADR-0012 Verify first](docs/decisions/0012-verify-before-presenting.md) — build must pass after import before presenting results to the owner

Before every tool call or command that will trigger a permission prompt, explain
what you're about to do and why. The owner is non-technical.

## Step 0 — Check the project

### 0a — Is this already an Anglesite project?

Use Glob to check for `src/content/config.ts`.

If it exists, this project has already been scaffolded. Read `.site-config` to
load `SITE_NAME` and `OWNER_NAME`. Skip to **0c**.

### 0b — Scaffold if needed

If `src/content/config.ts` does not exist, check the working directory:

**If it contains an SSG project** (Hugo, Jekyll, Eleventy, etc. config files),
tell the owner:

> "It looks like you have a [Platform] project here. To convert it to Anglesite,
> use `/anglesite:convert` instead. `/anglesite:import` is for importing from a
> website URL."

Stop.

**If the directory is essentially empty** (only dotfiles like `.git`), scaffold:

```sh
zsh ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.sh --yes .
```

Ask the essentials:

1. "What's your name?"
2. "What should we call the new site?"

Save to `.site-config` using the **Write tool**:

```
SITE_TYPE=blog
OWNER_NAME=Name
SITE_NAME=Site Name
DEV_HOSTNAME=sitename.local
AI_MODEL=Claude Opus 4.6
EXPLAIN_STEPS=true
```

```sh
npm install
```

**If the directory has files but no recognized SSG**, tell the owner:

> "This directory has files in it but I don't recognize the project type. To
> import from a website, I'd recommend starting in an empty directory. Or use
> `/anglesite:convert` if this is a static site project."

Wait for guidance.

### 0c — Get the URL

Ask the owner for their website URL if they didn't provide one as an argument.

Normalize: strip trailing slashes, ensure `https://`. Store as SITE_URL.

## Step 1 — Detect platform and discover content

Tell the owner:
> "I'm going to look at your existing website to see what content is there and
> figure out the best way to import it. This takes about a minute."

### 1a — Detect the platform

**WordPress** — check for the REST API:

```sh
curl -s -o /dev/null -w "%{http_code}" SITE_URL/wp-json/
```

If the response is `200`, this is a WordPress site. Tell the owner:
> "Your site is built on WordPress. That makes importing easier — WordPress has
> a built-in API I can read directly."

**Ghost** — check for the Ghost Content API:

```sh
curl -s -o /dev/null -w "%{http_code}" SITE_URL/ghost/api/
```

Also check for `<meta name="generator" content="Ghost">` via WebFetch. If Ghost
is detected, tell the owner:
> "Your site is built on Ghost. If you can give me a Content API key from
> your Ghost admin panel (Integrations → Custom Integration), I can pull
> everything directly. Otherwise I can use the RSS feed."

Read `docs/import/ghost.md` for platform-specific extraction details.

**Blogger** — check for the Atom feed:

```sh
curl -s -o /dev/null -w "%{http_code}" SITE_URL/feeds/posts/default
```

Also check for `.blogspot.com` in the URL or `<meta name="generator" content="Blogger"/>`.
If detected, tell the owner:
> "Your site is on Blogger. Blogger has great export options — I can read
> everything directly from its feed."

Read `docs/import/blogger.md` for platform-specific extraction details.

**Other hosted platforms** — if none of the above matched, use WebFetch on the homepage:

Use WebFetch on SITE_URL with this prompt:
> "Look at the page source. Identify which platform this site is built on.
> Check for: 'squarespace' in script URLs or meta tags, 'wix' or 'Thunderbolt'
> in the source, 'cdn.shopify.com' or '/collections/' paths, 'media.tumblr.com'
> or tumblr theme files, 'miro.medium.com' or Medium-specific markup,
> 'substackcdn.com' or substack paths, 'cdnjs.weebly.com' or 'Powered by
> Weebly', 'data-wf-site' or 'assets.website-files.com' for Webflow,
> 'img1.wsimg.com' or 'secureservercdn.net' for GoDaddy Website Builder,
> 'static.carrd.co' or Carrd HTML structure for Carrd,
> 'micro.blog' or micropub links for Micro.blog,
> 'writefreely' or 'write.as' for WriteFreely.
> Report which platform you detect, or 'unknown' if you can't tell."

For each detected platform, read the corresponding doc from `docs/import/`:

| Platform | Detection signals | Doc reference |
| --- | --- | --- |
| Squarespace | `squarespace` in scripts/meta, `squarespace-cdn.com` | `docs/import/squarespace.md` |
| Wix | `wix` or `Thunderbolt` in source, `wixstatic.com` | `docs/import/wix.md` |
| Shopify | `cdn.shopify.com`, `/collections/`, `/products/` | `docs/import/shopify.md` |
| Medium | `miro.medium.com`, `.medium.com` domain | `docs/import/medium.md` |
| Substack | `substackcdn.com`, `.substack.com` domain | `docs/import/substack.md` |
| Weebly | `cdnjs.weebly.com`, "Powered by Weebly" | `docs/import/weebly.md` |
| Tumblr | `media.tumblr.com`, `.tumblr.com` domain | `docs/import/tumblr.md` |
| Webflow | `data-wf-site`, `assets.website-files.com` | `docs/import/webflow.md` |
| GoDaddy | `img1.wsimg.com`, `secureservercdn.net` | `docs/import/godaddy.md` |
| Carrd | `static.carrd.co`, `.carrd.co` domain | `docs/import/carrd.md` |
| Micro.blog | `micro.blog`, micropub endpoint | `docs/import/microblog.md` |
| WriteFreely | `writefreely` generator, `.write.as` domain | `docs/import/writefreely.md` |

Tell the owner what platform was detected and read the platform doc for
extraction instructions. For unknown platforms, tell the owner:
> "I'm not sure what platform your site uses, but I can still import the content
> by reading each page. It just takes a bit longer."

Store the detected platform as PLATFORM.

### 1b — Platform-specific content discovery

#### WordPress

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

#### Squarespace

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

#### Wix

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

#### Ghost

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

Read `docs/import/ghost.md` for full field mapping and content conversion details.

#### Medium

```sh
curl -s "SITE_URL/feed"
```

For standard Medium profiles: `https://medium.com/feed/@USERNAME`

The RSS feed contains full HTML content in `<content:encoded>`, plus title,
date, tags (as `<category>` elements), and post URL. The feed typically returns
only the 10–20 most recent posts. For older posts, use WebFetch on each URL.

Read `docs/import/medium.md` for image CDN handling and URL patterns.

#### Substack

```sh
curl -s "SITE_URL/feed"
```

The RSS feed contains full HTML content for public posts. Each `<item>` includes
title, content, date, author, and enclosure (cover image). Paywalled posts have
truncated content.

Read `docs/import/substack.md` for content conversion details.

#### Blogger

```sh
curl -s "SITE_URL/feeds/posts/default?max-results=500"
```

The Atom feed contains full post content, labels, dates, and author info.
Paginate with `start-index` if over 500 posts.

Differentiate posts from pages by `<category>` term:
- Posts: `kind#post`
- Pages: `kind#page`
- Comments: `kind#comment` (skip)

Read `docs/import/blogger.md` for XML structure and image handling.

#### Shopify

```sh
curl -s "SITE_URL/blogs/news.atom"
```

The default blog handle is `news`. Try other handles (`blog`, `journal`) if 404.
Check the sitemap for blog URLs:
```sh
curl -s SITE_URL/sitemap.xml
```

The Atom feed contains full article content, tags, author, and date.

Read `docs/import/shopify.md` for CDN URL patterns and store-specific issues.

#### Weebly

```sh
curl -s "SITE_URL/blog/feed/"
```

The RSS feed may contain excerpts only. For full content, use WebFetch on each
post URL. Discover pages from the sitemap:
```sh
curl -s SITE_URL/sitemap.xml
```

Read `docs/import/weebly.md` for content extraction details.

#### Tumblr

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

Read `docs/import/tumblr.md` for post type mapping and image CDN details.

#### Webflow

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

Read `docs/import/webflow.md` for CMS field mapping and content extraction details.

#### GoDaddy Website Builder

GoDaddy has no API and usually no RSS feed. Discover pages from the sitemap:
```sh
curl -s SITE_URL/sitemap.xml
```

If no sitemap, WebFetch the homepage to extract navigation links. For each page,
use WebFetch with the standard extraction prompt. GoDaddy sites are typically
small (5–15 pages).

Read `docs/import/godaddy.md` for detection signals and content extraction details.

#### Carrd

Carrd sites are single-page. Use WebFetch on SITE_URL to extract all content
in one call. For Carrd Pro multi-page sites, check for internal navigation
links and WebFetch each page.

Carrd imports produce **pages** (not blog posts) since Carrd sites don't have
blogs.

Read `docs/import/carrd.md` for content structuring details.

#### Micro.blog

```sh
curl -s "SITE_URL/feed.json"
```

Micro.blog uses JSON Feed as its primary format. The feed contains full HTML
content, tags, and dates. Paginate by following the `next_url` field.

Tell the owner:
> "If you can export your data from micro.blog (Account → Export), I'll get
> the most complete copy including all your images."

Read `docs/import/microblog.md` for untitled post handling and image details.

#### WriteFreely / Write.as

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

Read `docs/import/writefreely.md` for API details and untitled post handling.

#### Unknown platform

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

### 1c — Check for existing content

```sh
find src/content/posts -name "*.mdoc" -type f
```

If `.mdoc` files exist, note their slugs and tell the owner:
> "I found [N] existing posts. If any imported posts have the same slug, I'll
> skip them rather than overwrite."

Build a SKIPPED_SLUGS set from existing filenames.

### 1d — Present the inventory

Tell the owner what was found. Example:

> "Here's what I found on your website:
>
> **Blog posts:** 23 posts (July 2024 – February 2026)
> **Pages:** 6 pages (About, FAQ, Services, Contact, Gallery, Get Involved)
>
> I'll import all the blog posts and create placeholder pages for the static
> pages. The import will take about 5–10 minutes for a blog this size."

If BLOG_POSTS is empty, tell the owner — skip to Step 3 for pages only, or
Step 4 if image galleries were detected.

Ask:
> "Would you like to import all of it, or just the blog posts?"
> - **Everything** — import posts + page stubs + redirects (recommended)
> - **Blog posts only** — skip static pages

Wait for their answer before continuing.

## Step 2 — Import blog posts

Tell the owner:
> "I'm importing your blog posts now. I'll keep you posted on progress."

Ensure the image directory exists:

```sh
mkdir -p public/images/blog
```

Process each post in BLOG_POSTS that is not in SKIPPED_SLUGS.

### 2a — Extract the full post content

The extraction method depends on the platform:

**WordPress:** The content is already in the REST API response from Step 1b.
Use `content.rendered` (full HTML) and `excerpt.rendered`. To get the featured
image URL, fetch the media endpoint:

```sh
curl -s "SITE_URL/wp-json/wp/v2/media/FEATURED_MEDIA_ID"
```

The response contains `source_url` — the full-size image URL. Look up category
and tag names using the ID maps built in Step 1b.

**Squarespace (WXR export):** The content is already in the XML from Step 1b.
Use `<content:encoded>` (full HTML).

**Squarespace (RSS fallback):** For posts in the RSS feed, use the `<description>`
or `<content:encoded>` field. For posts NOT in the RSS feed (older than the 20
most recent), use WebFetch on the post URL with the extraction prompt below.

**Wix / Unknown:** Use WebFetch on each post URL with this prompt:

> "Extract the full blog post content from this page. Return:
> 1. The post title (from the main heading, not browser title)
> 2. The publication date in YYYY-MM-DD format
> 3. The full body content converted to clean Markdown. Remove navigation,
>    headers, footers, sidebars, comments, social share buttons, and any
>    widget content. Keep headings, paragraphs, lists, blockquotes, and inline
>    links. Convert embedded images to Markdown image syntax with their src URLs.
>    Strip tracking links and JavaScript event handlers.
> 4. A 1–2 sentence description suitable for a meta description
> 5. Any tags or categories shown on the page"

If extraction returns an error or empty content, add the post to FAILED_POSTS
and continue. Do not stop the import for individual failures.

### 2b — Convert HTML to Markdown

For WordPress and Squarespace content that arrives as rendered HTML, convert it
to clean Markdown:
- `<h2>` → `##`, `<h3>` → `###`, etc.
- `<p>` → paragraph with blank line separation
- `<a href="...">text</a>` → `[text](url)`
- `<img src="..." alt="...">` → `![alt](src)` (download image in step 2c)
- `<ul>/<li>` → `- item`
- `<ol>/<li>` → `1. item`
- `<blockquote>` → `> text`
- `<strong>` → `**text**`, `<em>` → `*text*`
- Strip all other HTML tags (`<div>`, `<span>`, `<figure>`, `<section>`, etc.)
- Strip inline styles, class attributes, and data attributes
- Strip empty paragraphs and excessive whitespace

### 2c — Download and optimize images

Tell the owner (once, not per-post):
> "I'm downloading images from your website and converting them to a
> web-friendly format."

**Hero/featured images:**

The image URL source depends on the platform:
- WordPress: `source_url` from the media API response
- Squarespace: image URLs in the content, typically from `images.squarespace-cdn.com`
- Wix: `<enclosure>` URL from the RSS feed, typically from `static.wixstatic.com`

For Wix images, strip transform parameters: remove everything from `/v1/` onward
or any query string, then append `?w=1200`. For WordPress and Squarespace, use
the URL as-is.

```sh
curl -L -s -o "public/images/blog/SLUG-hero.jpg" "IMAGE_URL"
```

Check file size:

```sh
wc -c < public/images/blog/SLUG-hero.jpg
```

If over 500,000 bytes, convert and resize using `sharp-cli` (cross-platform):

```sh
npx sharp-cli -i public/images/blog/SLUG-hero.jpg -o public/images/blog/SLUG-hero.webp --width 1200
```

Verify the conversion:

```sh
ls public/images/blog/SLUG-hero.webp
```

If `.webp` exists, set frontmatter `image` to `/images/blog/SLUG-hero.webp`.
If conversion failed or the original was under 500KB, keep the original file.

If the download fails, add to FAILED_IMAGES and omit `image` from frontmatter.

**Inline images:** For images embedded in the post body, download using the same
approach with a `SLUG-body-N.webp` naming pattern and replace the inline image
URLs with local paths.

### 2d — Assemble frontmatter and write the .mdoc file

Assemble frontmatter fields:
- `title`: from API/export/WebFetch
- `description`: from excerpt or WebFetch summary
- `publishDate`: in YYYY-MM-DD format
- `image`: local path after download, or omit
- `imageAlt`: derive from post title (e.g., "Hero image for [title]")
- `tags`: from categories/tags data, or `[]`
- `draft`: `false`
- `syndication`: `["ORIGINAL_POST_URL"]` — the URL on the old platform, preserving provenance per ADR-0006

Sanitize the slug before using as filename: lowercase, replace spaces with
hyphens, remove characters other than `[a-z0-9-]`, trim leading/trailing
hyphens. If the slug conflicts with an existing file, append `-imported`.

Write to `src/content/posts/SLUG.mdoc`:

```
---
title: "The Post Title"
description: "A one or two sentence summary of the post."
publishDate: "2024-03-15"
image: "/images/blog/my-post-hero.webp"
imageAlt: "Hero image for The Post Title"
tags: []
draft: false
syndication: ["https://www.oldsite.com/blog/the-post-slug"]
---

The full post body content in clean Markdown goes here.

## Subheadings use ## syntax

- Lists work as expected

Links look like [this](https://example.com).
```

Rules for the body content:
- No HTML tags — convert everything to Markdown equivalents
- No MDX component syntax — plain Markdown is sufficient for imported content
- No platform-specific shortcodes or embeds

### 2e — Progress updates

After every 5 posts, tell the owner:
> "Imported 10 of 23 posts so far — about halfway done."

## Step 2.5 — Newsletter subscriber migration

If PLATFORM is `ghost` or `substack`, offer newsletter migration after content
import is complete.

Tell the owner:
> "Your [Platform] site also has a newsletter with email subscribers. Would you
> like to set up a newsletter on your new site?"

Present the options:
> - **Use Ghost for newsletters** — I'll help you connect a Ghost instance so
>   you can send blog posts as emails to your subscribers. Recommended if you
>   already have a Ghost instance or want paid subscriptions.
> - **Use Buttondown** — A simple, privacy-focused newsletter service. Free for
>   up to 100 subscribers. I'll help you export and import your subscriber list.
> - **Skip for now** — You can set up a newsletter later.

Wait for the owner's answer.

### If they choose Ghost

Read `docs/platforms/ghost-newsletter.md` for setup details.

**Ghost → Ghost (same instance):** The subscribers are already in Ghost. Tell
the owner:
> "Your subscribers are already in Ghost, so there's nothing to migrate. I'll
> set up a signup form on the website that connects to your Ghost instance."

Ask for the Ghost Admin API URL and key. Add a newsletter signup form to the
website footer (see `docs/platforms/ghost-newsletter.md` → Website integration).
Update the CSP `form-action` in `public/_headers`.

**Substack → Ghost:** Tell the owner:
> "Ghost can import your Substack subscribers directly. In Ghost Admin, go to
> Settings → Advanced → Import/Export → Import, select 'Substack', and upload
> the ZIP file you exported from Substack (Dashboard → Settings → Exports).
> Ghost will import your subscribers automatically."

Walk them through the process. Then set up the signup form as above.

### If they choose Buttondown

Read `docs/platforms/buttondown.md` for setup details.

**Ghost → Buttondown:** Tell the owner:
> "I need your subscriber list from Ghost. In Ghost Admin, go to Members and
> click Export. Save the CSV file and tell me where it is."

Help them import the CSV into Buttondown (buttondown.email → Subscribers →
Import).

**Substack → Buttondown:** Tell the owner:
> "Buttondown can import from Substack directly. Go to buttondown.email →
> Settings → Importing and follow the Substack import flow. Or export your
> subscribers from Substack (Dashboard → Settings → Exports) and import the
> CSV manually."

Add the Buttondown signup form to the website footer. Update the CSP
`form-action` to allow `buttondown.email`.

### Store the newsletter choice

After setup, add the newsletter platform to `.site-config`:

```
NEWSLETTER_PLATFORM=ghost
NEWSLETTER_API_URL=https://newsletter.example.com
```

Or:

```
NEWSLETTER_PLATFORM=buttondown
```

Tell the owner:
> "Your newsletter is set up! When you publish a blog post and want to send it
> as an email, just let me know and I'll send it to your subscribers."

See `docs/newsletter-sending.md` for the sending workflow.

## Step 3 — Handle static pages

If the owner chose "Everything" in Step 1, process STATIC_PAGES.

**WordPress:** Page content is already available from the REST API (`content.rendered`).
Convert HTML to Markdown as in Step 2b.

**Squarespace (WXR):** Page content is in the XML export (`<content:encoded>`).
Note that Squarespace only exports text blocks — complex layouts (galleries,
forms, product grids) are not included in the export.

**All platforms (including fallback):** For pages without pre-fetched content,
use WebFetch with this prompt:
> "Look at this page and tell me:
> 1. The page title
> 2. Whether the page uses a platform feature that can't be statically exported
>    (booking/scheduling, e-commerce/store, event calendar, forum, member area,
>    contact form, image gallery with 10+ images). If so, name the feature.
> 3. A 1–3 sentence summary of the page's purpose and content
> 4. The full text content converted to clean Markdown (if it's a content page)"

Categorize each page:
- **App-powered**: uses booking, store, events, forum, members, or similar
  platform features that require runtime infrastructure
- **Gallery**: primarily an image gallery or portfolio (10+ images)
- **Content page**: regular text/image content

For **content pages**, create a `.astro` file in `src/pages/` with the page title,
meta description, `BaseLayout` wrapper, and the converted content. If the content
couldn't be fully extracted, add a `<!-- TODO: Review content from: PAGE_URL -->`
comment.

For **gallery pages**, add them to GALLERY_PAGES for processing in Step 4.

For **app-powered pages**, do NOT create a stub. Add to APP_PAGES for reporting
in Step 7. Do not try to replicate platform app functionality — booking, store,
and event features have industry-appropriate alternatives in `docs/platforms/`.

## Step 4 — Handle galleries and portfolios

If GALLERY_PAGES is empty, skip this step entirely.

For each gallery page, tell the owner:
> "I found a gallery with images on your [page name] page. Would you like me
> to download them all? I'll create a gallery page on your new site."

If they say yes:

Use WebFetch on the gallery page with this prompt:
> "List every image URL on this page. For each image, provide:
> 1. The full image URL (from the src attribute)
> 2. The alt text (if any)
> 3. Any caption or title text associated with the image"

Ensure the gallery image directory exists:

```sh
mkdir -p public/images/gallery
```

Download each image:

```sh
curl -L -s -o "public/images/gallery/PAGE-SLUG-NN.jpg" "IMAGE_URL"
```

Check file size and convert with `sharp-cli` if over 500KB (same as Step 2c).

Create a gallery `.astro` page in `src/pages/` with:
- The page title and meta description
- `BaseLayout` wrapper
- A responsive CSS grid layout displaying all downloaded images
- Each image using Astro's `<img>` tag with the local path and alt text
- A note that the owner can rearrange or edit in the source file

## Step 5 — Generate redirect mappings

Read the existing `public/_redirects` file. Append new rules — do not overwrite
existing entries.

The redirect pattern depends on the platform's URL structure:

**WordPress:** WordPress has multiple permalink structures. Use the actual URLs
from the API response (`link` field) to determine the pattern.

Common patterns:
```
# "Day and name" or "Month and name" permalinks
/YYYY/MM/DD/slug/ /blog/slug 301
/YYYY/MM/slug/ /blog/slug 301

# "Post name" permalink
/slug/ /blog/slug 301

# Default (query parameter)
/?p=123 /blog/slug 301
```

Generate a redirect for each post using the actual old URL path.

**Squarespace:**
```
/blog/slug /blog/slug 200
```

If old and new paths match, use `200` (passthrough). If they differ:
```
/old-path /blog/slug 301
```

**Wix:**
```
/post/slug /blog/slug 301
```

### Static page redirects

For pages where the old and new URL paths match, no redirect is needed.

For pages with different paths:
```
/old-path /new-path 301
```

For app-powered pages with no equivalent yet, use a temporary redirect:
```
/app-page / 302
```

Note the 302s in the output — they should be updated to 301s once the owner
sets up the replacement tool.

### Common platform paths

Add trailing-slash redirects as needed:
```
/blog/ /blog 301
```

Write the updated `_redirects` file, preserving all existing rules and comments.

## Step 6 — Build and verify

Tell the owner:
> "I'm checking that everything imported correctly."

```sh
npm run build
```

If the build fails, diagnose and fix. Common causes:
- Frontmatter doesn't match schema: check `src/content/config.ts` for expected fields
- Invalid `publishDate` format: must be YYYY-MM-DD string
- Missing required `description`: add a placeholder and note for review
- Image path typo: verify file exists in `public/images/`

Fix all build errors before presenting results (ADR-0012).

After a clean build, check for remaining external image dependencies:

```sh
grep -rE "wixstatic\.com|squarespace-cdn\.com|wp-content/uploads" dist/ --include="*.html"
```

If any references to the old platform's CDN appear in the built HTML, find the
source files and replace with locally downloaded images (ADR-0008, ADR-0011).

## Step 7 — Present the results

Give the owner a plain-English summary:

> "Your content has been imported! Here's what happened:
>
> **Blog posts:** 21 of 23 imported successfully
> **Images:** 19 downloaded and optimized
> **Redirects:** 27 redirect rules added
> **Pages created:** 4 (About, FAQ, Services, Contact)
>
> **A couple of things to know:**
> - 2 posts couldn't be fetched (listed below). You can add them manually
>   in Keystatic.
> - Your booking page used [Platform]'s scheduling tool. I've set up a
>   redirect for now — we can set up an alternative together.
>
> The site builds correctly and all the redirects are in place. Your search
> rankings should carry over once you publish.
>
> **One more thing:** This first pass focuses on getting all your content
> moved over accurately. The formatting and layout might not match your old
> site exactly — that's normal. Once you've had a chance to look through it,
> just let me know what you'd like adjusted and I'll make design tweaks
> until it looks right."

List FAILED_POSTS and FAILED_IMAGES so the owner knows what needs attention.

For each APP_PAGES entry, suggest a replacement:
- Booking/scheduling → "Cal.com or Calendly integrate well. See `docs/platforms/`."
- Store/e-commerce → "Square or Shopify work great. See `docs/platforms/`."
- Events → "I can build a custom events page for you."
- Contact form → "I can add a simple email link, or we can set up a form service."
- Forum/members → "This would need a separate platform — let's discuss options."

## Step 8 — Save a snapshot

```sh
git add -A
```

```sh
git commit -m "Import content from PLATFORM (N posts, N pages)"
```

Replace PLATFORM and N with actual values.

## Step 9 — Offer to deploy

Ask:
> "Would you like to publish the imported content now? I'll run the security
> check first. Or you can review it in Keystatic first — just type
> `/anglesite:deploy` when you're ready."

If they say yes, run `/anglesite:deploy`.

## Platform reference docs

Platform-specific import guides are in `docs/import/`. Each doc covers:
- How to detect the platform
- API/feed endpoints and authentication
- HTML structure and CDN URL patterns
- Content conversion notes
- Common issues and gotchas

See `docs/import/README.md` for the full index.

## Keep docs in sync

After this skill runs, update `docs/architecture.md` to note that content was
imported and the date. Example:
> "Content imported from [Platform] on YYYY-MM-DD. N posts, N pages. Redirects
> in `public/_redirects`."

## Edge cases

### No blog on the site

If BLOG_POSTS is empty after discovery:
> "Your website doesn't appear to have a blog. I can still import your pages
> and images, and set up redirects."

Continue with Steps 3–5 for pages, galleries, and redirects only.

### Images still too large after conversion

If the converted image is still over 500KB, do not block the import. After the import,
advise the owner:
> "Some images are still large after optimization. You can resize them in
> Preview or replace them with smaller versions."

### Multilingual content

If the sitemap or API contains content in multiple languages:
> "Your site has content in multiple languages. I'll import the primary language
> for now. Setting up multiple languages requires additional planning."

Import only primary-language content.

### Platform app pages

Booking, store, event, forum, and member pages cannot be meaningfully imported —
the content depends on the platform's runtime infrastructure. Redirect to home
(302) and present replacement options in Step 7.

### Slug conflicts

Before writing each `.mdoc` file, sanitize the slug (lowercase, hyphens only,
`[a-z0-9-]`). If it conflicts with an existing file, append `-imported` and log
the conflict.

### WordPress REST API is disabled

Some WordPress sites disable the REST API. If `/wp-json/` returns 403 or 401,
fall back to the RSS feed (`/feed/`) which usually contains full post content,
then use WebFetch for anything not in the feed.

### Squarespace images disappear after cancellation

Warn the owner before they cancel their Squarespace subscription:
> "Important: the images on your Squarespace site will stop being available
> after you cancel your subscription. Make sure I've downloaded everything
> before you cancel. Let me verify all images are saved locally."

Run the build verification (Step 6) to confirm no external image URLs remain.

### WordPress custom post types

Some WordPress sites use custom post types (portfolios, testimonials, products).
The REST API may expose these at `/wp-json/wp/v2/TYPE_NAME`. If the categories
or tags response mentions custom taxonomies, probe for custom endpoints. Report
any custom post types to the owner and ask how they'd like to handle them.
