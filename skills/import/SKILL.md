---
name: import
description: "Import content from a Wix website into this Astro site"
argument-hint: "[Wix site URL]"
allowed-tools: ["WebFetch", "Bash(curl *)", "Bash(sips *)", "Bash(mkdir *)", "Bash(npm run build)", "Bash(git add *)", "Bash(git commit *)", "Bash(ls *)", "Bash(wc *)", "Bash(grep *)", "Bash(find src/content/posts *)", "Bash(find public/images/blog *)", "Write", "Read", "Glob", "Edit"]
disable-model-invocation: true
---

Import blog posts and pages from a Wix website. Migrates content into the site's
Markdoc collection, downloads and optimizes images, and generates redirect mappings
so existing links and search rankings are preserved.

## Architecture decisions

- [ADR-0002 Keystatic CMS](docs/decisions/0002-keystatic-local-cms.md) — content lands as `.mdoc` files in `src/content/posts/`, the same format Keystatic edits
- [ADR-0006 IndieWeb POSSE](docs/decisions/0006-indieweb-posse.md) — imported posts get `syndication` URLs pointing back to their Wix originals so the provenance trail is preserved
- [ADR-0008 No third-party JS](docs/decisions/0008-no-third-party-javascript.md) — Wix tracking scripts, embedded iframes, and widget code must be stripped during import
- [ADR-0011 Owner ownership](docs/decisions/0011-owner-controls-everything.md) — imported content must not depend on Wix to display correctly
- [ADR-0012 Verify first](docs/decisions/0012-verify-before-presenting.md) — build must pass after import before presenting results to the owner

Before every tool call or command that will trigger a permission prompt, explain
what you're about to do and why. The owner is non-technical.

## Step 0 — Prerequisites

Read `src/content/config.ts` to confirm the project has been scaffolded. If the
file does not exist, stop and tell the owner:

> "It looks like the site hasn't been set up yet. Run `/anglesite:start` first
> to create the project, then come back to import your Wix content."

Read `.site-config` to load `SITE_NAME` and `OWNER_NAME`.

Ask the owner for their Wix site URL if they didn't provide one as an argument.
Accept a custom domain (`https://www.example.com`) or a Wix subdomain
(`https://name.wixsite.com/mysite`). Normalize the URL: strip trailing slashes,
ensure `https://` scheme. Store as WIX_URL throughout.

## Step 1 — Discover the content inventory

Tell the owner:
> "I'm going to look at your Wix website to see what content is there. This
> takes about a minute."

### 1a — Fetch and parse the sitemap

```sh
curl -s WIX_URL/sitemap.xml
```

Parse the response to find child sitemap URLs. Wix typically returns:
- `WIX_URL/blog-posts-sitemap.xml`
- `WIX_URL/pages-sitemap.xml`

If the root sitemap is empty or returns non-XML, try fetching each child directly.

```sh
curl -s WIX_URL/blog-posts-sitemap.xml
curl -s WIX_URL/pages-sitemap.xml
```

From the blog posts sitemap, extract each post's `<loc>` URL, slug (the path
segment after `/post/`), and `<lastmod>` date.

From the pages sitemap, extract each page's `<loc>` URL and path.

Filter out Wix system pages. Skip URLs containing: `/blank`, `/_api`, `/apps/`,
`/#`, `?`, `/_partials`.

Build two lists:
- **BLOG_POSTS**: `{ url, slug, lastmod }` for each post
- **STATIC_PAGES**: `{ url, path }` for each page

### 1b — Fetch the RSS feed for blog metadata

```sh
curl -s WIX_URL/blog-feed.xml
```

For each `<item>`, extract:
- `<title>` → title
- `<pubDate>` → publication date (convert to YYYY-MM-DD)
- `<description>` → excerpt (strip HTML tags for the `description` field)
- `<enclosure url="...">` → hero image URL
- `<dc:creator>` → author name (informational)
- `<link>` → match to BLOG_POSTS by URL

The RSS feed may not include all posts (typically 20–50). Track which posts have
RSS metadata and which need individual fetching.

### 1c — Check for existing content

```sh
find src/content/posts -name "*.mdoc" -type f
```

If `.mdoc` files exist, note their slugs and tell the owner:
> "I found [N] existing posts. If any Wix posts have the same slug, I'll skip
> them rather than overwrite."

Build a SKIPPED_SLUGS set from existing filenames.

### 1d — Present the inventory

Tell the owner what was found. Example:

> "Here's what I found on your Wix site:
>
> **Blog posts:** 23 posts (July 2024 – February 2026)
> **Pages:** 6 pages (About, FAQ, Services, Contact, Gallery, Get Involved)
>
> I'll import all the blog posts and create placeholder pages for the static
> pages. The import will take about 5–10 minutes for a blog this size."

If BLOG_POSTS is empty, skip to Step 3 for static pages only (see edge cases).

Ask:
> "Would you like to import all of it, or just the blog posts?"
> - **Everything** — import posts + create page stubs + redirects (recommended)
> - **Blog posts only** — skip static pages

Wait for their answer before continuing.

## Step 2 — Import blog posts

Tell the owner:
> "I'm importing your blog posts now. Each one needs to be fetched individually
> from Wix, so this will take a few minutes. I'll keep you posted."

Ensure the image directory exists:

```sh
mkdir -p public/images/blog
```

Process each post in BLOG_POSTS that is not in SKIPPED_SLUGS.

### 2a — Fetch the full post content

Use WebFetch on the post URL with this prompt:

> "Extract the full blog post content from this Wix page. Return:
> 1. The post title (from the main heading, not browser title)
> 2. The publication date in YYYY-MM-DD format
> 3. The full body content converted to clean Markdown. Remove navigation,
>    headers, footers, sidebars, comments, social share buttons, and any Wix
>    widget content. Keep headings, paragraphs, lists, blockquotes, and inline
>    links. Convert embedded images to Markdown image syntax with their src URLs.
>    Strip tracking links and JavaScript event handlers.
> 4. A 1–2 sentence description suitable for a meta description
> 5. Any tags or categories shown on the page"

If WebFetch returns an error or empty content, add the post to FAILED_POSTS and
continue. Do not stop the import for individual failures.

### 2b — Assemble frontmatter

- `title`: from WebFetch, or from RSS feed as fallback
- `description`: from WebFetch, or stripped RSS excerpt
- `publishDate`: from WebFetch, RSS `<pubDate>`, or sitemap `<lastmod>` (YYYY-MM-DD)
- `image`: set after image download (step 2c), or omit
- `imageAlt`: derive from the post title (e.g., "Hero image for [title]")
- `tags`: from WebFetch if available, otherwise `[]`
- `draft`: `false`
- `syndication`: `["WIX_POST_URL"]` — the original Wix URL, preserving provenance per ADR-0006

### 2c — Download and optimize the hero image

If the RSS feed or WebFetch result contains a hero image URL (typically from
`static.wixstatic.com`):

Tell the owner (once, not per-post):
> "I'm downloading images from your Wix site and converting them to a
> web-friendly format."

Strip Wix transform parameters from the image URL. Everything from `/v1/` onward
or any query string should be removed to get the base URL. Append `?w=1200` to
request a reasonable size.

```sh
curl -L -s -o "public/images/blog/SLUG-hero.jpg" "IMAGE_URL"
```

Check file size:

```sh
wc -c < public/images/blog/SLUG-hero.jpg
```

If over 500,000 bytes, convert and resize using the macOS built-in `sips` tool:

```sh
sips -s format webp -Z 1200 public/images/blog/SLUG-hero.jpg --out public/images/blog/SLUG-hero.webp
```

Verify the conversion:

```sh
ls public/images/blog/SLUG-hero.webp
```

If `.webp` exists, set frontmatter `image` to `/images/blog/SLUG-hero.webp`.
If conversion failed or the original was under 500KB, keep the JPEG.

If the image download itself fails, add to FAILED_IMAGES and omit the `image`
field from frontmatter.

For images embedded in the post body, download them using the same approach with
a `SLUG-body-N.webp` naming pattern and replace inline image URLs with local paths.

### 2d — Write the .mdoc file

Write to `src/content/posts/SLUG.mdoc`. Format:

```
---
title: "The Post Title"
description: "A one or two sentence summary of the post."
publishDate: "2024-03-15"
image: "/images/blog/my-post-hero.webp"
imageAlt: "Hero image for The Post Title"
tags: []
draft: false
syndication: ["https://www.example.com/post/the-post-slug"]
---

The full post body content in Markdown goes here.

## Subheadings use ## syntax

- Lists work as expected

Links look like [this](https://example.com).
```

Rules for the body content:
- No HTML tags. Strip remaining `<div>`, `<span>`, `<br>`, `<p>` and convert to
  Markdown equivalents.
- No MDX component syntax. Markdoc uses `{% %}` tags, but plain Markdown is
  sufficient for imported content.
- Sanitize the slug before using as filename: lowercase, replace spaces with
  hyphens, remove characters other than `[a-z0-9-]`, trim leading/trailing
  hyphens. If the slug conflicts with an existing file, append `-imported`.

### 2e — Progress updates

After every 5 posts, tell the owner:
> "Imported 10 of 23 posts so far — about halfway done."

## Step 3 — Handle static pages

If the owner chose "Everything" in Step 1, process STATIC_PAGES.

For each page, use WebFetch with this prompt:
> "Look at this Wix page and tell me:
> 1. The page title
> 2. Whether the page uses a Wix app (Booking, Stores, Events, Forum, Members).
>    If so, name the app.
> 3. A 1–3 sentence summary of the page's purpose and content
> 4. The primary sections or content blocks on the page"

Categorize each page:
- **App-powered**: uses Wix Booking, Stores, Events, Forum, or Members
- **Content page**: regular text/image content

For content pages, create a stub `.astro` file in `src/pages/` with:
- The page title and meta description
- `BaseLayout` wrapper
- A `<!-- TODO: Fill in content from Wix page: PAGE_URL -->` comment

For app-powered pages, do NOT create a stub. Add to APP_PAGES for reporting in
Step 6. Do not try to replicate Wix app functionality — booking pages, store
pages, and event calendars have industry-appropriate alternatives in
`docs/platforms/`.

## Step 4 — Generate redirect mappings

Read the existing `public/_redirects` file. Append new rules — do not overwrite
existing entries.

### Blog post redirects

For each imported post:
```
/post/SLUG /blog/SLUG 301
```

Wix blog URLs use `/post/SLUG`. The new site uses `/blog/SLUG`.

### Static page redirects

For pages where the URL path stays the same (e.g., `/about`), no redirect needed.

For pages with different URL structures or app pages being replaced:
```
/old-path /new-path 301
```

For app-powered pages with no equivalent yet, use a temporary redirect:
```
/wix-app-page / 302
```

Note the 302s in the output — they should be updated to 301s once the owner
sets up the replacement tool.

### Common Wix system paths

Add these regardless of what was in the sitemap:
```
/blog/ /blog 301
```

Write the updated `_redirects` file, preserving all existing rules.

## Step 5 — Build and verify

Tell the owner:
> "I'm checking that everything imported correctly."

```sh
npm run build
```

If the build fails, diagnose and fix. Common causes:
- Frontmatter doesn't match schema: check `src/content/config.ts` for expected fields
- Invalid `publishDate` format: must be YYYY-MM-DD string
- Missing required `description`: add a placeholder and note for review
- Image path typo: verify file exists in `public/images/blog/`

Fix all build errors before presenting results (ADR-0012).

After a clean build, check for remaining Wix dependencies:

```sh
grep -r "wixstatic.com" dist/ --include="*.html"
```

If any `wixstatic.com` references appear in the built HTML, find the source files
and replace with locally downloaded images (ADR-0008).

## Step 6 — Present the results

Give the owner a plain-English summary:

> "Your content has been imported! Here's what happened:
>
> **Blog posts:** 21 of 23 imported successfully
> **Images:** 19 downloaded and optimized
> **Redirects:** 21 redirect rules added
> **Page stubs created:** 4 (About, FAQ, Services, Contact)
>
> **A couple of things to know:**
> - 2 posts couldn't be fetched from Wix (listed below). You can add them
>   manually in Keystatic.
> - Your FAQ page used Wix's form tool. I've set up a redirect to the home
>   page for now — we can build a replacement together.
>
> The site builds correctly and all the redirects are in place."

List FAILED_POSTS and FAILED_IMAGES so the owner knows what needs attention.

For each APP_PAGES entry, suggest a replacement:
- Wix Booking → "For scheduling, Cal.com or Calendly integrate well. See `docs/platforms/`."
- Wix Stores → "For selling products, Square or Shopify work great. See `docs/platforms/`."
- Wix Events → "I can build a custom events page for you."

## Step 7 — Save a snapshot

```sh
git add -A
```

```sh
git commit -m "Import content from Wix (N posts, N pages)"
```

Replace N with actual counts.

## Step 8 — Offer to deploy

Ask:
> "Would you like to publish the imported content now? I'll run the security
> check first. Or you can review it in Keystatic first — just type
> `/anglesite:deploy` when you're ready."

If they say yes, run `/anglesite:deploy`.

## Keep docs in sync

After this skill runs, update `docs/architecture.md` to note that content was
imported from Wix and the date. Example:
> "Content imported from Wix on YYYY-MM-DD. N posts, N pages. Redirects in
> `public/_redirects`."

## Edge cases

### No blog on the Wix site

If BLOG_POSTS is empty after fetching the sitemap and RSS:
> "Your Wix site doesn't appear to have a blog. I can still create page stubs
> for your static pages and set up redirects."

Continue with Steps 3–4 for static pages only.

### Images still too large after conversion

If `sips` output is still over 500KB, do not block the import. After the import,
advise the owner:
> "Some images are still large after optimization. You can resize them in
> Preview or replace them with smaller versions."

### Multilingual content

If the sitemap contains URLs with language path segments (`/es/`, `/fr/`, etc.):
> "Your Wix site has content in multiple languages. I'll import the primary
> language for now. Setting up multiple languages requires additional planning."

Import only primary-language URLs (no language prefix).

### Wix app pages

Booking, store, event, forum, and member pages cannot be imported — the content
is generated at runtime by Wix's infrastructure. Redirect to home (302) and
present replacement options in Step 6.

### Slug conflicts

Before writing each `.mdoc` file, sanitize the slug (lowercase, hyphens only,
`[a-z0-9-]`). If it conflicts with an existing file, append `-imported` and log
the conflict.
