# Importing from Eleventy

Eleventy (11ty) is a flexible, zero-config SSG (19k GitHub stars) that supports multiple template languages. Its flexibility means content can be in many formats and locations.

## How it detects this platform

Config file: `.eleventy.js`, `eleventy.config.js`, `eleventy.config.mjs`, or `eleventy.config.cjs` in the project root.

## Where content lives

Eleventy has no default content directory — it processes the entire project root by default (minus `node_modules/` and the output directory). Content locations are set in the config file's `dir` option:

```js
module.exports = function(eleventyConfig) {
  return {
    dir: {
      input: "src",      // or ".", "content", etc.
      output: "_site",
    }
  };
};
```

Common patterns:
- **Blog posts**: `src/posts/`, `src/blog/`, `posts/`, or `blog/`
- **Pages**: `src/pages/` or `src/` root
- **Images**: `src/images/`, `images/`, `assets/images/`
- **Data**: `src/_data/` or `_data/` (global data files)

**Detection strategy:** Read the Eleventy config to find `dir.input`, then search that directory for `.md` files. If no config exists, search the project root.

## Frontmatter mapping

| Eleventy field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` or `summary` | `description` | Direct copy |
| `date` | `publishDate` | Eleventy supports `date: 2024-03-15` or special values like `Last Modified` |
| `tags` | `tags` | Direct copy — but Eleventy uses tags for collections, not just taxonomy |
| `image` or `featured_image` | `image` | Varies by project |
| `draft` or `eleventyExcludeFromCollections` | `draft` | `eleventyExcludeFromCollections: true` → `draft: true` |
| `permalink` | — | Custom URL pattern — use for redirect mapping |
| `layout` | — | Skip |

**Important:** Eleventy uses `tags` for its collection system, not just content taxonomy. A post might have `tags: ["posts"]` to indicate it belongs to the "posts" collection. Filter out collection tags (like "posts", "blog", "pages") and keep only topical tags.

## Content conversion

Eleventy supports multiple template languages. The file extension determines the renderer:
- `.md` — Markdown (most common for blog content)
- `.njk` — Nunjucks
- `.liquid` — Liquid
- `.11ty.js` — JavaScript templates
- `.hbs` — Handlebars

**For Markdown files:** Content is standard Markdown. Strip any Nunjucks/Liquid tags:
- `{% include "file.njk" %}` → remove
- `{{ variable }}` → remove or resolve to the value from `_data/`
- `{% image "src", "alt" %}` → `![alt](src)` (common Eleventy image shortcode)
- `{% set var = value %}` → remove

**For Nunjucks/Liquid files:** These are primarily template files, not content. If they contain substantial prose content (not just layout logic), extract the text content and convert to Markdown.

**Paired shortcodes:**
- `{% callout %}...{% endcallout %}` → `> text`
- `{% codepen "url" %}` → note for manual review

## Image handling

Eleventy images may use the `eleventy-img` plugin, which generates responsive image variants. Source images are typically in:
- `src/images/` or `images/`
- Co-located with content files
- Referenced via shortcodes: `{% image "src/images/photo.jpg", "alt text" %}`

Copy source images (not the generated variants) to `public/images/blog/`. The `eleventy-img` output directory (often `_site/img/` or `img/`) contains processed versions — use the originals.

## URL patterns for redirects

Eleventy generates URLs from file paths or `permalink` frontmatter:
- `src/posts/my-post.md` → `/posts/my-post/`
- `permalink: /blog/{{ title | slugify }}/` → computed from title

Check both frontmatter `permalink` values and the directory structure. Eleventy's default adds a trailing slash.

## Common issues

- **Collection tags vs topic tags**: Eleventy's tag system is overloaded. `tags: ["posts", "javascript", "tutorial"]` means the post is in the "posts" collection AND tagged with "javascript" and "tutorial". The collection tag should not be imported as an Anglesite tag.
- **Multiple template formats**: A single Eleventy project may mix `.md`, `.njk`, and `.liquid` files. Focus on Markdown files for content import.
- **Directory data files**: Eleventy supports `posts.json` or `posts.11tydata.js` files that set default frontmatter for all files in a directory. Read these to fill in missing frontmatter on individual posts.
- **No standard structure**: Eleventy's flexibility means every project is different. Always inspect the config and explore the directory before assuming a structure.
- **Computed data**: Eleventy supports computed frontmatter via `eleventyComputed`. These values won't be in the files — they're generated at build time.
