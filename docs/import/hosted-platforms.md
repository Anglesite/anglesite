# Shared Guidance: Hosted Platform Imports

This document covers principles and techniques common to all hosted platform imports (WordPress, Squarespace, Wix, Webflow, GoDaddy, Ghost, Medium, Substack, Blogger, Shopify, Weebly, Tumblr, Micro.blog, WriteFreely, Carrd). Read this first, then read the platform-specific doc for extraction details.

## Extraction method hierarchy

Every hosted platform import follows the same preference order. Use the best available method — don't fall back unless the better option fails or isn't available.

1. **Structured API** (WordPress REST, Ghost Content API, Webflow CMS API, Tumblr API, WriteFreely API, Micro.blog API) — Returns JSON with typed fields. Cleanest extraction, easiest to paginate, best metadata. Always prefer when available.
2. **Structured export file** (WordPress WXR XML, Squarespace WXR, Ghost JSON export, Substack ZIP, Blogger XML backup, Micro.blog ZIP) — Complete snapshot of the site's content. Requires owner action to generate but captures everything including drafts.
3. **RSS/Atom/JSON Feed** (available on most platforms) — Contains full or partial HTML content. Usually limited to recent posts (10–100). Good fallback when no API access.
4. **Playwright browser extraction** (Wix) — Launches a headless browser to extract both content and computed CSS styles (colors, fonts, spacing) in one pass. Playwright is a required dependency. See `scripts/import/wix/wix-playwright.js`.
5. **Bundled regex extraction scripts** (Wix per-page fallback) — If Playwright fails on a specific page, falls back to parsing Wix's SSR'd HTML with `curl` + regex. Content only, no styling. See `scripts/import/wix/wix-extract.js`.
6. **WebFetch page-by-page** (always available as last resort) — Reads the rendered page and extracts content. Slowest, lowest fidelity, but works everywhere. Required for GoDaddy and Carrd.

### When to ask the owner for help

Ask the owner for API keys or exports only when the improvement is significant:

- **Worth asking:** Ghost Content API key (full structured data vs RSS excerpts), Webflow API token (structured CMS fields vs scraped HTML), Squarespace WXR export (complete archive vs 20-post RSS limit)
- **Not worth asking:** WordPress (public REST API works without auth), Blogger (public Atom feed has everything), Substack (RSS has full content), Medium (RSS is the only option anyway)

Frame the ask in terms of benefit: "If you can get me an API key, I'll get a more complete copy. Otherwise I can work with what's public."

## HTML-to-Markdown conversion

Most hosted platforms deliver content as rendered HTML. These conversion rules apply universally — individual platform docs only need to list platform-specific elements.

### Standard element conversions

| HTML | Markdown | Notes |
| --- | --- | --- |
| `<h1>` | `#` | Rarely used in post bodies — usually the title |
| `<h2>` | `##` | Primary subheading |
| `<h3>` | `###` | Secondary subheading |
| `<h4>` through `<h6>` | `####` through `######` | Keep depth |
| `<p>` | Paragraph with blank line separation | |
| `<a href="url">text</a>` | `[text](url)` | |
| `<img src="url" alt="text">` | `![text](url)` | Download image first |
| `<ul>` / `<li>` | `- item` | Preserve nesting |
| `<ol>` / `<li>` | `1. item` | Preserve nesting |
| `<blockquote>` | `> text` | May be multi-paragraph |
| `<strong>` / `<b>` | `**text**` | |
| `<em>` / `<i>` | `*text*` | |
| `<code>` | `` `code` `` | Inline code |
| `<pre><code>` | Fenced code block | Use language class if present |
| `<hr>` | `---` | |
| `<br>` | Newline or paragraph break | Double `<br>` becomes paragraph break |
| `<table>` | Markdown table | If simple enough; otherwise note for review |

### Elements to always strip

These appear on most platforms and should always be removed:

- **Wrapper divs**: `<div>`, `<section>`, `<article>`, `<span>` — unwrap, keep inner content
- **Inline styles**: `style="..."` on any element
- **Class attributes**: `class="..."` on any element
- **Data attributes**: `data-*` on any element
- **Empty elements**: Empty `<p>`, `<div>`, `<span>` tags
- **Excessive whitespace**: Multiple blank lines, trailing spaces

### Elements to always strip entirely (content and tag)

- Navigation bars, headers, footers, sidebars
- Social sharing buttons and widgets
- Comment sections
- Newsletter signup prompts and CTAs
- Cookie consent banners
- Chat widgets
- Analytics and tracking scripts
- Advertising blocks
- "Read more" / "Continue reading" links
- Platform branding ("Powered by X", "Made with X")

### Embedded media: note, don't import

When the content contains embedded media (YouTube, Vimeo, Twitter/X, Instagram, TikTok, Spotify, SoundCloud, etc.), do not import the embed code. Instead:

1. Add a Markdown comment noting the embed: `<!-- Embedded YouTube video: https://youtube.com/watch?v=ID -->`
2. If a link to the source is available, add it as a plain text link
3. Flag in the import report so the owner knows these need manual review

This preserves awareness of the media without introducing third-party JavaScript (ADR-0008).

### HTML entity decoding

Platform APIs and RSS feeds often contain HTML entities in titles and content:

| Entity | Character |
| --- | --- |
| `&amp;` | `&` |
| `&#8217;` / `&rsquo;` | `'` (right single quote) |
| `&#8216;` / `&lsquo;` | `'` (left single quote) |
| `&#8220;` / `&ldquo;` | `"` (left double quote) |
| `&#8221;` / `&rdquo;` | `"` (right double quote) |
| `&#8211;` / `&ndash;` | `–` (en dash) |
| `&#8212;` / `&mdash;` | `—` (em dash) |
| `&hellip;` | `…` |
| `&nbsp;` | regular space |
| `&lt;` / `&gt;` | `<` / `>` |

Decode all entities. Use the actual Unicode characters in the output Markdown.

## Image handling best practices

### Download everything locally

Every image must be downloaded to `public/images/blog/` regardless of whether the source CDN seems stable. Reasons:

1. **CDN expiration**: Squarespace, Wix, Weebly, Webflow, GoDaddy, and Carrd CDN URLs stop working when the account is cancelled. Even "stable" CDNs (Google, Medium) can change URL schemes.
2. **Self-hosting principle** (ADR-0011): The site must not depend on external services to display correctly.
3. **Performance**: Local images can be optimized and served from the site's own CDN with proper caching headers.

### Image optimization pipeline

For every downloaded image:

1. **Check file size**: `wc -c < path`
2. **If over 500KB**, convert and resize: `npx sharp-cli -i input -o output.webp --width 1200`
3. **Verify conversion succeeded**: Check the output file exists and has content
4. **If conversion fails or input is under 500KB**, keep the original format

Use `.webp` for optimized images. Keep originals only as a fallback.

### Image naming conventions

| Type | Pattern | Example |
| --- | --- | --- |
| Hero/featured image | `SLUG-hero.webp` | `my-great-post-hero.webp` |
| Inline body image (Nth) | `SLUG-body-N.webp` | `my-great-post-body-1.webp` |
| Gallery image (Nth) | `PAGE-SLUG-NN.webp` | `portfolio-01.webp` |

### CDN URL normalization

Different platforms use different CDN URL schemes. Strip platform-specific transforms to get the best quality:

| Platform | CDN domain | URL manipulation |
| --- | --- | --- |
| Wix | `static.wixstatic.com` | Strip `/v1/fill/...` parameters, append `?w=1200` |
| Medium | `miro.medium.com` | Strip `/resize:fit:NNNN/` from path |
| Squarespace | `images.squarespace-cdn.com` | Strip `?format=NNNw` if NNN < 1200 (gallery thumbnails); replace with `?format=2500w` or remove param |
| WordPress | `site.com/wp-content/uploads/` | Use as-is |
| Substack | `substackcdn.com` | Use as-is (width params OK at default) |
| Shopify | `cdn.shopify.com` | Use as-is |
| Ghost | `site.com/content/images/` | Use as-is |
| Blogger | `blogger.googleusercontent.com` | Use `<a href>` (full-size), not `<img src>` (thumbnail) |
| Tumblr | `media.tumblr.com` | Replace `_500` or `_400` with `_1280` for full size |
| Webflow | `assets.website-files.com` | Strip query parameters |
| GoDaddy | `img1.wsimg.com` | Remove or increase resize parameters |
| Micro.blog | `micro.blog/photos/` | Use as-is |
| WriteFreely | `i.snap.as` | Use as-is |

### Warn before cancellation

For platforms where CDN URLs expire on cancellation (Squarespace, Wix, Weebly, Webflow, GoDaddy, Carrd), explicitly warn the owner:

> "Important: the images on your [Platform] site will stop being available
> after you cancel your subscription. Let me verify all images are saved
> locally before you cancel."

Then run the build verification to confirm no external image URLs remain.

## Pagination patterns

APIs and feeds often paginate results. Handle pagination correctly to avoid missing content.

### Common pagination styles

| Platform | Style | How to paginate |
| --- | --- | --- |
| WordPress | Page number | `&page=1`, `&page=2`... until empty response or 400 |
| Ghost | Page number | `&page=1`, `&page=2`... check `meta.pagination.pages` |
| Blogger | Start index | `start-index=1`, `start-index=151`... until empty |
| Tumblr | Offset | `offset=0`, `offset=20`... until `total_posts` reached |
| Webflow | Offset | `offset=0`, `offset=100`... until fewer items than limit |
| Micro.blog | Next URL | Follow `next_url` in JSON Feed response until absent |

### Pagination best practices

- **Don't assume page size**: Some APIs return 10 items, others 100. Use the platform's documented limit.
- **Check for termination**: Don't loop forever. Stop when the response is empty, returns an error, or the count matches the total.
- **Rate limiting**: Webflow (60/min) and Wix impose rate limits. If you get 429 responses, pause 2–3 seconds between requests.
- **Progress updates**: For large sites (50+ posts), tell the owner how many posts have been fetched so far.

## Missing field fallbacks

Platforms vary widely in what metadata they provide. Apply these fallbacks consistently:

| Field | Fallback strategy |
| --- | --- |
| `description` | Generate from the first 1–2 sentences of the post body. Strip Markdown formatting. Target 120–160 characters (SEO meta description length). |
| `title` | For untitled posts (Micro.blog, WriteFreely, Tumblr): use the first sentence truncated at 60 characters with ellipsis. For posts with only an `<h1>`: use that. |
| `publishDate` | RSS `<pubDate>` → API `created_at` → page scrape → file modification date → today's date. Always convert to `YYYY-MM-DD`. |
| `tags` | If the platform has categories and tags, merge both into a single `tags` array. If neither exists (Substack, Weebly, GoDaddy), leave as `[]`. |
| `image` | First image in the post body. If no images at all, omit the field — don't use a placeholder. |
| `imageAlt` | Alt text from the `<img>` tag. If empty, generate: "Hero image for [post title]". |

### Date format normalization

Platforms return dates in many formats. Normalize all to `YYYY-MM-DD`:

| Input format | Example | Source platforms |
| --- | --- | --- |
| ISO 8601 | `2024-03-15T14:30:00Z` | Ghost, WordPress, WriteFreely, Micro.blog |
| ISO 8601 with offset | `2024-03-15T14:30:00+05:00` | Hugo, Ghost |
| RFC 822 | `Fri, 15 Mar 2024 14:30:00 GMT` | RSS feeds (Wix, Substack, Medium) |
| YYYY-MM-DD HH:MM:SS | `2024-03-15 14:30:00` | Squarespace WXR |
| Atom | `2024-03-15T14:30:00.000Z` | Blogger Atom |

Discard the time component. Keep the date in the source timezone (don't convert to UTC).

## Redirect generation best practices

### Preserve search rankings

Redirects are critical for SEO. Every imported page should have a redirect mapping from its old URL to its new URL. Missing redirects mean broken links and lost search rankings.

### Use 301 for permanent moves

- **301** (Moved Permanently): The page has a new permanent home. Search engines transfer ranking authority. Use for all standard page-to-page redirects.
- **302** (Found / Temporary): The page temporarily redirects elsewhere. Use only for app-powered pages (booking, store) that will get a replacement later.
- **200** (Rewrite): The old and new paths are the same. No visible redirect to the user.

### Generate from actual URLs, not assumptions

Don't guess URL patterns. Use the actual URLs from the API response, RSS feed, or sitemap. WordPress has 4+ permalink structures. Ghost supports custom routing. Squarespace collections can have custom prefixes.

### Common redirect patterns

```
# Blog posts: old path → /blog/slug
/YYYY/MM/DD/slug/ /blog/slug 301        # WordPress date-based
/YYYY/MM/slug/ /blog/slug 301           # WordPress month-based
/post/slug /blog/slug 301               # Wix
/p/slug /blog/slug 301                  # Substack
/YYYY/MM/slug.html /blog/slug 301       # Blogger
/@username/slug-id /blog/slug 301       # Medium

# Trailing slash normalization
/blog/ /blog 301

# Feed redirects (people may have bookmarked these)
/feed /blog 301
/rss /blog 301
/feed.xml /blog 301
```

### Don't redirect what didn't change

If the old path and new path are identical (e.g., `/about` → `/about`), don't add a redirect. Unnecessary redirects clutter the file and add latency.

## Handling platform-specific features

### Features that can't be imported

Some platform features depend on runtime infrastructure that doesn't exist in a static site. Don't try to replicate them — redirect and recommend alternatives.

| Feature | Platforms that offer it | What to do |
| --- | --- | --- |
| Booking/scheduling | Wix, Squarespace, GoDaddy, Weebly | Redirect to home (302). Recommend Cal.com or Calendly. |
| E-commerce/store | Wix, Squarespace, Shopify, GoDaddy, Weebly, Webflow | Redirect to home (302). Recommend Square or Shopify standalone. |
| Event calendar | Wix, Squarespace | Redirect to home (302). Can build a custom events page. |
| Contact forms | All platforms | Replace with `mailto:` link or recommend Tally/Jotform. |
| Forum/members area | Squarespace, Ghost, Wix | Redirect to home (302). Needs a separate platform. |
| Comments | WordPress, Blogger, Ghost | Not imported. The owner can add a commenting service later. |
| Newsletter signup | Ghost, Substack, Squarespace | See newsletter migration in the import skill. |
| Chat widget | Wix, GoDaddy, Squarespace | Drop entirely. Recommend dedicated chat if needed. |

### Features that become static content

| Feature | How to handle |
| --- | --- |
| Image galleries | Download images, create a gallery page with CSS grid |
| Testimonials | Import as a content section on the appropriate page |
| Team/staff pages | Import as an About page section |
| FAQ/accordion | Import as flat content with headings |
| Pricing tables | Import as a static pricing page |

## Quality checks after import

Run these checks after importing all content but before presenting results:

### 1. Build passes

```sh
npm run build
```

Fix any build errors. Common causes:
- Invalid `publishDate` format (must be YYYY-MM-DD string)
- Missing required `description` field
- Image path typo (file doesn't exist in `public/images/`)
- Frontmatter YAML syntax errors (unquoted colons, unescaped quotes)

### 2. No external image dependencies

```sh
grep -rE "(wixstatic\.com|squarespace-cdn\.com|wp-content/uploads|miro\.medium\.com|substackcdn\.com|cdn\.shopify\.com|media\.tumblr\.com|img1\.wsimg\.com|static\.carrd\.co|assets\.website-files\.com|blogger\.googleusercontent\.com|micro\.blog/photos)" dist/ --include="*.html"
```

If any platform CDN URLs remain, find the source files and replace with downloaded local copies.

### 3. No broken internal links

Scan the built site for links to imported pages that might have different slugs than expected.

### 4. Reasonable file sizes

```sh
find public/images/blog -size +1M -type f
```

Flag any images over 1MB for the owner's attention.

## Import report template

After import, give the owner a clear summary. Include:

- Number of posts imported vs total available
- Number of images downloaded
- Number of redirect rules added
- Pages created (with names)
- Posts that failed (with URLs so they can be added manually)
- Images that failed (with original URLs)
- Platform features that need replacement (with specific recommendations)
- A reminder that design tweaks come after this first content-accuracy pass
