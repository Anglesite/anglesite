# Importing from Docusaurus

Docusaurus is a documentation-focused SSG by Meta (64k GitHub stars). It uses MDX for both documentation and blog content, with built-in support for admonitions, tabs, and code blocks.

See [ssg-migrations.md](ssg-migrations.md) for shared SSG migration guidance including frontmatter conventions, template syntax stripping patterns, image handling, and redirect generation. This doc covers only what's specific to Docusaurus.

## How it detects this platform

Config file: `docusaurus.config.js` or `docusaurus.config.ts` in the project root.

## Where content lives

- **Blog posts**: `blog/` directory
- **Documentation pages**: `docs/` directory
- **Static pages**: `src/pages/` (React components, not Markdown)
- **Images**: `static/img/` or co-located with content

### Blog structure

Docusaurus blog posts can be:
- Single files: `blog/2024-03-15-my-post.md` (date-prefixed)
- Directories: `blog/2024-03-15-my-post/index.md` (with co-located assets)

### Docs structure

```
docs/
├── intro.md
├── tutorial/
│   ├── getting-started.md
│   └── advanced.md
└── api/
    └── reference.md
```

Docs use `sidebars.js` for navigation ordering. This file is useful for understanding the structure but doesn't need to be migrated.

## Frontmatter mapping

### Blog posts

| Docusaurus field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` | `description` | Direct copy |
| `date` | `publishDate` | From frontmatter or filename prefix |
| `tags` | `tags` | Array of strings or objects (`{label, permalink}`) |
| `image` | `image` | Used for social card |
| `draft` | `draft` | Direct copy |
| `slug` | filename | Custom URL slug |
| `authors` | — | Skip (Anglesite doesn't have author fields) |
| `hide_table_of_contents` | — | Skip |
| `keywords` | `tags` | Merge with tags if present |

Docusaurus `tags` can be either strings or objects: `tags: [{label: "Tutorial", permalink: "/tutorial"}]`. Extract just the `label` value.

### Documentation pages

| Docusaurus field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` | `description` | Direct copy |
| `sidebar_position` | — | Skip (ordering) |
| `sidebar_label` | — | Skip |
| `id` | — | Skip |

Documentation pages typically become static Astro pages, not blog posts.

## Content conversion

Docusaurus uses MDX with custom components:

**Admonitions** — convert to blockquotes:
- `:::note` / `:::` → `> **Note:** text`
- `:::tip` / `:::` → `> **Tip:** text`
- `:::info` / `:::` → `> **Info:** text`
- `:::caution` / `:::` → `> **Caution:** text`
- `:::danger` / `:::` → `> **Warning:** text`
- `:::note[Custom Title]` / `:::` → `> **Custom Title:** text`

**Tabs** — flatten to sequential content:
- `<Tabs>` / `<TabItem value="js" label="JavaScript">` → `### JavaScript` heading
- Show all tab contents sequentially

**Code blocks** — standard fenced code blocks with optional title:
- ` ```js title="example.js" ` → ` ```js ` (strip title attribute)
- `{1,3-5}` line highlighting → strip

**MDX imports and components:**
- `import Tabs from '@theme/Tabs'` → remove
- `import TabItem from '@theme/TabItem'` → remove
- `<BrowserWindow>` → strip wrapper
- `<CodeBlock>` → standard code fence
- `<details><summary>Title</summary>` → keep (standard HTML supported in Markdoc)

**Links:**
- `[text](./other-doc.md)` → resolve to absolute path
- `[text](../category/doc.md)` → resolve to absolute path

## Image handling

Docusaurus images are in:
- `static/img/` — served at `/img/`
- Co-located with content files in blog post directories

References use:
- `![alt](/img/photo.jpg)` (from `static/`)
- `![alt](./photo.jpg)` (co-located)
- `import MyImage from './photo.png'` then `<img src={MyImage} />` (MDX import)

Copy from `static/img/` and co-located directories to `public/images/blog/`. Convert MDX image imports to standard Markdown syntax.

## URL patterns for redirects

- Blog: `/blog/slug` or `/blog/YYYY/MM/DD/slug`
- Docs: `/docs/path/to/doc`

Blog URLs usually match Anglesite's `/blog/slug` pattern.

## Common issues

- **Admonition syntax**: The `:::` syntax is Docusaurus-specific and must be converted. It's the most common content conversion issue.
- **Docs vs blog**: Decide with the owner what to do with documentation pages. They may become static Astro pages, a documentation section, or be dropped.
- **MDX v2/v3**: Docusaurus v3 uses MDX v3. Component syntax is standard JSX. Strip all components that aren't standard Markdown.
- **Versioned docs**: Docusaurus supports `versioned_docs/` for multiple doc versions. Usually only the latest version needs to be imported.
- **i18n**: Docusaurus supports `i18n/` directories for translations. Import the primary language only.
