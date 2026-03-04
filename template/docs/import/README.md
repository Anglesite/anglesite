# Import Guides

These guides tell the Webmaster agent how to import content from other platforms and static site generators into this Anglesite project. Each guide documents where content lives, how to map frontmatter fields, what platform-specific syntax to strip, and common issues to watch for.

The `/anglesite:import` skill reads the relevant guide at runtime based on platform detection.

## Hosted platforms

These platforms serve content from their own infrastructure. The import skill fetches content remotely via APIs, RSS feeds, or page scraping.

- [WordPress](wordpress.md) — REST API extraction (best), WXR XML export, or RSS feed
- [Squarespace](squarespace.md) — WXR XML export (best), RSS feed, or page scraping
- [Wix](wix.md) — Page scraping via WebFetch (only option — Wix has no content API)

## Static site generators

These are local file migrations. The owner has a project directory with source files that need to be converted to Anglesite's Astro/Markdoc format.

- [Hugo](hugo.md) — Markdown in `content/`, YAML/TOML/JSON frontmatter, shortcodes
- [Jekyll](jekyll.md) — Markdown in `_posts/`, date-prefixed filenames, Liquid tags
- [Next.js](nextjs.md) — MDX/Markdown, varies by project (contentlayer, next-mdx-remote)
- [Gatsby](gatsby.md) — MDX/Markdown, varies by plugin, GraphQL-driven data layer
- [Nuxt](nuxt.md) — Markdown in `content/` via @nuxt/content module
- [Docusaurus](docusaurus.md) — MDX in `docs/` and `blog/`, admonitions
- [VuePress](vuepress.md) — Markdown in `docs/`, Vue components in Markdown
- [MkDocs](mkdocs.md) — Markdown in `docs/`, Python-flavored admonitions
- [Eleventy](eleventy.md) — Flexible directory structure, Nunjucks/Liquid templates
- [Hexo](hexo.md) — Markdown in `source/_posts/`, Nunjucks tags

## How the import skill uses these guides

1. The skill detects the platform (from a URL or from config files in a local directory)
2. It reads the matching guide from `docs/import/`
3. It follows the guide's frontmatter mapping and content conversion rules
4. All content lands as `.mdoc` files in `src/content/posts/` with the schema defined in `src/content/config.ts`

## Frontmatter target schema

Every imported post must produce this frontmatter (from `src/content/config.ts`):

```yaml
title: "Post Title"              # required, string
description: "Summary sentence." # required, string
publishDate: "2024-03-15"        # required, YYYY-MM-DD string
image: "/images/blog/hero.webp"  # optional, path relative to public/
imageAlt: "Description of image" # optional, string
tags: []                         # optional, string array
draft: false                     # optional, boolean
syndication: []                  # optional, URL array
```
