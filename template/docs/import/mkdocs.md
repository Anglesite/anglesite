# Importing from MkDocs

MkDocs is a Python-based documentation SSG (22k GitHub stars). Content is plain Markdown files organized in a `docs/` directory, configured by a `mkdocs.yml` file.

## How it detects this platform

Config file: `mkdocs.yml` in the project root.

## Where content lives

- **Pages**: `docs/` directory (configurable via `docs_dir` in `mkdocs.yml`)
- **Images**: `docs/images/`, `docs/assets/`, or `docs/img/`

### Directory structure

```
docs/
├── index.md          → /
├── getting-started.md → /getting-started/
├── guide/
│   ├── installation.md → /guide/installation/
│   └── configuration.md → /guide/configuration/
└── images/
    └── screenshot.png
```

The navigation structure is defined in `mkdocs.yml` under `nav:`:

```yaml
nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - Guide:
    - Installation: guide/installation.md
    - Configuration: guide/configuration.md
```

## Frontmatter mapping

MkDocs supports YAML frontmatter but many projects don't use it — pages are plain Markdown with the title derived from the first `#` heading or from `mkdocs.yml` nav entries.

| MkDocs field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | From frontmatter, first `#` heading, or `mkdocs.yml` nav |
| `description` | `description` | From frontmatter or generate from first paragraph |
| — | `publishDate` | No date in MkDocs — use file modification date or current date |
| `tags` | `tags` | Only if using the tags plugin |

**Missing fields strategy:**
- `title`: Extract from first `#` heading in the content, or from the `nav` entry in `mkdocs.yml`
- `description`: Generate from the first paragraph of content
- `publishDate`: Use the file's git commit date, or the current date as fallback
- `tags`: Only available if the MkDocs tags plugin is configured

## Content conversion

MkDocs uses standard Markdown, but the popular Material for MkDocs theme adds extensions:

**Admonitions:**
- `!!! note "Title"` / `    Content` → `> **Note — Title:** Content`
- `!!! warning` / `    Content` → `> **Warning:** Content`
- `!!! tip`, `!!! info`, `!!! danger`, `!!! bug`, `!!! example`, `!!! quote`
- `??? note "Title"` (collapsible) → `<details><summary>Title</summary>Content</details>`

Admonition content is indented by 4 spaces under the `!!!` marker.

**Content tabs:**
- `=== "Tab 1"` / `    Content` → `### Tab 1` heading
- Sequential tab blocks become sequential headings

**Code annotations:**
- ` ```python` with `# (1)!` markers → strip annotation markers
- Annotation definitions below the code block → strip or convert to comments

**Markdown extensions (from `mkdocs.yml` → `markdown_extensions`):**
- `attr_list`: `{ .class #id }` → strip
- `md_in_html`: HTML blocks with Markdown inside → convert to plain Markdown
- `pymdownx.superfences`: Mermaid diagrams → note for manual review
- `pymdownx.highlight`: Code highlighting → standard fenced code blocks
- `pymdownx.emoji`: `:emoji_name:` → keep as-is or convert to Unicode
- `pymdownx.keys`: `++ctrl+alt+delete++` → `Ctrl+Alt+Delete`
- `pymdownx.mark`: `==highlighted==` → `**highlighted**`
- `pymdownx.critic`: `{++addition++}`, `{--deletion--}` → strip markers, keep final text
- `pymdownx.tasklist`: `- [x] item` → keep (standard Markdown)

**Macros plugin:**
- `{{ variable }}` → strip (Jinja2 template syntax)
- `{% include "file.md" %}` → inline the file content or strip

## Image handling

MkDocs images are relative to the content file or the `docs/` root:
- `![alt](images/photo.jpg)` → file at `docs/images/photo.jpg`
- `![alt](../images/photo.jpg)` → relative path
- `![alt](/images/photo.jpg)` → absolute from docs root

Copy from `docs/images/` (or equivalent) to `public/images/blog/` or `public/images/pages/`.

## URL patterns for redirects

MkDocs generates URLs from the directory structure with trailing slashes:
- `docs/guide/setup.md` → `/guide/setup/`
- `docs/index.md` → `/`

## Common issues

- **No dates**: MkDocs is documentation-focused and has no concept of publish dates. Fall back to git history or file modification dates.
- **Admonition syntax is unique**: The `!!! type` syntax with 4-space indentation is specific to Python-Markdown. It's the most common conversion issue.
- **Material theme features**: Material for MkDocs adds many extensions. Check `mkdocs.yml` → `markdown_extensions` to know which syntax to expect.
- **Documentation vs blog**: MkDocs sites are almost always documentation. Decide with the owner what becomes blog posts (if anything) vs static pages.
- **Blog plugin**: Material for MkDocs has a blog plugin that adds date-based posts at `docs/blog/posts/`. If present, these are the most likely candidates for blog post import.
- **Very large sites**: MkDocs documentation sites can have hundreds of pages. Ask the owner which sections to import rather than importing everything.
