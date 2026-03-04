# Importing from Hexo

Hexo is a Node.js-based blogging framework (39k GitHub stars) popular in the Chinese developer community. It uses Markdown with YAML frontmatter and Nunjucks-style template tags.

## How it detects this platform

Config file: `_config.yml` in the project root AND `package.json` containing `"hexo"` as a dependency.

Disambiguate from Jekyll: Jekyll also uses `_config.yml`, but Hexo always has `hexo` in `package.json`.

## Where content lives

- **Blog posts**: `source/_posts/`
- **Drafts**: `source/_drafts/`
- **Pages**: `source/` root (non-underscore directories)
- **Images**: `source/images/` or alongside posts in `source/_posts/`

Hexo supports "post asset folders" — when enabled, each post gets its own directory:

```
source/_posts/
├── my-post.md
├── my-post/
│   ├── photo.jpg
│   └── diagram.png
```

Check `_config.yml` for `post_asset_folder: true`.

## Frontmatter mapping

| Hexo field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `date` | `publishDate` | YYYY-MM-DD HH:mm:ss → YYYY-MM-DD |
| `tags` | `tags` | Array or multiline YAML list |
| `categories` | `tags` | Hexo categories are hierarchical — flatten to tags |
| `description` or `excerpt` | `description` | Not standard in Hexo — may need to extract from content |
| `cover` or `thumbnail` | `image` | Theme-dependent |
| `draft` | `draft` | Hexo uses `source/_drafts/` for drafts |

**Note:** Hexo does not have a standard `description` frontmatter field. If missing, generate from the first paragraph of the content, or use the `<!-- more -->` excerpt separator — everything before `<!-- more -->` is the excerpt.

### Hexo categories

Hexo categories are hierarchical (nested), unlike flat tags:

```yaml
categories:
  - [Tech, JavaScript]
  - Life
```

This means "Tech → JavaScript" and "Life". Flatten to tags: `["tech", "javascript", "life"]`.

## Content conversion

Hexo uses Nunjucks-style tags embedded in Markdown:

**Tag plugins to convert:**
- `{% codeblock [title] [lang] %}...{% endcodeblock %}` → fenced code blocks
- `{% blockquote [author] %}...{% endblockquote %}` → `> text`
- `{% img [class] src [width] [height] [alt] %}` → `![alt](src)`
- `{% asset_img filename [alt] %}` → `![alt](/images/blog/filename)` (post asset)
- `{% link text url [title] %}` → `[text](url)`
- `{% youtube video_id %}` → note for manual review
- `{% jsfiddle id %}` → note for manual review
- `{% post_link slug [title] %}` → `[title](/blog/slug)`
- `{% post_path slug %}` → `/blog/slug`

**Excerpt separator:** Hexo uses `<!-- more -->` to split excerpt from full content. Remove this marker during import — Anglesite uses the `description` frontmatter field instead.

## Image handling

Hexo images may be in:
1. `source/images/` — shared images
2. Post asset folders (if `post_asset_folder: true`) — alongside the `.md` file
3. External URLs

For option 1, copy from `source/images/` to `public/images/blog/`.
For option 2, copy from `source/_posts/post-name/` to `public/images/blog/`.
Convert `{% asset_img %}` tags to standard Markdown image references.

## URL patterns for redirects

Hexo's default permalink is `:year/:month/:day/:title/`. Customized in `_config.yml` under `permalink:`.

Common patterns:

| Permalink setting | Example URL |
| --- | --- |
| `:year/:month/:day/:title/` (default) | `/2024/03/15/my-post/` |
| `:year/:month/:title/` | `/2024/03/my-post/` |
| `:title/` | `/my-post/` |
| `blog/:title/` | `/blog/my-post/` |

Read `_config.yml` to determine the permalink structure.

## Common issues

- **No standard description field**: Hexo doesn't enforce a `description` in frontmatter. Generate from content if missing.
- **Hierarchical categories**: Hexo's nested category syntax needs flattening for Anglesite's flat tag list.
- **Chinese content**: Many Hexo blogs are in Chinese. Content imports normally — just ensure proper UTF-8 handling.
- **Theme-specific frontmatter**: Popular Hexo themes (NexT, Butterfly, Fluid) add custom frontmatter fields. Check the theme documentation to identify image and feature fields.
- **Post asset folders**: When enabled, images are relative to the post. Convert `{% asset_img %}` tags and update paths.
