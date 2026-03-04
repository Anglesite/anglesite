# Importing from Gatsby

Gatsby is a React-based SSG (56k GitHub stars) that uses a GraphQL data layer and plugin ecosystem. Content locations and frontmatter vary by starter template and plugin configuration.

See [ssg-migrations.md](ssg-migrations.md) for shared SSG migration guidance including frontmatter conventions, template syntax stripping patterns, image handling, and redirect generation. This doc covers only what's specific to Gatsby.

## How it detects this platform

Config file: `gatsby-config.js` or `gatsby-config.ts` in the project root.

## Where content lives

Gatsby uses `gatsby-source-filesystem` to define content directories. Check `gatsby-config.js` for the `source` plugin configuration:

```js
{
  resolve: `gatsby-source-filesystem`,
  options: {
    path: `${__dirname}/content/blog`,
    name: `blog`,
  },
}
```

Common content locations:
- `content/blog/` — most common (gatsby-starter-blog)
- `src/content/` or `src/pages/` — some starters
- `content/posts/` — varies

Images may be alongside content (in the same directory) or in a separate source:
- `content/blog/my-post/index.md` + `content/blog/my-post/hero.jpg` (co-located)
- `src/images/` or `static/images/` (shared)

## Frontmatter mapping

| Gatsby field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` | `description` | Direct copy |
| `date` | `publishDate` | ISO 8601 → YYYY-MM-DD |
| `tags` | `tags` | Direct copy |
| `slug` | filename | Sometimes computed from directory name |
| `featuredImage` or `cover` or `hero` | `image` | May be a relative path to co-located file |
| `draft` or `published` | `draft` | Invert `published` if needed |

The default `gatsby-starter-blog` uses: `title`, `date`, `description`. Other starters add their own fields.

## Content conversion

Gatsby content is Markdown or MDX:

**MDX components** — same as Next.js:
- Strip `import` statements
- Convert `<Image>` to `![alt](src)`
- Convert `<Link>` to `[text](href)`
- Strip custom layout components

**gatsby-remark plugins** add features that may appear in content:
- `gatsby-remark-images`: Images use standard Markdown syntax but are processed at build time. The syntax transfers directly.
- `gatsby-remark-prismjs`: Code blocks use standard fenced syntax. No conversion needed.
- `gatsby-remark-autolink-headers`: Adds anchor links to headings automatically. No content change needed.
- `gatsby-remark-embedder`: Embeds from URLs (YouTube, Twitter). Flag for manual review.

## Image handling

Gatsby images are commonly co-located with content:

```
content/blog/my-post/
├── index.md
├── hero.jpg
└── screenshot.png
```

References in content use relative paths: `![alt](./hero.jpg)`.

Copy all images from the content directory to `public/images/blog/` and update paths. Also check `static/` for shared images (Gatsby copies `static/` to the build root).

For `gatsby-image` / `gatsby-plugin-image` usage in MDX (e.g., `<StaticImage src="..." />`), extract the `src` path and convert to standard Markdown image syntax.

## URL patterns for redirects

Gatsby generates URLs from the content file path or the `slug` field in `gatsby-node.js`. Common patterns:

| Pattern | Example |
| --- | --- |
| Default (from path) | `/blog/my-post/` |
| Custom slug | `/articles/custom-slug/` |
| Date-based | `/2024/03/my-post/` |

Check `gatsby-node.js` for `createPages` logic to understand the URL generation pattern.

## Common issues

- **GraphQL-driven content**: Gatsby's data layer uses GraphQL. If content comes from a headless CMS (Contentful, Sanity, DatoCMS), there are no local files to import. Ask the owner to export from the CMS.
- **Plugin-dependent behavior**: Many features (image optimization, RSS, sitemap) are handled by plugins, not content files. These don't need migration.
- **Co-located images**: Content and images in the same directory is common but requires moving both during import.
- **Starter template variety**: There are hundreds of Gatsby starters with different conventions. Always inspect the actual project rather than assuming a structure.
- **MDX v1 vs v2**: Older Gatsby projects use MDX v1 syntax (slightly different JSX handling). Both versions produce similar Markdown after stripping components.
