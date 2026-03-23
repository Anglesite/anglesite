---
name: convert
description: "Convert an existing static site generator project (Hugo, Jekyll, Next.js, Gatsby, Nuxt, Docusaurus, VuePress, MkDocs, Eleventy, Hexo) to Anglesite/Astro"
allowed-tools: ["Bash(npm run build)", "Bash(npm install)", "Bash(zsh *)", "Bash(npx sharp-cli *)", "Bash(mkdir *)", "Bash(git add *)", "Bash(git commit *)", "Bash(ls *)", "Bash(wc *)", "Bash(cp *)", "Bash(find src/content/posts *)", "Bash(find public/images *)", "Bash(find */images *)", "Bash(find */public *)", "Bash(find */static *)", "Bash(find */source *)", "Bash(find */content *)", "Bash(find */docs *)", "Bash(find */_posts *)", "Write", "Read", "Glob", "Edit"]
disable-model-invocation: true
---

Convert an existing static site generator project in the current directory to
Anglesite (Astro + Keystatic CMS). Reads content from Hugo, Jekyll, Next.js,
Gatsby, Nuxt, Docusaurus, VuePress, MkDocs, Eleventy, or Hexo projects.
Migrates posts and pages into Markdoc, copies images, and generates redirect
mappings. Your existing files are preserved — new Anglesite files are created
alongside them.

## Shared guidance

Before reading the platform-specific doc, read `${CLAUDE_PLUGIN_ROOT}/docs/import/ssg-migrations.md`
for template syntax stripping, frontmatter mapping conventions, image file
handling, and config-driven content discovery.

The platform-specific docs (`${CLAUDE_PLUGIN_ROOT}/docs/import/PLATFORM.md`) cover only what's unique
to that platform — config structure, content directories, template syntax
families, and URL patterns.

## Conversion principles

1. **Content accuracy over visual fidelity.** The first pass prioritizes getting all content moved correctly. Design tweaks come after.
2. **Copy all images locally.** Images are copied from the source project to `public/images/blog/`. No references to old paths.
3. **Generate descriptions from content.** If the frontmatter has no excerpt field, use the first 1-2 sentences of the post body.
4. **Preserve provenance.** Every converted post gets a `syndication` URL if the old site had a known public URL.
5. **Strip all template syntax.** Shortcodes, Liquid tags, Vue components, Nunjucks tags, admonitions — all stripped or converted to plain Markdown.
6. **Build must pass.** Fix every build error before presenting results to the owner (ADR-0012).

## Architecture decisions

- [ADR-0002 Keystatic CMS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0002-keystatic-local-cms.md) — content lands as `.mdoc` files in `src/content/posts/`
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — embedded widgets and component tags must be stripped
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — converted content must be fully self-contained
- [ADR-0012 Verify first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0012-verify-before-presenting.md) — build must pass after conversion before presenting results

Before every tool call or command that will trigger a permission prompt, explain
what you're about to do and why. The owner is non-technical.

## Step 0 — Detect the project

### 0a — Already an Anglesite project?

Use Glob to check for `src/content/config.ts`.

If it exists AND the current directory also has an SSG config file (see table
below), treat it as a conversion that was already scaffolded — read `.site-config`
and skip to **Step 1**.

If it exists but there's no SSG project here, tell the owner:

> "This is already an Anglesite project. If you want to import content from a
> website, use `/anglesite:import` with the URL instead."

Stop.

### 0b — Detect the SSG

Use Glob to check for these config files in the current directory:

| Config file(s) | Platform |
| --- | --- |
| `hugo.toml`, `hugo.yaml`, `hugo.json`, or `config.toml` (with `[params]`) | Hugo |
| `_config.yml` AND (`Gemfile` with `jekyll` OR `_posts/` directory) | Jekyll |
| `next.config.js`, `next.config.mjs`, or `next.config.ts` | Next.js |
| `gatsby-config.js` or `gatsby-config.ts` | Gatsby |
| `nuxt.config.js`, `nuxt.config.ts`, or `nuxt.config.mjs` | Nuxt |
| `docusaurus.config.js` or `docusaurus.config.ts` | Docusaurus |
| `.vuepress/config.js` or `.vuepress/config.ts` (in `docs/` or root) | VuePress |
| `mkdocs.yml` | MkDocs |
| `.eleventy.js`, `eleventy.config.js`, `eleventy.config.ts`, `eleventy.config.mjs`, or `eleventy.config.cjs` | Eleventy |
| `_config.yml` AND `package.json` containing `"hexo"` | Hexo |
| `astro.config.mjs`, `astro.config.ts`, or `astro.config.js` (without Anglesite/Keystatic) | Non-Anglesite Astro |

If no SSG is detected, tell the owner:

> "I don't recognize the project type in this directory. If you want to import
> content from a website URL, use `/anglesite:import` instead. Or tell me which
> generator this project uses and where the content files are."

Wait for guidance.

If an SSG is detected, tell the owner:

> "I see you have a [Platform] project here. I can convert this to an Anglesite
> site — that means moving your content into Astro with Keystatic CMS, so you
> get a visual editor and easy publishing to Cloudflare Pages.
>
> Your existing files won't be deleted — I'll read your content and create new
> files alongside them. Would you like to go ahead?"

Wait for confirmation. If they decline, stop.

Store the detected platform as PLATFORM.

### 0c — Scaffold Anglesite

```sh
zsh ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.sh --yes .
```

Ask the essentials (normally gathered by `/anglesite:start`):

1. "What's your name?"
2. "What should we call the site?"

Save to `.site-config` using the **Write tool**:

```
SITE_TYPE=blog
OWNER_NAME=Name
SITE_NAME=Site Name
DEV_HOSTNAME=sitename.local
AI_MODEL=Claude Opus 4.6
EXPLAIN_STEPS=true
```

```sh
npm install
```

## Step 1 — Discover content

Tell the owner:
> "I'm reading through your [Platform] project to catalog all the content.
> This takes about a minute."

Read the platform doc (`${CLAUDE_PLUGIN_ROOT}/docs/import/PLATFORM.md`) and the shared SSG guidance
(`${CLAUDE_PLUGIN_ROOT}/docs/import/ssg-migrations.md`) to learn:
- Where content files live (directory structure)
- Frontmatter field mapping to Anglesite fields
- Platform-specific syntax to strip or convert
- Image file locations
- URL patterns for redirect generation

| Platform | Doc reference |
| --- | --- |
| Hugo | `${CLAUDE_PLUGIN_ROOT}/docs/import/hugo.md` |
| Jekyll | `${CLAUDE_PLUGIN_ROOT}/docs/import/jekyll.md` |
| Next.js | `${CLAUDE_PLUGIN_ROOT}/docs/import/nextjs.md` |
| Gatsby | `${CLAUDE_PLUGIN_ROOT}/docs/import/gatsby.md` |
| Nuxt | `${CLAUDE_PLUGIN_ROOT}/docs/import/nuxt.md` |
| Docusaurus | `${CLAUDE_PLUGIN_ROOT}/docs/import/docusaurus.md` |
| VuePress | `${CLAUDE_PLUGIN_ROOT}/docs/import/vuepress.md` |
| MkDocs | `${CLAUDE_PLUGIN_ROOT}/docs/import/mkdocs.md` |
| Eleventy | `${CLAUDE_PLUGIN_ROOT}/docs/import/eleventy.md` |
| Hexo | `${CLAUDE_PLUGIN_ROOT}/docs/import/hexo.md` |

Use Glob to find all `.md` and `.mdx` files in the content directories specified
by the platform doc. Read each file to extract frontmatter and body content.

Build BLOG_POSTS from files in blog/post directories.
Build STATIC_PAGES from files in page/doc directories.

If no SSG is detected (user provided manual guidance), use the directories they
specified.

### Present the inventory

Tell the owner what was found. Example:

> "Here's what I found in your project:
>
> **Blog posts:** 23 posts (July 2024 – February 2026)
> **Pages:** 6 pages (About, FAQ, Services, Contact, Gallery, Docs)
>
> I'll convert all the blog posts and create pages for the static content.
> This will take about 5–10 minutes for a project this size."

Ask:
> "Would you like to convert all of it, or just the blog posts?"
> - **Everything** — posts + pages + redirects (recommended)
> - **Blog posts only** — skip static pages

Wait for their answer before continuing.

## Step 2 — Convert blog posts

Tell the owner:
> "I'm converting your blog posts now. I'll keep you posted on progress."

Ensure the image directory exists:

```sh
mkdir -p public/images/blog
```

For each post in BLOG_POSTS:

### 2a — Convert content

1. Parse the frontmatter using the field mapping from the platform doc
2. Convert the body content to clean Markdown:
   - Strip platform-specific template syntax (shortcodes, Liquid tags, Vue
     components, Nunjucks tags, admonitions) as documented in the platform doc's
     "Content conversion" section and `${CLAUDE_PLUGIN_ROOT}/docs/import/ssg-migrations.md`
   - Convert admonitions (`:::`, `!!!`, custom containers) to blockquotes
   - Strip MDX/JSX imports and component tags
   - Remove template expressions (`{{ }}`, `{% %}`, `{{< >}}`)
   - Keep standard Markdown (headings, lists, links, images, code blocks)
3. Map frontmatter fields per the platform doc's mapping table
4. If `description` is missing, generate from the first paragraph
5. If `publishDate` is missing, use the file's git commit date or modification
   date as fallback

### 2b — Copy and optimize images

Tell the owner (once, not per-post):
> "I'm copying images from your project and optimizing them for the web."

The platform doc's "Image handling" section specifies where images are stored
(e.g., `static/img/` for Docusaurus, `source/images/` for Hexo, `content/` for
Hugo page bundles).

```sh
cp SOURCE_IMAGE "public/images/blog/SLUG-hero.ext"
```

Check file size:

```sh
wc -c < public/images/blog/SLUG-hero.ext
```

If over 500,000 bytes, convert and resize using `sharp-cli` (cross-platform):

```sh
npx sharp-cli -i public/images/blog/SLUG-hero.ext -o public/images/blog/SLUG-hero.webp --width 1200
```

Update image references in the converted Markdown to use local paths.

### 2c — Write the .mdoc file

Assemble frontmatter fields:
- `title`: from source frontmatter
- `description`: from excerpt or generated from first paragraph
- `publishDate`: in YYYY-MM-DD format
- `image`: local path after copy, or omit
- `imageAlt`: derive from post title (e.g., "Hero image for [title]")
- `tags`: from categories/tags data, or `[]`
- `draft`: `false`
- `syndication`: `["ORIGINAL_URL"]` if the old site had a known public URL

Sanitize the slug: lowercase, replace spaces with hyphens, remove characters
other than `[a-z0-9-]`, trim leading/trailing hyphens. If the slug conflicts
with an existing file, append `-converted`.

Write to `src/content/posts/SLUG.mdoc`:

```
---
title: "The Post Title"
description: "A one or two sentence summary of the post."
publishDate: "2024-03-15"
image: "/images/blog/my-post-hero.webp"
imageAlt: "Hero image for The Post Title"
tags: []
draft: false
---

The full post body content in clean Markdown goes here.
```

Rules for the body content:
- No HTML tags — convert everything to Markdown equivalents
- No MDX component syntax — plain Markdown only
- No platform-specific shortcodes or embeds

### 2d — Progress updates

After every 5 posts, tell the owner:
> "Converted 10 of 23 posts so far — about halfway done."

## Step 3 — Handle static pages

If the owner chose "Everything", process STATIC_PAGES.

For each page, read the source file and convert the content to clean Markdown
(same template syntax stripping as Step 2a).

Create a `.astro` file in `src/pages/` with the page title, meta description,
`BaseLayout` wrapper, and the converted content.

For pages that are primarily image galleries (10+ images), create a gallery page
with a responsive CSS grid layout.

## Step 4 — Generate redirect mappings

Read the existing `public/_redirects` file. Append new rules — do not overwrite
existing entries.

The platform doc's "URL patterns for redirects" section describes the old URL
structure. Generate redirects based on the source file paths and any `permalink`
or `aliases` frontmatter. Common patterns:
- Hugo `aliases` field → one redirect per alias
- Jekyll date-prefixed filenames → `/YYYY/MM/DD/slug/` → `/blog/slug`
- Hexo permalink config in `_config.yml` → computed old URLs
- Docusaurus → `/docs/path` and `/blog/slug`

Write the updated `_redirects` file, preserving all existing rules and comments.

## Step 4.5 — Update the homepage

The scaffold placeholder in `src/pages/index.astro` must be replaced with
content appropriate for the site type.

Read `SITE_TYPE` from `.site-config`.

**If `SITE_TYPE=blog`:** Replace `src/pages/index.astro` with a blog listing
homepage that shows recent posts. Use the **Edit tool** to replace the entire
file content with:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { getCollection } from "astro:content";

const allPosts = await getCollection("posts", ({ data }) => {
  return import.meta.env.PROD ? !data.draft : true;
});

const posts = allPosts.sort(
  (a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime(),
);
---

<BaseLayout title="SITE_NAME" description="SITE_DESCRIPTION">
  <ul class="post-list">
    {
      posts.map((post) => (
        <li class="h-entry">
          <a href={`/blog/${post.id}/`} class="u-url">
            <h2 class="p-name">{post.data.title}</h2>
          </a>
          <time
            class="dt-published"
            datetime={post.data.publishDate.toISOString()}
          >
            {post.data.publishDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <p class="p-summary">{post.data.description}</p>
        </li>
      ))
    }
  </ul>
</BaseLayout>
```

Replace `SITE_NAME` with the value from `.site-config` and `SITE_DESCRIPTION`
with a brief description of the site.

**If `SITE_TYPE` is not `blog`:** Keep the scaffold placeholder for now — the
owner will customize the homepage during the design phase.

## Step 5 — Build and verify

Tell the owner:
> "I'm checking that everything converted correctly."

```sh
npm run build
```

If the build fails, diagnose and fix. Common causes:
- Frontmatter doesn't match schema: check `src/content/config.ts` for expected fields
- Invalid `publishDate` format: must be YYYY-MM-DD string
- Missing required `description`: add a placeholder and note for review
- Image path typo: verify file exists in `public/images/`

Fix all build errors before presenting results (ADR-0012).

## Step 6 — Present the results

Give the owner a plain-English summary:

> "Your project has been converted! Here's what happened:
>
> **Blog posts:** 21 of 23 converted successfully
> **Images:** 19 copied and optimized
> **Redirects:** 27 redirect rules added
> **Pages created:** 4 (About, FAQ, Services, Contact)
>
> **One more thing:** This first pass focuses on getting all your content
> moved over accurately. The formatting and layout might not match your old
> site exactly — that's normal. Once you've had a chance to look through it,
> just let me know what you'd like adjusted and I'll make design tweaks
> until it looks right."

If any posts failed to convert, list them so the owner knows what needs attention.

## Step 7 — Save a snapshot

```sh
git add -A
```

```sh
git commit -m "Convert from PLATFORM to Anglesite (N posts, N pages)"
```

Replace PLATFORM and N with actual values.

## Step 8 — Offer next steps

Tell the owner:

> "Your project is converted! Here's what you can do next:
> - **Preview it:** Run `npm run dev` to see your site locally
> - **Customize the design:** Just ask me to change colors, fonts, or layout
> - **Deploy it:** Type `/anglesite:deploy` when you're ready to go live
> - **Clean up old files:** Once you're happy with the conversion, I can help
>   remove the old [Platform] config and source files"

## Keep docs in sync

After this skill runs, update `docs/architecture.md` to note that content was
converted and the date. Example:
> "Content converted from [Platform] on YYYY-MM-DD. N posts, N pages. Redirects
> in `public/_redirects`."

## Edge cases

### No blog posts in the project

If BLOG_POSTS is empty after discovery:
> "Your project doesn't appear to have blog posts. I can still convert your
> pages and set up redirects."

Continue with Steps 3-4 for pages and redirects only.

### Images still too large after conversion

If the converted image is still over 500KB, do not block the conversion. Advise:
> "Some images are still large after optimization. You can resize them or
> replace them with smaller versions."

### Multilingual content

If the project has content in multiple languages:
> "Your project has content in multiple languages. I'll convert the primary
> language for now. Setting up multiple languages requires additional planning."

Convert only primary-language content.

### Slug conflicts

Before writing each `.mdoc` file, sanitize the slug (lowercase, hyphens only,
`[a-z0-9-]`). If it conflicts with an existing file, append `-converted` and
log the conflict.

### Mixed content formats

Some SSG projects use multiple content formats (`.md`, `.mdx`, `.rst`, `.html`).
Convert `.md` and `.mdx` files. For `.rst` and `.html`, inform the owner they
need manual review.

### Monorepos and nested projects

If the SSG project is in a subdirectory of a monorepo (e.g., `packages/blog/`),
the content directories are relative to that subdirectory. Adjust Glob paths
accordingly.
