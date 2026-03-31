# Shared Content Conversion Procedures

These procedures are used by both `/anglesite:import` and `/anglesite:convert`.
Read this file when converting content from any source into Anglesite `.mdoc` files.

## Convert content to clean Markdown

1. Strip platform-specific template syntax (shortcodes, Liquid tags, Vue
   components, Nunjucks tags, admonitions) as documented in the platform doc
2. Convert admonitions (`:::`, `!!!`, custom containers) to blockquotes
3. Strip MDX/JSX imports and component tags
4. Remove template expressions (`{{ }}`, `{% %}`, `{{< >}}`)
5. Keep standard Markdown (headings, lists, links, images, code blocks)
6. If `description` is missing, generate from the first paragraph
7. If `publishDate` is missing, use the file's git commit date or modification
   date as fallback

### HTML-to-Markdown conversion

For content that arrives as rendered HTML:
- `<h2>` → `##`, `<h3>` → `###`, etc.
- `<p>` → paragraph with blank line separation
- `<a href="...">text</a>` → `[text](url)`
- `<img src="..." alt="...">` → `![alt](src)` (download image separately)
- `<ul>/<li>` → `- item`
- `<ol>/<li>` → `1. item`
- `<blockquote>` → `> text`
- `<strong>` → `**text**`, `<em>` → `*text*`
- Strip all other HTML tags (`<div>`, `<span>`, `<figure>`, `<section>`, etc.)
- Strip inline styles, class attributes, and data attributes
- Strip empty paragraphs and excessive whitespace

## Copy and optimize images

Ensure the image directory exists:

```sh
mkdir -p public/images/blog
```

Copy/download image:

```sh
cp SOURCE_IMAGE "public/images/blog/SLUG-hero.ext"
```

Check file size:

```sh
wc -c < public/images/blog/SLUG-hero.ext
```

If over 500,000 bytes, convert and resize using `sharp-cli` (cross-platform):

```sh
npx sharp-cli -i public/images/blog/SLUG-hero.ext -o public/images/blog/SLUG-hero.webp --width 1200
```

Update image references in the converted Markdown to use local paths.

If the download/copy fails, omit `image` from frontmatter and continue.

## Write the .mdoc file

Assemble frontmatter fields:
- `title`: from source frontmatter or extraction
- `description`: from excerpt or generated from first paragraph
- `publishDate`: in YYYY-MM-DD format
- `image`: local path after copy, or omit
- `imageAlt`: derive from post title (e.g., "Hero image for [title]")
- `tags`: from categories/tags data, or `[]`
- `draft`: `false`
- `syndication`: `["ORIGINAL_URL"]` if the old site had a known public URL

Sanitize the slug: lowercase, replace spaces with hyphens, remove characters
other than `[a-z0-9-]`, trim leading/trailing hyphens. If the slug conflicts
with an existing file, append `-imported` (for imports) or `-converted` (for
conversions).

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
---

The full post body content in clean Markdown goes here.
```

Rules for the body content:
- No HTML tags — convert everything to Markdown equivalents
- No MDX component syntax — plain Markdown only
- No platform-specific shortcodes or embeds

## Progress updates

After every 5 posts, tell the owner progress:
> "Converted 10 of 23 posts so far — about halfway done."

## Build and verify

```sh
npm run build
```

If the build fails, diagnose and fix. Common causes:
- Frontmatter doesn't match schema: check `src/content.config.ts` for expected fields
- Invalid `publishDate` format: must be YYYY-MM-DD string
- Missing required `description`: add a placeholder and note for review
- Image path typo: verify file exists in `public/images/`

Fix all build errors before presenting results (ADR-0012).

## Edge cases

### Images still too large after conversion

If the converted image is still over 500KB, do not block the process. Advise:
> "Some images are still large after optimization. You can resize them or
> replace them with smaller versions."

### Multilingual content

If the project has content in multiple languages:
> "Your project has content in multiple languages. I'll convert the primary
> language for now. Setting up multiple languages requires additional planning."

Convert only primary-language content.

### Slug conflicts

Before writing each `.mdoc` file, sanitize the slug (lowercase, hyphens only,
`[a-z0-9-]`). If it conflicts with an existing file, append the appropriate
suffix and log the conflict.

### Mixed content formats

Some projects use multiple content formats (`.md`, `.mdx`, `.rst`, `.html`).
Convert `.md` and `.mdx` files. For `.rst` and `.html`, inform the owner they
need manual review.
