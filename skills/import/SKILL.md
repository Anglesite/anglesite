---
name: import
description: "Import content from a website URL (WordPress, Squarespace, Wix, Webflow, GoDaddy, Ghost, Medium, Substack, Blogger, Shopify, Weebly, Tumblr, Micro.blog, WriteFreely, Carrd) or static site generator project"
argument-hint: "[website URL or local path]"
allowed-tools: ["WebFetch", "Bash(curl *)", "Bash(npx sharp-cli *)", "Bash(mkdir *)", "Bash(npm run build)", "Bash(npm install)", "Bash(zsh *)", "Bash(git add *)", "Bash(git commit *)", "Bash(git push *)", "Bash(ls *)", "Bash(wc *)", "Bash(grep *)", "Bash(find src/content/posts *)", "Bash(find public/images *)", "Bash(find */images *)", "Bash(find */public *)", "Bash(find */static *)", "Bash(find */source *)", "Bash(find */content *)", "Bash(find */docs *)", "Bash(find */_posts *)", "Bash(cp *)", "Write", "Read", "Glob", "Edit"]
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

Before reading the platform-specific doc, read `${CLAUDE_PLUGIN_ROOT}/docs/import/hosted-platforms.md`
for HTML-to-Markdown conversion rules, image CDN handling, pagination patterns,
missing field fallbacks, and redirect best practices.

The platform-specific docs (`${CLAUDE_PLUGIN_ROOT}/docs/import/PLATFORM.md`) cover only what's unique
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

- [ADR-0002 Keystatic CMS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0002-keystatic-local-cms.md) — content lands as `.mdoc` files in `src/content/posts/`, the same format Keystatic edits
- [ADR-0006 IndieWeb POSSE](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0006-indieweb-posse.md) — imported posts get `syndication` URLs pointing back to their originals so the provenance trail is preserved
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — tracking scripts, embedded iframes, and widget code must be stripped during import
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — imported content must not depend on the old platform to display correctly
- [ADR-0012 Verify first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0012-verify-before-presenting.md) — build must pass after import before presenting results to the owner

Before every tool call or command that will trigger a permission prompt, explain
what you're about to do and why. The owner is non-technical.

## Pre-migration education

Before starting the import, surface the migration education prompts from `${CLAUDE_PLUGIN_ROOT}/docs/education-prompts.md` section 7 ("Migration Flow"). Check `.site-config` for each `EDUCATION_<KEY>=shown` flag before surfacing. Share `THEME_OWNERSHIP`, `PRUNING`, and `PLATFORM_DESIGN` — frame as "a few things worth knowing before we start." Tailor the `THEME_OWNERSHIP` and `PLATFORM_DESIGN` copy to the detected platform name (e.g., "WordPress," "Squarespace"). Write the flags to `.site-config` after.

## Step 0 — Get the URL and check the project

### 0a — Get the URL

Ask the owner for their website URL if they didn't provide one as an argument.
The URL is the primary input — ask for it first before anything else.

Normalize: strip trailing slashes, ensure `https://`. Store as SITE_URL.

### 0b — Is this already an Anglesite project?

Use Glob to check for `src/content.config.ts`.

If it exists, this project has already been scaffolded. Read `.site-config` to
load `SITE_NAME` and `OWNER_NAME`. Skip to Step 1.

### 0c — Scaffold if needed

If `src/content.config.ts` does not exist, check the working directory:

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

Ask: "What's your name?" (The site name will be detected from the homepage in
Step 3a, so no need to ask for it now.)

Save to `.site-config` using the **Write tool**:

```
SITE_TYPE=blog
OWNER_NAME=Name
SITE_NAME=My Site
DEV_HOSTNAME=mysite.local
AI_MODEL=(write your actual model name here)
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

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/ghost.md` for platform-specific extraction details.

**Blogger** — check for the Atom feed:

```sh
curl -s -o /dev/null -w "%{http_code}" SITE_URL/feeds/posts/default
```

Also check for `.blogspot.com` in the URL or `<meta name="generator" content="Blogger"/>`.
If detected, tell the owner:
> "Your site is on Blogger. Blogger has great export options — I can read
> everything directly from its feed."

Read `${CLAUDE_PLUGIN_ROOT}/docs/import/blogger.md` for platform-specific extraction details.

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

For each detected platform, read the corresponding doc from `${CLAUDE_PLUGIN_ROOT}/docs/import/`:

| Platform | Detection signals | Doc reference |
| --- | --- | --- |
| Squarespace | `squarespace` in scripts/meta, `squarespace-cdn.com` | `${CLAUDE_PLUGIN_ROOT}/docs/import/squarespace.md` |
| Wix | `wix` or `Thunderbolt` in source, `wixstatic.com` | `${CLAUDE_PLUGIN_ROOT}/docs/import/wix.md` |
| Shopify | `cdn.shopify.com`, `/collections/`, `/products/` | `${CLAUDE_PLUGIN_ROOT}/docs/import/shopify.md` |
| Medium | `miro.medium.com`, `.medium.com` domain | `${CLAUDE_PLUGIN_ROOT}/docs/import/medium.md` |
| Substack | `substackcdn.com`, `.substack.com` domain | `${CLAUDE_PLUGIN_ROOT}/docs/import/substack.md` |
| Weebly | `cdnjs.weebly.com`, "Powered by Weebly" | `${CLAUDE_PLUGIN_ROOT}/docs/import/weebly.md` |
| Tumblr | `media.tumblr.com`, `.tumblr.com` domain | `${CLAUDE_PLUGIN_ROOT}/docs/import/tumblr.md` |
| Webflow | `data-wf-site`, `assets.website-files.com` | `${CLAUDE_PLUGIN_ROOT}/docs/import/webflow.md` |
| GoDaddy | `img1.wsimg.com`, `secureservercdn.net` | `${CLAUDE_PLUGIN_ROOT}/docs/import/godaddy.md` |
| Carrd | `static.carrd.co`, `.carrd.co` domain | `${CLAUDE_PLUGIN_ROOT}/docs/import/carrd.md` |
| Micro.blog | `micro.blog`, micropub endpoint | `${CLAUDE_PLUGIN_ROOT}/docs/import/microblog.md` |
| WriteFreely | `writefreely` generator, `.write.as` domain | `${CLAUDE_PLUGIN_ROOT}/docs/import/writefreely.md` |

Tell the owner what platform was detected and read the platform doc for
extraction instructions. For unknown platforms, tell the owner:
> "I'm not sure what platform your site uses, but I can still import the content
> by reading each page. It just takes a bit longer."

Store the detected platform as PLATFORM.

### 1b — Platform-specific content discovery

Read `${CLAUDE_PLUGIN_ROOT}/skills/import/content-discovery.md` and follow the
instructions for the detected PLATFORM. Build BLOG_POSTS and STATIC_PAGES from
the results.

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
> I'll import all the blog posts, extract the content from each page, and
> set up redirects so your search rankings carry over. The import will take
> about 5–10 minutes for a blog this size."

If BLOG_POSTS is empty, tell the owner — skip to Step 3 for pages only, or
Step 4 if image galleries were detected.

Import everything by default — posts, pages, images, and redirects. Do not
prompt the owner to choose a scope. The whole point of `/anglesite:import` is
to import the entire website. If the owner wants to remove something afterward,
they can delete it.

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

**Squarespace (RSS fallback):** The RSS feed URL is `COLLECTION_URL?format=rss`
where COLLECTION_URL is the blog collection path discovered in Step 1b (not
always `/blog` — may be `/news`, `/journal`, or any custom path). For posts in
the RSS feed, use the `<description>` or `<content:encoded>` field. For posts
NOT in the RSS feed (older than the most recent 10–20), use WebFetch on the
post URL with the extraction prompt below.

**Wix:** Use Playwright to extract content and design tokens. WebFetch does
not work on Wix pages.

Before the first extraction, check if Playwright is installed and offer to
install it if not:

```sh
npm ls playwright
```

If not installed, tell the owner:
> "I can extract your site's colors and fonts automatically, but I need to
> install a browser tool first (~150 MB). Want me to install it?"

If yes:

```sh
npm install playwright
npx playwright install chromium
```

If they decline, skip to the curl + regex fallback below (content only, no
design tokens).

For each post:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-playwright.mjs "POST_URL"
```

Returns `{tokens, content}` where `content` has `{body, images, title, navLinks}`.
On the **first page** (homepage), save the `tokens` object — it contains
`--color-primary`, `--color-bg`, `--font-heading`, etc. that seed `global.css`.
For subsequent pages, use `--content-only` to skip redundant style extraction.

If Playwright fails on a specific page (timeout, crash), fall back to curl +
regex for that page only:

```sh
curl -sL "POST_URL" > /tmp/wix-post.html
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-extract.mjs post /tmp/wix-post.html
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-extract.mjs meta /tmp/wix-post.html
```

If extraction returns empty content from either method, add the post to
FAILED_POSTS and continue. Do not stop the import for individual failures.

**Unknown platforms:** Use WebFetch on each post URL with this prompt:

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

For WordPress and Squarespace content that arrives as rendered HTML, follow the
HTML-to-Markdown conversion rules in
`${CLAUDE_PLUGIN_ROOT}/docs/content-conversion.md`.

### 2c — Download and optimize images

Tell the owner (once, not per-post):
> "I'm downloading images from your website and converting them to a
> web-friendly format."

Follow the image optimization procedures in
`${CLAUDE_PLUGIN_ROOT}/docs/content-conversion.md`, using `curl -L -s`
to download instead of `cp`.

**Platform-specific image URL handling:**
- WordPress: `source_url` from the media API response — use as-is
- Squarespace: `images.squarespace-cdn.com` URLs — strip `?format=NNNw` if NNN < 1200; replace with `?format=2500w` or remove the param
- Wix: `static.wixstatic.com` URLs — strip transform parameters from `/v1/` onward, append `?w=1200`

If the download fails, add to FAILED_IMAGES and omit `image` from frontmatter.

**Inline images:** Download with `SLUG-body-N.webp` naming and replace inline
URLs with local paths.

### 2d — Assemble frontmatter and write the .mdoc file

Follow the `.mdoc` writing procedure in
`${CLAUDE_PLUGIN_ROOT}/docs/content-conversion.md`. Use `-imported`
suffix for slug conflicts. Additionally, set:
- `syndication`: `["ORIGINAL_POST_URL"]` — the URL on the old platform, preserving provenance per ADR-0006

### 2e — Progress updates

After every 5 posts, tell the owner progress (see shared procedures).

## Step 2.5 — Newsletter subscriber migration

If PLATFORM is `ghost` or `substack`, read
`${CLAUDE_PLUGIN_ROOT}/skills/import/newsletter-migration.md` and follow the
instructions to offer newsletter migration.

## Step 3 — Handle static pages

Process STATIC_PAGES.

### 3a — Extract homepage branding

Before processing individual pages, extract site-wide branding from the homepage.
Use WebFetch on SITE_URL with this prompt:

> "Look at this website's homepage and extract:
> 1. The site name or business name (from the logo, header, or `<title>` tag)
> 2. The tagline or slogan (if visible)
> 3. A description of the logo (if there's an image logo, describe it and provide its URL)
> 4. The primary brand colors used (header background, accent buttons, link colors — give hex codes if possible)
> 5. The main navigation links: for each link, give the visible text and the URL it points to
> 6. The full text content of the homepage converted to clean Markdown"

Store the navigation links as NAV_LINKS. Update `.site-config` with the
site name if it differs from the scaffolded default. Note the brand colors for
later use in theming.

### 3b — Extract content from every page

**Every page in STATIC_PAGES must have its content extracted.** Do not create
empty stubs or placeholder pages. Use the best available source:

**WordPress:** Page content is already available from the REST API (`content.rendered`).
Convert HTML to Markdown as in Step 2b.

**Squarespace (WXR):** Page content is in the XML export (`<content:encoded>`).
Note that Squarespace only exports text blocks — complex layouts (galleries,
forms, product grids) are not included in the export.

**Wix:** Use Playwright (styles were already extracted from the homepage in
Step 2a, so use `--content-only` here):

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-playwright.mjs "PAGE_URL" --content-only
```

If Playwright fails on a specific page, fall back to curl + regex for that page:

```sh
curl -sL "PAGE_URL" > /tmp/wix-page.html
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-extract.mjs page /tmp/wix-page.html
```

Both methods strip navigation and footer boilerplate automatically.

**All other platforms and any page without pre-fetched content:** WebFetch is
mandatory. This includes Weebly, GoDaddy, Carrd, Webflow without API,
Squarespace without export, and any platform where RSS was the primary blog
extraction source (RSS never contains static pages).

Use WebFetch on each page URL with this prompt:
> "Look at this page and tell me:
> 1. The page title
> 2. Whether the page uses a platform feature that can't be statically exported
>    (booking/scheduling, e-commerce/store, event calendar, forum, member area,
>    contact form, image gallery with 10+ images). If so, name the feature.
> 3. A 1–3 sentence summary of the page's purpose and content
> 4. The full text content converted to clean Markdown (if it's a content page).
>    Include all headings, paragraphs, lists, images (with src URLs), and links.
>    Remove navigation, headers, footers, sidebars, and platform chrome."

### 3c — Categorize and create pages

Categorize each page:
- **App-powered**: uses booking, store, events, forum, members, or similar
  platform features that require runtime infrastructure
- **Gallery**: primarily an image gallery or portfolio (10+ images)
- **Content page**: regular text/image content

**Wix slug renaming:** Before creating the file, check whether the Wix URL slug
is an opaque auto-generated placeholder (e.g., `general-5`, `page-3`, `blank-1`).
Use the `resolvePageSlug` utility from `wix-extract.mjs`:

```sh
node -e "
  import { resolvePageSlug } from '${CLAUDE_PLUGIN_ROOT}/scripts/import/wix/wix-extract.mjs';
  console.log(JSON.stringify(resolvePageSlug('WIX_SLUG', 'PAGE_TITLE')));
"
```

If `resolvePageSlug` returns a different slug, use the new slug for the filename
and page path. Add the returned redirect line to REDIRECT_RULES for Step 5.

For **content pages**, create a `.astro` file in `src/pages/` with:
- The page title in a `<title>` tag and `<h1>`
- A meta description derived from the page summary
- `BaseLayout` wrapper
- The full converted content from WebFetch or the API

If WebFetch returned an error or empty content for a specific page, retry once.
If it still fails, create the page with a `<!-- TODO: Review content from:
PAGE_URL -->` comment and add to FAILED_PAGES. Do not leave content pages empty
when WebFetch can extract them.

For **gallery pages**, add them to GALLERY_PAGES for processing in Step 4.

For **app-powered pages**, do NOT create a stub. Add to APP_PAGES for reporting
in Step 7. Do not try to replicate platform app functionality — booking, store,
and event features have industry-appropriate alternatives in `${CLAUDE_PLUGIN_ROOT}/docs/platforms/`.

### 3d — Create the homepage

If the homepage content was extracted in Step 3a, create or update `src/pages/index.astro`
with the actual homepage content instead of the default scaffolded placeholder.
Use `BaseLayout`, include the site name as a heading, and convert the extracted
content to Astro-compatible HTML.

Download any hero images or logos found on the homepage to `public/images/` using
the same optimization pipeline as Step 2c.

### 3e — Generate navigation

Build the site navigation from NAV_LINKS (extracted in Step 3a). For each link:
- If the URL points to an imported page, use the local path (e.g., `/about`)
- If the URL points to an app-powered page, keep it but mark with a comment
- If the URL is external, keep the full URL

Update the navigation component in the site layout. Look for the nav element in
`src/layouts/BaseLayout.astro` or the equivalent layout file and replace the
default navigation links with the imported ones.

If NAV_LINKS is empty (WebFetch couldn't extract navigation), build navigation
from the STATIC_PAGES list — create a link for each content page that was
successfully imported.

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

Squarespace blog URLs depend on the collection name and permalink format. The
collection may not be `/blog` — it could be `/news`, `/journal`, etc. Some sites
use date-based URLs like `/news/YYYY/M/slug`. Use the actual URLs from the RSS
feed or WXR export.

```
# Same path (collection is already /blog)
/blog/slug /blog/slug 200

# Different collection name
/news/slug /blog/slug 301

# Date-based URLs
/news/2026/3/slug /blog/slug 301
```

If old and new paths match, use `200` (passthrough). If they differ, use `301`.

**Wix:**
```
/post/slug /blog/slug 301
```

### Static page redirects

For pages where the old and new URL paths match, no redirect is needed.

For pages with different paths (including opaque Wix slugs renamed in Step 3c):
```
/old-path /new-path 301
```

Include any redirect rules generated by `resolvePageSlug` in Step 3c. These
handle opaque Wix slugs like `general-5` that were renamed to match page titles.

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

## Step 5.5 — Apply design tokens (Playwright only)

If Playwright was used and design tokens were extracted from the homepage in
Step 2a, apply them to `src/styles/global.css`:

1. Read the current `global.css`
2. For each non-null token from the Playwright output, replace the corresponding
   CSS custom property value:
   - `--color-primary`, `--color-accent`, `--color-bg`, `--color-text`, `--color-muted`
   - `--font-heading`, `--font-body`
3. Write the updated file

Tell the owner:
> "I extracted your site's brand colors and fonts from the original design:
>
> **Colors:** primary [hex], accent [hex], background [hex]
> **Fonts:** headings in [font], body text in [font]
>
> These have been applied to your new site's stylesheet."

If Playwright failed on the homepage and no tokens were captured, skip this
step. The owner can set up colors and fonts later via `/anglesite:design-interview`.

## Step 6 — Build and verify

Follow the build-and-verify procedure in
`${CLAUDE_PLUGIN_ROOT}/docs/content-conversion.md`.

After a clean build, also check for remaining external image dependencies:

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
> **Pages imported:** 4 with full content (About, FAQ, Services, Contact)
> **Homepage:** Updated with your actual content and branding
> **Navigation:** Set up with links to all your pages
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

List FAILED_POSTS, FAILED_PAGES, and FAILED_IMAGES so the owner knows what needs attention.

For each APP_PAGES entry, suggest a replacement:
- Booking/scheduling → "Cal.com or Calendly integrate well. See `${CLAUDE_PLUGIN_ROOT}/docs/platforms/`."
- Store/e-commerce → "Square or Shopify work great. See `${CLAUDE_PLUGIN_ROOT}/docs/platforms/`."
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

Read `GITHUB_REPO` from `.site-config`. If set, push to GitHub:

```sh
git push origin draft
```

If the push fails, log the issue but don't block the import.

## Step 9 — Offer to deploy

Ask:
> "Would you like to publish the imported content now? I'll run the security
> check first. Or you can review it in Keystatic first — just type
> `/anglesite:deploy` when you're ready."

If they say yes, run `/anglesite:deploy`.

## Platform reference docs

Platform-specific import guides are in `${CLAUDE_PLUGIN_ROOT}/docs/import/`. Each doc covers:
- How to detect the platform
- API/feed endpoints and authentication
- HTML structure and CDN URL patterns
- Content conversion notes
- Common issues and gotchas

See `${CLAUDE_PLUGIN_ROOT}/docs/import/README.md` for the full index.

## Keep docs in sync

After this skill runs, update `docs/architecture.md` to note that content was
imported and the date. Example:
> "Content imported from [Platform] on YYYY-MM-DD. N posts, N pages. Redirects
> in `public/_redirects`."

## Edge cases

See `${CLAUDE_PLUGIN_ROOT}/docs/content-conversion.md` for shared edge
cases (large images, multilingual content, slug conflicts).

### No blog on the site

If BLOG_POSTS is empty after discovery:
> "Your website doesn't appear to have a blog. I can still import your pages
> and images, and set up redirects."

Continue with Steps 3–5 for pages, galleries, and redirects only.

### Platform app pages

Booking, store, event, forum, and member pages cannot be meaningfully imported —
the content depends on the platform's runtime infrastructure. Redirect to home
(302) and present replacement options in Step 7.

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
