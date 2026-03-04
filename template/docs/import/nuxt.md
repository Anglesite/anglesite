# Importing from Nuxt

Nuxt is the Vue.js meta-framework (60k GitHub stars). Blog content is managed through the `@nuxt/content` module, which stores Markdown files in a `content/` directory.

See [ssg-migrations.md](ssg-migrations.md) for shared SSG migration guidance including frontmatter conventions, template syntax stripping patterns, image handling, and redirect generation. This doc covers only what's specific to Nuxt.

## How it detects this platform

Config file: `nuxt.config.js`, `nuxt.config.ts`, or `nuxt.config.mjs` in the project root.

Confirm `@nuxt/content` is used by checking `package.json` for `@nuxt/content` or `nuxt.config.*` for `content` in the modules array.

## Where content lives

- **Blog posts**: `content/blog/` or `content/articles/` (convention varies)
- **Pages**: `content/` root or subdirectories matching page routes
- **Images**: `public/images/` or `assets/images/`

Nuxt Content v2 uses a flat or nested directory structure under `content/`. Files are Markdown (`.md`) with YAML frontmatter.

### Content directory structure

```
content/
├── blog/
│   ├── my-first-post.md
│   └── another-post.md
├── about.md
└── index.md
```

Nuxt Content also supports JSON, YAML, and CSV files as data sources, but blog content is typically Markdown.

## Frontmatter mapping

| Nuxt Content field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` | `description` | Direct copy |
| `date` or `createdAt` | `publishDate` | Nuxt Content v2 auto-generates `createdAt` from git |
| `tags` or `categories` | `tags` | Direct copy |
| `image` or `cover` | `image` | Path relative to `public/` |
| `draft` | `draft` | Direct copy |

Nuxt Content v2 adds automatic fields: `_id`, `_path`, `_draft`, `_partial`, `_empty`. Ignore these underscore-prefixed fields — they're computed by the module, not authored content.

## Content conversion

Nuxt Content Markdown is mostly standard but supports:

**Vue components in Markdown** (MDC syntax in v2):
- `::component-name{prop="value"}` / `::` → strip
- `:::component-name` / `:::` → strip outer wrapper, keep inner content
- `:inline-component{prop="value"}` → strip
- `<!-- @slot default -->` → strip

**Prose components** (Nuxt Content built-ins):
- `::alert{type="info"}` → `> **Info:** text`
- `::code-group` → standard code fences
- `::callout` → `> text`

**YAML arrays in frontmatter**: Nuxt Content uses standard YAML. No special parsing needed.

## Image handling

Nuxt Content images are typically in `public/` (served at root) or `assets/` (processed by Vite). References in content use:
- `/images/photo.jpg` (from `public/images/`)
- `~/assets/images/photo.jpg` (from `assets/` — needs Vite processing)

For `public/` images, copy to Anglesite's `public/images/blog/`. For `assets/` images, also copy — the Vite processing isn't needed for static Astro builds.

## URL patterns for redirects

Nuxt Content generates URLs from the file path under `content/`:
- `content/blog/my-post.md` → `/blog/my-post`
- `content/articles/guide.md` → `/articles/guide`

## Common issues

- **Nuxt Content v1 vs v2**: v1 uses `content/` with a different query API. v2 uses MDC (Markdown Components) syntax. Content files are similar but v2 may have more component syntax to strip.
- **Auto-generated fields**: `createdAt`, `updatedAt` are derived from git history by Nuxt Content v2. They may not exist in the frontmatter — check git log dates as fallback.
- **Vue components in content**: Nuxt Content allows embedding Vue components. These can't be converted to Markdoc — strip and note for manual recreation.
- **Dynamic content from APIs**: Some Nuxt sites use `$fetch` or `useFetch` to load content from external APIs. If `content/` is empty, ask the owner about their data source.
