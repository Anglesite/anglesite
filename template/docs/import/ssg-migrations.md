# Shared Guidance: Static Site Generator Migrations

This document covers principles and techniques common to all SSG-to-Anglesite migrations (Hugo, Jekyll, Next.js, Gatsby, Nuxt, Docusaurus, VuePress, MkDocs, Eleventy, Hexo). Read this first, then read the platform-specific doc for directory layouts and syntax details.

## How SSG imports differ from hosted imports

SSG imports read local files rather than fetching from remote APIs. This has several advantages:

- **Content is already in Markdown** (or MDX) — minimal conversion needed
- **Frontmatter is already structured** — field mapping, not field extraction
- **Images are local files** — copy rather than download
- **No rate limits or pagination** — read the filesystem directly
- **Complete content** — no truncated feeds or missing older posts

The main challenge is **platform-specific template syntax** mixed into the Markdown content.

## Discovery: finding content files

Never assume where content lives. Every SSG allows custom directory configuration.

### Read the config first

| SSG | Config file | Content directory setting |
| --- | --- | --- |
| Hugo | `hugo.toml` / `config.toml` | `contentDir` (default: `content/`) |
| Jekyll | `_config.yml` | `source` (default: `.`) with `_posts/` convention |
| Next.js | `next.config.js` | Varies entirely by project (contentlayer, `_posts/`, etc.) |
| Gatsby | `gatsby-config.js` | `gatsby-source-filesystem` → `options.path` |
| Nuxt | `nuxt.config.ts` | `@nuxt/content` module → `content/` default |
| Docusaurus | `docusaurus.config.js` | `blog/` and `docs/` (configurable in presets) |
| VuePress | `.vuepress/config.js` | Parent of `.vuepress/` directory (usually `docs/`) |
| MkDocs | `mkdocs.yml` | `docs_dir` (default: `docs/`) |
| Eleventy | `eleventy.config.js` | `dir.input` (default: `.`) |
| Hexo | `_config.yml` | `source_dir` (default: `source/`) → `_posts/` |

After reading the config, use Glob to find `.md` and `.mdx` files in the content directories.

### Blog posts vs pages vs docs

Most SSGs distinguish between these content types by directory:

| Content type | Common directories | Import as |
| --- | --- | --- |
| Blog posts | `content/posts/`, `_posts/`, `blog/`, `source/_posts/` | `.mdoc` files in `src/content/posts/` |
| Static pages | `content/`, `_pages/`, `src/pages/` | `.astro` files in `src/pages/` |
| Documentation | `docs/`, `content/docs/` | Static pages or a docs section |
| Drafts | `_drafts/`, files with `draft: true` | `.mdoc` with `draft: true` |

Ask the owner how to handle documentation content — it may become blog posts, static pages, or be dropped entirely.

## Frontmatter conversion

SSG frontmatter is already structured (YAML, TOML, or JSON), so conversion is field mapping rather than extraction.

### Detecting frontmatter format

| Delimiter | Format | Common SSGs |
| --- | --- | --- |
| `---` | YAML | Jekyll, Eleventy, Hexo, Next.js, Gatsby, Nuxt, Docusaurus |
| `+++` | TOML | Hugo |
| `{` `}` | JSON | Hugo (rare) |

Parse the correct format based on the delimiter.

### Universal field mapping

These fields appear across all SSGs with consistent semantics:

| Source field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Always present — direct copy |
| `description` / `summary` / `excerpt` | `description` | Name varies; generate from first paragraph if missing |
| `date` / `publishDate` / `created` | `publishDate` | Convert to `YYYY-MM-DD` — see date handling below |
| `tags` | `tags` | Direct copy if array of strings |
| `categories` | `tags` | Merge with tags — Anglesite uses a flat tag list |
| `draft` / `published` | `draft` | Invert `published: false` → `draft: true` |
| `image` / `featured_image` / `cover` / `hero` / `thumbnail` | `image` | Name varies wildly by theme — check all common names |
| `slug` / `permalink` | filename | Use as `.mdoc` filename; `permalink` also feeds redirects |
| `aliases` (Hugo) | — | Generate `_redirects` entries |
| `layout` / `template` | — | Skip — Anglesite uses its own layouts |
| `sidebar_*` / `weight` / `order` | — | Skip — ordering metadata |
| `authors` / `author` | — | Skip — Anglesite doesn't have author fields |

### Handling `categories` and `tags` together

Many SSGs distinguish categories (hierarchical) from tags (flat). Anglesite uses a single flat `tags` array. Merge both:

```
# Source frontmatter (Hugo)
categories: ["Web Development"]
tags: ["JavaScript", "Performance"]

# Anglesite frontmatter
tags: ["Web Development", "JavaScript", "Performance"]
```

Deduplicate after merging. Preserve the original casing.

### Theme-specific frontmatter

SSG themes add custom frontmatter fields (`featured_image`, `cover.image`, `header.overlay_image`, `hero_image`, etc.). These aren't standardized — they depend on which theme the project uses.

**Strategy:** Check the theme's documentation or archetype/template files to find the image field name. If you can't identify it, scan a few posts for any field containing an image path.

### Date handling

SSG dates come in several formats:

| Format | Example | SSGs |
| --- | --- | --- |
| YAML date | `2024-03-15` | All (native YAML date type) |
| ISO 8601 | `2024-03-15T14:30:00Z` | Hugo, Gatsby, Next.js |
| ISO with offset | `2024-03-15T14:30:00+05:00` | Hugo |
| Filename prefix | `2024-03-15-my-post.md` | Jekyll, Hexo, Docusaurus |
| Special values | `Last Modified`, `Created` | Eleventy |

When the date is in the filename AND the frontmatter, prefer the frontmatter value (the author may have intentionally overridden it).

If no date is found anywhere, fall back to the file's git commit date:
```sh
git log -1 --format="%ai" -- "path/to/file.md"
```

Or the file modification date as a last resort.

## Content conversion: stripping template syntax

This is the core challenge of SSG imports. Each SSG allows platform-specific syntax inside Markdown content. All of it must be stripped or converted to standard Markdown.

### Template syntax families

| Syntax family | SSGs that use it | Example |
| --- | --- | --- |
| Hugo shortcodes | Hugo | `{{</* figure src="img.jpg" */>}}` |
| Liquid tags | Jekyll, Eleventy, Hexo (partial) | `{% include file.html %}` |
| Nunjucks tags | Eleventy, Hexo | `{% block %}`, `{{ variable }}` |
| Vue components | VuePress, Nuxt | `<CustomComponent />` |
| MDX/JSX | Next.js, Gatsby, Docusaurus, Nuxt | `import X from 'y'`, `<Component />` |
| Admonitions | Docusaurus, VuePress, MkDocs | `:::note`, `!!!note`, `::: tip` |

### Conversion rules by syntax type

#### Shortcodes and template tags → strip or convert

| Pattern | Action |
| --- | --- |
| `{{</* figure src="x" caption="y" */>}}` | Convert to `![y](x)` |
| `{{</* youtube ID */>}}` | Comment: `<!-- YouTube: https://youtube.com/watch?v=ID -->` |
| `{{</* tweet ID */>}}` | Comment: `<!-- Tweet embed: ID -->` |
| `{{</* highlight lang */>}}...{{</* /highlight */>}}` | Standard fenced code block |
| `{{</* ref "page.md" */>}}` | Resolve to `/blog/slug` |
| `{% highlight lang %}...{% endhighlight %}` | Standard fenced code block |
| `{% include "file" %}` | Remove (include content is layout-specific) |
| `{% link path/to/page.md %}` | Resolve to page URL |
| `{% post_url YYYY-MM-DD-slug %}` | Resolve to `/blog/slug` |
| `{{ site.baseurl }}` | Remove |
| `{{ page.title }}` | Replace with actual title value |
| `{% if %}...{% endif %}` | Remove conditionals, keep content if simple |
| `{% for %}...{% endfor %}` | Remove loops |
| `{% set var = value %}` | Remove |

#### MDX/JSX imports and components → strip

```markdown
<!-- Remove these entirely -->
import Tabs from '@theme/Tabs'
import { Image } from 'components'

<!-- Convert components to Markdown equivalents -->
<Image src="photo.jpg" alt="text" />  →  ![text](photo.jpg)
<Link to="/page">text</Link>         →  [text](/page)
<Tabs>/<TabItem>                      →  ### Tab heading (flatten)
<CodeBlock>                           →  Standard code fence
<BrowserWindow>                       →  Strip wrapper, keep content
<StaticImage src="x" alt="y" />       →  ![y](x)
```

#### Admonitions → blockquotes

All three admonition syntaxes convert to the same Markdown:

```markdown
# Docusaurus / VuePress (triple-colon)
:::note
Content here
:::
→
> **Note:** Content here

# MkDocs (exclamation)
!!! tip "Custom Title"
    Content here
→
> **Custom Title:** Content here

# With custom title
:::caution[Be Careful]
Content here
:::
→
> **Be Careful:** Content here
```

Map admonition types to labels: `note` → Note, `tip` → Tip, `info` → Info, `caution`/`warning` → Caution, `danger` → Warning.

#### Kramdown attributes → strip

Jekyll uses Kramdown which adds attribute syntax:
- `{:.class-name}` → strip
- `{: #id}` → strip
- `{:toc}` → strip

#### Raw HTML in Markdown → convert or strip

Most SSGs allow raw HTML in Markdown. Convert to Markdown equivalents where possible:
- `<div class="note">` → `> **Note:**`
- `<details><summary>Title</summary>` → keep (standard HTML, works in Markdoc)
- `<table>` → Markdown table if simple
- Anything else → strip the tags, keep the text content

## Image handling for SSG imports

### Finding source images

Images can be stored in several locations per project:

| Location | SSGs | How to find |
| --- | --- | --- |
| Static assets directory | Hugo (`static/`), Docusaurus (`static/img/`), Jekyll (`assets/images/`) | Check config for static dir |
| Co-located with content | Hugo (page bundles), Gatsby, Docusaurus (blog dirs) | Look for images next to `index.md` |
| Shared assets | Eleventy, Next.js, Nuxt | `src/images/`, `public/images/`, `assets/` |
| Source directory | Hexo (`source/images/`), MkDocs (`docs/assets/`) | Platform doc specifies |

### Copy, don't download

SSG images are local files. Use `cp` to copy them to `public/images/blog/`:

```sh
cp source/images/photo.jpg public/images/blog/post-slug-hero.jpg
```

Then optimize with `sharp-cli` if over 500KB (same pipeline as hosted imports).

### Fixing image references

After copying images, update all references in the converted content:

| Original reference | Updated reference |
| --- | --- |
| `/static/images/photo.jpg` | `/images/blog/slug-hero.webp` |
| `./hero.jpg` (co-located) | `/images/blog/slug-hero.webp` |
| `{{ site.baseurl }}/assets/images/photo.jpg` | `/images/blog/slug-hero.webp` |
| `{% image "src/images/photo.jpg", "alt" %}` | `![alt](/images/blog/slug-hero.webp)` |
| `import img from './photo.png'` then `<img src={img} />` | `![alt](/images/blog/slug-hero.webp)` |

### Processing plugin-generated images

Some SSGs generate responsive image variants at build time (Hugo's image processing, Gatsby's `gatsby-image`, Eleventy's `eleventy-img`). Import the **source** images, not the generated variants. The generated versions are in the build output directory and may be lower quality or cropped.

## Redirect generation for SSG migrations

### Read the config for permalink patterns

Every SSG has configurable URL patterns. The config file determines how source file paths map to URLs:

| SSG | Where to find permalink config |
| --- | --- |
| Hugo | `hugo.toml` → `[permalinks]` section |
| Jekyll | `_config.yml` → `permalink:` field |
| Hexo | `_config.yml` → `permalink:` field |
| Gatsby | `gatsby-node.js` → `createPages` logic |
| Eleventy | Frontmatter `permalink` field per post |
| Docusaurus | `docusaurus.config.js` → blog/docs plugin config |

### Common SSG URL patterns and their redirects

```
# Jekyll date-based (default)
/category/2024/03/15/my-post/ /blog/my-post 301

# Hugo with aliases
/old-url/ /blog/new-slug 301          # from aliases frontmatter

# Docusaurus docs
/docs/getting-started /getting-started 301    # if docs become pages

# Hexo
/2024/03/15/my-post/ /blog/my-post 301        # from permalink config

# Eleventy
/posts/my-post/ /blog/my-post 301

# Gatsby
/blog/my-post/ /blog/my-post 200              # same path = rewrite
```

### Per-post overrides

Check each post's frontmatter for `permalink`, `slug`, `url`, or `aliases` fields that override the default URL pattern. Generate redirects from these actual URLs, not from assumptions based on the config.

Hugo's `aliases` field is particularly important — it lists old URLs that Hugo would have created redirects for. These should all become `_redirects` entries.

## Data files and structured content

Many SSGs use data files for structured content that isn't blog posts:

| SSG | Data location | Common content |
| --- | --- | --- |
| Jekyll | `_data/*.yml` | Navigation, team members, testimonials |
| Hugo | `data/*.toml` | Site settings, structured content |
| Eleventy | `_data/*.json` | Global data, navigation |
| Gatsby | `src/data/` | Varies by project |
| Docusaurus | `sidebars.js` | Documentation navigation |

**Don't import data files as posts.** Instead:
1. Scan for data files during discovery
2. Note their contents in the import report
3. If they contain content that should appear on the site (team bios, testimonials), suggest creating appropriate pages after the main import

## Common issues across all SSGs

### Content and layout are entangled

SSG content files often contain layout logic (Liquid loops, Nunjucks macros, Vue components) mixed with prose. The template syntax must be stripped, but the prose must be preserved. When in doubt, strip the template syntax and keep the text content — broken formatting is better than broken builds.

### Multiple content formats in one project

A single project may contain `.md`, `.mdx`, `.njk`, `.liquid`, and `.html` files. Focus on Markdown and MDX files for content import. Template-only files (`.njk`, `.liquid`) rarely contain prose content worth importing.

### Plugin-dependent features

Features like image processing, search, RSS generation, and sitemap creation are handled by plugins in the source SSG. These don't need to be migrated — Anglesite has its own equivalents.

### Deeply nested content

SSGs like Hugo and Docusaurus support deeply nested directory structures that map to URL hierarchies. Flatten these into a single blog collection unless the owner specifically wants to preserve the hierarchy.

### Monorepo projects

Some SSG projects are part of a monorepo where the site lives in a subdirectory (e.g., `packages/docs/` or `apps/website/`). Make sure SOURCE_DIR points to the site root, not the monorepo root.

### Git submodules for themes

Hugo and Jekyll projects often use Git submodules for themes. These may need to be initialized (`git submodule update --init`) before the theme's archetypes or config can be read. However, the theme itself doesn't need to be imported — only the content.
