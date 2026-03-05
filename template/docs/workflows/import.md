# Content Import Workflow

Import blog posts, pages, and images from an existing website or static site generator project.

## Supported platforms

**Hosted**: WordPress, Squarespace, Wix, Webflow, GoDaddy, Ghost, Medium, Substack, Blogger, Shopify, Weebly, Tumblr, Micro.blog, WriteFreely, Carrd

**Static site generators**: Hugo, Jekyll, Next.js, Gatsby, Nuxt, Docusaurus, VuePress, MkDocs, Eleventy, Hexo

## Import principles

1. **Content accuracy over visual fidelity** — get all content moved correctly first, design tweaks after
2. **Download all images locally** — no external image dependencies
3. **Generate descriptions** from first 1-2 sentences if no excerpt field exists
4. **Generate titles** for untitled posts (microblog-style) — first sentence, truncated at 60 characters
5. **Preserve provenance** — every imported post gets a `syndication` URL pointing to the original
6. **Strip third-party embeds** — YouTube, Twitter, Instagram embeds become comments noting what was there
7. **Don't replicate platform features** — booking, stores, events can't be imported; redirect and recommend replacements
8. **Build must pass** — fix every build error before presenting results
9. **Warn about CDN expiry** — for platforms where image URLs expire, warn before cancelling the old account

## How it works

1. Detect the platform from the URL or directory structure
2. Read the shared guidance doc:
   - Hosted platforms: `docs/import/hosted-platforms.md`
   - SSG migrations: `docs/import/ssg-migrations.md`
3. Read the platform-specific doc: `docs/import/PLATFORM.md`
4. Extract content (RSS feed, API, HTML scraping, or file copy)
5. Convert to Markdoc (`.mdoc`) files in `src/content/posts/`
6. Download images to `public/images/imported/`
7. Generate redirect mappings from old URLs
8. Run `npm run build` to verify
9. Present results

## Content format

Imported posts land as `.mdoc` files in `src/content/posts/` with frontmatter:

```yaml
title: "Post Title"
description: "First 1-2 sentences"
publishDate: "2024-01-15"
syndication:
  - https://old-platform.com/original-post-url
```

## After import

- Review all imported content for accuracy
- Check that all images downloaded successfully
- Verify the build passes: `npm run build`
- Deploy when ready: `npm run deploy`
