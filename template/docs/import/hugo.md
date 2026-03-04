# Importing from Hugo

Hugo is the second most popular SSG (87k GitHub stars). It uses Markdown files with YAML, TOML, or JSON frontmatter and has its own shortcode syntax.

## How it detects this platform

Config file in the project root: `hugo.toml`, `hugo.yaml`, `hugo.json`, or the legacy `config.toml`, `config.yaml`, `config.json`.

## Where content lives

- **Blog posts**: `content/posts/` or `content/blog/` (varies by theme)
- **Pages**: `content/` root or any section directory (e.g., `content/about/`)
- **Images**: `static/images/` or as page bundles alongside content files
- **Config**: `hugo.toml` (or `config.toml`)

Hugo uses "sections" — top-level directories under `content/` map to URL paths and content types. A file at `content/posts/my-post.md` becomes `/posts/my-post/`.

### Page bundles

Hugo supports "page bundles" where a post is a directory containing `index.md` plus its images:

```
content/posts/my-post/
├── index.md
├── hero.jpg
└── diagram.png
```

Check for both standalone `.md` files and `index.md` inside directories.

## Frontmatter mapping

Hugo supports three frontmatter formats. Detect by delimiter:
- YAML: `---` delimiters
- TOML: `+++` delimiters
- JSON: `{` `}` delimiters

| Hugo field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` or `summary` | `description` | Hugo uses both; prefer `description` |
| `date` | `publishDate` | YYYY-MM-DDTHH:MM:SS → YYYY-MM-DD |
| `tags` | `tags` | Direct copy (array of strings) |
| `categories` | `tags` | Merge with tags |
| `featured_image` or `image` or `cover` | `image` | Varies by theme — check for all |
| `draft` | `draft` | Direct copy |
| `slug` | filename | Override for the URL slug |
| `aliases` | — | Old URLs — add to `_redirects` |

Hugo's `aliases` field lists old URLs that redirect to the current page. Convert these to `_redirects` entries.

## Content conversion

Hugo Markdown is mostly standard, but watch for:

**Shortcodes** — Hugo's template syntax embedded in Markdown:
- `{{</* figure src="image.jpg" caption="text" */>}}` → `![text](image.jpg)`
- `{{</* youtube ID */>}}` → note for manual review (no third-party JS)
- `{{</* tweet ID */>}}` → note for manual review
- `{{</* highlight lang */>}}...{{</* /highlight */>}}` → standard code fences
- `{{</* ref "other-post.md" */>}}` → resolve to `/blog/other-post`
- `{{</* relref "other-post.md" */>}}` → resolve to `/blog/other-post`

Strip all shortcodes. Convert `figure` to Markdown images. Flag media embeds (YouTube, Twitter) as needing manual review since the site doesn't allow third-party JavaScript.

**Raw HTML**: Hugo allows raw HTML in Markdown by default. Strip or convert to Markdown equivalents.

## Image handling

Hugo images may be in:
1. `static/images/` — copied to the site root at build time
2. Page bundles — alongside the content file's `index.md`
3. Absolute URLs in content (external images)

For option 1, copy from `static/images/` to `public/images/blog/`.
For option 2, copy from the page bundle directory to `public/images/blog/`.
Update all image references in the converted content to use `/images/blog/` paths.

## Common issues

- **TOML frontmatter**: Hugo is the only major SSG that commonly uses TOML (`+++` delimiters). Parse correctly — TOML arrays use `["a", "b"]`, dates are bare (no quotes).
- **Taxonomy confusion**: Hugo's `categories` and `tags` are separate taxonomies. Anglesite merges them into `tags`.
- **Page bundles vs standalone files**: Check both `content/posts/*.md` and `content/posts/*/index.md`.
- **Theme-specific frontmatter**: Themes add custom fields (`featured_image`, `cover.image`, `thumbnail`, `hero`). Check the theme's archetype file for the expected fields.
- **Nested sections**: Hugo supports deeply nested sections (`content/docs/guide/getting-started.md`). Flatten to a single blog collection or create Astro pages as appropriate.
