# Importing from VuePress

VuePress is a Vue-powered documentation SSG (23k GitHub stars). Content is Markdown with YAML frontmatter and optional Vue component embedding.

See [ssg-migrations.md](ssg-migrations.md) for shared SSG migration guidance including frontmatter conventions, template syntax stripping patterns, image handling, and redirect generation. This doc covers only what's specific to VuePress.

## How it detects this platform

Config directory: `.vuepress/config.js` or `.vuepress/config.ts` in the docs directory. The project may have content in a `docs/` subdirectory with `.vuepress/` inside it.

Check for `vuepress` in `package.json` to confirm.

## Where content lives

- **Pages**: `docs/` directory (or project root if no `docs/` subdirectory)
- **Blog posts**: `docs/blog/` or `docs/posts/` (if using a blog plugin)
- **Images**: `docs/.vuepress/public/images/` or alongside content
- **Config**: `docs/.vuepress/config.js`

VuePress 2 (current) and VuePress 1 have the same content conventions.

### Directory structure

```
docs/
├── .vuepress/
│   ├── config.js
│   └── public/
│       └── images/
├── guide/
│   ├── README.md    → /guide/
│   └── getting-started.md → /guide/getting-started
├── blog/
│   └── my-post.md
└── README.md        → /
```

`README.md` files become the index page for their directory.

## Frontmatter mapping

| VuePress field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` | `description` | Direct copy |
| `date` | `publishDate` | If blog plugin is used |
| `tags` | `tags` | If blog plugin is used |
| `lang` | — | Skip (single language) |
| `navbar` | — | Skip (layout control) |
| `sidebar` | — | Skip (layout control) |
| `prev` / `next` | — | Skip (navigation) |
| `editLink` | — | Skip |
| `lastUpdated` | — | Skip |

VuePress frontmatter is often minimal — many pages have only `title` or no frontmatter at all (the title is inferred from the first `#` heading).

## Content conversion

VuePress content is Markdown with Vue component embedding:

**Custom containers** (similar to Docusaurus admonitions):
- `::: tip [Title]` / `:::` → `> **Tip:** text`
- `::: warning [Title]` / `:::` → `> **Warning:** text`
- `::: danger [Title]` / `:::` → `> **Danger:** text`
- `::: details [Title]` / `:::` → keep (use HTML `<details>`)

**Vue components in Markdown:**
- `<Badge text="beta" type="warning" />` → strip or convert to inline text
- `<CodeGroup>` / `<CodeGroupItem>` → sequential code blocks
- `<ClientOnly>` → strip wrapper
- `{{ variable }}` → remove Vue template expressions

**Links:**
- `[[toc]]` → strip (table of contents directive)
- `[text](./other-page.md)` → resolve to absolute path
- `[text](./other-page.md#heading)` → resolve path, keep anchor

**Code blocks:**
- ` ```js{1,3-5} ` → ` ```js ` (strip line highlighting)
- ` ```js:no-line-numbers ` → ` ```js ` (strip options)
- `@[code](./path/to/file)` → read and inline the file content as a code block

## Image handling

VuePress images are served from `.vuepress/public/`:
- `![alt](/images/photo.jpg)` → file is at `docs/.vuepress/public/images/photo.jpg`

The `/` prefix in image paths maps to `.vuepress/public/`. Copy images from there to `public/images/blog/` or `public/images/pages/`.

For co-located images (`![alt](./photo.jpg)`), copy from alongside the content file.

## URL patterns for redirects

VuePress URLs match the directory structure:
- `docs/guide/getting-started.md` → `/guide/getting-started`
- `docs/guide/README.md` → `/guide/`
- `docs/README.md` → `/`

## Common issues

- **Documentation vs blog content**: Most VuePress sites are documentation, not blogs. Decide with the owner whether pages become blog posts, static pages, or are dropped.
- **Minimal frontmatter**: Many VuePress pages have no frontmatter. Titles come from the first `#` heading. The description may need to be generated from the first paragraph.
- **Vue template syntax**: `{{ }}` expressions in content are Vue template syntax, not content. Strip these.
- **VitePress migration**: VitePress is VuePress's successor with similar content format. This guide applies to VitePress sites too (detect via `vitepress` in `package.json`).
- **Sidebar ordering**: VuePress uses `sidebar` config for page ordering. This doesn't transfer but may be useful for understanding the site structure.
