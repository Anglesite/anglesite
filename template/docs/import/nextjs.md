# Importing from Next.js

Next.js is the most popular React framework (138k GitHub stars). It has no standard content structure — blog implementations vary widely by project, making automatic detection harder than other SSGs.

See [ssg-migrations.md](ssg-migrations.md) for shared SSG migration guidance including frontmatter conventions, template syntax stripping patterns, image handling, and redirect generation. This doc covers only what's specific to Next.js.

## How it detects this platform

Config file: `next.config.js`, `next.config.mjs`, or `next.config.ts` in the project root.

## Where content lives

Next.js has no built-in content layer. Common patterns:

| Pattern | Content location | How to detect |
| --- | --- | --- |
| Contentlayer | `content/` or `posts/` | `contentlayer.config.*` in root |
| next-mdx-remote | `content/`, `posts/`, or `data/` | `next-mdx-remote` in `package.json` |
| @next/mdx | `pages/blog/*.mdx` or `app/blog/*.mdx` | `@next/mdx` in `package.json` |
| Custom loader | varies | Check `lib/` or `utils/` for file-reading code |
| Headless CMS | no local files | Check for CMS SDK in `package.json` |
| Markdown with gray-matter | varies | `gray-matter` in `package.json` |

**Detection strategy:**
1. Check `package.json` for content-related dependencies
2. Look for common content directories: `content/`, `posts/`, `data/blog/`, `_posts/`
3. Search for `.md` or `.mdx` files using Glob
4. If no local content files exist, the blog may use a headless CMS — ask the owner

## Frontmatter mapping

Most Next.js blog starters use YAML frontmatter with these fields:

| Next.js field | Anglesite field | Notes |
| --- | --- | --- |
| `title` | `title` | Direct copy |
| `description` or `excerpt` or `summary` | `description` | Varies by project |
| `date` or `publishedAt` or `createdAt` | `publishDate` | Normalize to YYYY-MM-DD |
| `tags` or `categories` | `tags` | Direct copy |
| `image` or `coverImage` or `ogImage` | `image` | Path varies — may be relative or absolute |
| `slug` | filename | Sometimes computed from filename |
| `draft` or `published` | `draft` | `published: false` → `draft: true` |

Frontmatter field names are not standardized across Next.js projects. Read a few content files first to identify the actual schema.

## Content conversion

Next.js content may be MDX (Markdown + JSX components) or plain Markdown.

**MDX-specific conversions:**
- `import Component from '../components/X'` → remove import statements
- `<Component prop="value" />` → strip or convert to Markdown equivalent
- `<Callout>text</Callout>` → `> text` (blockquote)
- `<Image src="..." alt="..." />` → `![alt](src)`
- `<Link href="...">text</Link>` → `[text](href)`
- `export const metadata = {...}` → extract to frontmatter if not already there

**Code blocks**: MDX uses standard fenced code blocks. These transfer directly.

**Custom components**: Any remaining JSX components that can't be converted to Markdown should be stripped and noted for manual review.

## Image handling

Image locations vary by project:
- `public/images/` or `public/blog/` — most common
- `content/images/` — alongside content files
- External URLs (Unsplash, Cloudinary, etc.)

For local images, copy to `public/images/blog/`. For external URLs, download and self-host to satisfy the no-third-party-dependencies requirement.

## URL patterns for redirects

Next.js routing is file-system based:
- Pages Router: `pages/blog/[slug].js` → `/blog/slug`
- App Router: `app/blog/[slug]/page.js` → `/blog/slug`

Most Next.js blogs use `/blog/slug`, which matches Anglesite's default. Check `next.config.js` for any `redirects()` or `rewrites()` that may indicate non-standard URL patterns.

## Common issues

- **No standard content structure**: This is the biggest challenge. Every Next.js blog is different. The import skill must explore the project to find content files rather than looking in a fixed location.
- **Headless CMS content**: If the blog uses Contentful, Sanity, Strapi, or similar, content isn't in local files. Ask the owner to export from the CMS first.
- **TypeScript/JSX in content**: MDX files may contain complex TypeScript. Strip all non-Markdown content.
- **Dynamic routes with data fetching**: Some Next.js blogs generate pages from API calls (e.g., `getStaticProps` fetching from a database). These have no local content files to import.
- **Monorepo structure**: Next.js projects are sometimes in monorepos (`apps/web/`, `packages/blog/`). The content directory may not be at the repo root.
