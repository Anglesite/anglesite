# SSG Conversion Workflow

Convert an existing static site generator project in the current directory to Anglesite (Astro + Keystatic CMS).

To import content from a website URL instead, see [import.md](import.md).

## Supported SSGs

Hugo, Jekyll, Next.js, Gatsby, Nuxt, Docusaurus, VuePress, MkDocs, Eleventy, Hexo

## Conversion principles

1. **Content accuracy over visual fidelity** — get all content moved correctly first, design tweaks after
2. **Copy all images locally** — images are copied from the source project, not linked
3. **Generate descriptions** from first 1-2 sentences if no excerpt field exists
4. **Strip all template syntax** — shortcodes, Liquid tags, Vue components, admonitions become plain Markdown
5. **Build must pass** — fix every build error before presenting results
6. **Existing files are preserved** — new Anglesite files are created alongside the old project files

## How it works

1. Detect the SSG from config files in the current directory
2. Read the shared guidance doc: `docs/import/ssg-migrations.md`
3. Read the platform-specific doc: `docs/import/PLATFORM.md`
4. Scaffold Anglesite project in the current directory
5. Convert content to Markdoc (`.mdoc`) files in `src/content/posts/`
6. Copy and optimize images to `public/images/blog/`
7. Generate redirect mappings from old URL patterns
8. Run `npm run build` to verify
9. Present results

## Content format

Converted posts land as `.mdoc` files in `src/content/posts/` with frontmatter:

```yaml
title: "Post Title"
description: "First 1-2 sentences"
publishDate: "2024-01-15"
```

## After conversion

- Review all converted content for accuracy
- Check that template syntax was fully stripped
- Verify the build passes: `npm run build`
- Preview locally: `npm run dev`
- Deploy when ready: `/anglesite:deploy` (or merge `draft` → `main` and push)
- Once satisfied, remove old SSG config and source files
