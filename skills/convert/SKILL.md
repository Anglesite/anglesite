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

1. **Content accuracy and visual identity.** The first pass prioritizes getting all content moved correctly and preserving the source site's branding (colors, fonts, logo, layout structure). Pixel-perfect fidelity isn't the goal, but the converted site should be recognizable as the same brand.
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

Use Glob to check for `src/content.config.ts`.

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
POST_URL_PREFIX=blog
```

Note: `POST_URL_PREFIX` defaults to `blog` here. It will be updated after the
URL structure question in Step 1 if the owner chooses to keep root-level URLs.

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

### Choose the URL structure

Detect the source site's blog post URL pattern from the SSG config and content
files. For example, Eleventy with `permalink: /{{ page.fileSlug }}/` means posts
live at `/{slug}/`, while Jekyll's default is `/YYYY/MM/DD/{slug}/`.

Tell the owner what you found and ask what URL structure they want:

> "Your [Platform] site currently serves posts at `/{slug}/` (e.g.,
> `/copper-charlie/`). For the converted site, would you like to:"
>
> - **Keep `/{slug}/`** — posts stay at the same URLs, no redirects needed
> - **Use `/blog/{slug}/`** — posts move under `/blog/`, old URLs redirect
>   automatically

If you can't detect the source pattern, default to offering both options.

Wait for their answer. Store the choice as `POST_URL_PREFIX` in `.site-config`:

- If they chose `/{slug}/`, set `POST_URL_PREFIX=` (empty — root-level posts)
- If they chose `/blog/{slug}/`, set `POST_URL_PREFIX=blog` (the default)

This value determines:
- Where `[slug].astro` is placed: `src/pages/POST_URL_PREFIX/[slug].astro`
  (or `src/pages/[slug].astro` if empty)
- The `href` prefix in homepage and listing templates
- Whether redirects are needed for blog post URLs

If `POST_URL_PREFIX` is empty and you move `[slug].astro` out of `src/pages/blog/`,
ensure the new file still includes `export const prerender = true;` in its frontmatter.
This is required for `getStaticPaths()` to work in dev mode (hybrid output).

## Step 1.5 — Extract visual identity

Tell the owner:
> "Before converting your content, I'm reading your site's design — colors, fonts,
> logo, and layout — so the converted site keeps your existing look and feel."

The scaffold creates generic defaults (blue `#2563eb`, system fonts, plain text
header). This step replaces those with values extracted from the source project.

### 1.5a — Find and read source CSS

Use Glob to find CSS files in the source project. Common locations:

| Platform | CSS locations |
| --- | --- |
| Hugo | `assets/css/`, `static/css/`, `themes/*/assets/css/` |
| Jekyll | `_sass/`, `assets/css/`, `css/` |
| Next.js | `styles/`, `src/styles/`, `app/globals.css` |
| Gatsby | `src/styles/`, `src/css/` |
| Nuxt | `assets/css/`, `assets/styles/` |
| Docusaurus | `src/css/` |
| VuePress | `.vuepress/styles/` |
| MkDocs | `docs/stylesheets/` |
| Eleventy | `src/_includes/css/`, `src/css/`, `css/`, `_includes/css/` |
| Hexo | `themes/*/source/css/` |

Read all CSS files found. Extract these design tokens:

**Colors** — Look for CSS custom properties (`--color-*`, `--bg-*`, `--text-*`,
`--link-*`, `--accent-*`), or recurring color values in `color:`, `background:`,
`background-color:`, `border-color:` properties. Identify:
- Background color (body/html `background` or `background-color`)
- Text color (body/html `color`)
- Link/primary color (`a` color or most prominent accent)
- Heading color (if different from text)
- Muted/secondary text color
- Surface/card background color
- Border color

**Fonts** — Look for `font-family` on `body`, `html`, headings. Note whether
fonts are system fonts, self-hosted (look for `@font-face`), or external (Google
Fonts links — these will be self-hosted per ADR-0008).

**Layout** — Look for `max-width` on the main content container. Note the value
to apply to `--max-width`.

**Dark mode** — Check for `@media (prefers-color-scheme: dark)` or a
`.dark`/`[data-theme="dark"]` selector. If present, note the dark palette.

**Accessibility** — Check for `@media (prefers-contrast: more)`,
`prefers-reduced-motion`, or `color-scheme` meta declarations.

### 1.5b — Read layout templates

Use Glob to find layout/template files. Common locations:

| Platform | Layout locations |
| --- | --- |
| Hugo | `layouts/_default/baseof.html`, `layouts/partials/` |
| Jekyll | `_layouts/default.html`, `_includes/` |
| Next.js | `src/app/layout.tsx`, `pages/_app.tsx`, `components/Layout.tsx` |
| Gatsby | `src/components/layout.js`, `src/templates/` |
| Nuxt | `layouts/default.vue`, `components/` |
| Docusaurus | `src/theme/Layout/`, `src/components/` |
| VuePress | `.vuepress/theme/layouts/` |
| MkDocs | `overrides/` |
| Eleventy | `src/_includes/`, `_includes/`, `layouts/` |
| Hexo | `themes/*/layout/` |

Read the main layout file. Extract:

**Header structure:**
- Logo image path and alt text (e.g., `<img src="/img/logo.svg">`)
- Site title text or element
- Navigation links (names and hrefs)

**Footer structure:**
- Social media links (platform and URL for each)
- Copyright text or license information
- Any badges or certifications

**Meta tags:**
- `color-scheme` meta tag value
- Any additional meta tags worth preserving

### 1.5c — Read data/config files

Many SSGs store site metadata in data files:

| Platform | Metadata locations |
| --- | --- |
| Hugo | `config.toml` (`[params]`), `data/` |
| Jekyll | `_config.yml`, `_data/` |
| Next.js | `package.json`, custom config files |
| Gatsby | `gatsby-config.js` (`siteMetadata`) |
| Nuxt | `nuxt.config.ts` |
| Eleventy | `src/_data/`, `_data/` (JSON/JS files) |
| Hexo | `_config.yml` |

Look for:
- Site title, description, author name
- Social media handles/URLs
- Logo file reference
- License or copyright text

### 1.5d — Copy static assets

Use Glob to find logo files, favicons, and avatar images in the source project:

```sh
find . -maxdepth 4 -type f \( -name "logo.*" -o -name "favicon.*" -o -name "avatar.*" -o -name "apple-touch-icon.*" \) -not -path "*/node_modules/*" -not -path "*/_site/*" -not -path "*/dist/*"
```

Copy found assets to `public/`:

```sh
cp SOURCE_LOGO public/logo.EXT
```

If a `favicon.svg` or `favicon.ico` is found, copy it to replace the scaffold default.

### 1.5e — Apply extracted design to Anglesite

**Update `src/styles/global.css`** — Use the Edit tool to replace the `:root`
CSS custom properties block with the extracted values. Map source colors to
Anglesite tokens:

| Anglesite token | Source value |
| --- | --- |
| `--color-primary` | Link color or main accent |
| `--color-accent` | Secondary accent (or derive from primary) |
| `--color-bg` | Body background |
| `--color-text` | Body text color |
| `--color-muted` | Secondary/lighter text |
| `--color-surface` | Card/section background |
| `--color-border` | Border color |
| `--font-heading` | Heading font-family |
| `--font-body` | Body font-family |
| `--max-width` | Content max-width (convert to rem if in px: divide by 16) |

If the source uses external fonts (Google Fonts), download the font files and
add `@font-face` declarations at the top of `global.css` with the files in
`public/fonts/`. Never link to external font services (ADR-0008).

If the source has dark mode support, add a `@media (prefers-color-scheme: dark)`
block after the `:root` block with the dark palette mapped to the same tokens.

If the source has `prefers-contrast: more` or `prefers-reduced-motion` support,
add those media queries as well.

If the source has custom blockquote, code, or other element styling that differs
significantly from the scaffold defaults, add those styles to the appropriate
sections of `global.css`.

**Update `src/layouts/BaseLayout.astro`** — Use the Edit tool to update:

1. **Header**: If the source has a logo, add an `<img>` tag. If it has
   navigation, add a `<nav>` element with the extracted links. Structure:
   ```html
   <header class="h-card">
     <a href="/" class="p-name u-url">
       <img src="/logo.EXT" alt="SITE_NAME logo" width="W" height="H" />
       SITE_NAME
     </a>
     <nav>
       <a href="/about/">About</a>
       <a href="/blog/">Blog</a>
     </nav>
   </header>
   ```

2. **Footer**: If the source has social links, add them. If it has a license,
   include it. Structure:
   ```html
   <footer>
     <nav class="social-links">
       <a href="URL" rel="me">Platform</a>
     </nav>
     <p>&copy; YEAR OWNER_NAME</p>
   </footer>
   ```

3. **Meta tags**: If the source had `<meta name="color-scheme" content="dark light">`,
   add it to the `<head>`.

4. **HTML lang**: If the source used a different `lang` attribute, update it.

**Add header/footer CSS** if needed — add styles for the nav and social links to
`global.css`:

```css
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

header nav {
  display: flex;
  gap: var(--space-md);
}

header nav a {
  text-decoration: none;
  color: var(--color-text);
}

.social-links {
  display: flex;
  gap: var(--space-sm);
}
```

**Fallback**: If no CSS or layout files are found (unlikely but possible),
skip this step and proceed with scaffold defaults. Tell the owner:
> "I couldn't find design files in your project. The site will use default
> styling — you can customize colors and fonts anytime by asking me."

## Step 2 — Convert blog posts

Tell the owner:
> "I'm converting your blog posts now. I'll keep you posted on progress."

Ensure the image directory exists:

```sh
mkdir -p public/images/blog
```

For each post in BLOG_POSTS:

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/content-conversion.md` for the full
content conversion, image optimization, and `.mdoc` writing procedures.

For each post in BLOG_POSTS:

1. Parse the frontmatter using the field mapping from the platform doc
2. Convert body content following the shared conversion procedures — also apply
   the platform doc's "Content conversion" section and
   `${CLAUDE_PLUGIN_ROOT}/docs/import/ssg-migrations.md` for platform-specific
   template syntax stripping
3. Copy and optimize images per the shared procedures. The platform doc's
   "Image handling" section specifies where images are stored (e.g.,
   `static/img/` for Docusaurus, `source/images/` for Hexo, `content/` for
   Hugo page bundles)
4. Write the `.mdoc` file per the shared procedures. Use `-converted` suffix
   for slug conflicts

## Step 3 — Handle static pages

If the owner chose "Everything", process STATIC_PAGES.

For each page, read the source file and convert the content to clean Markdown
(same template syntax stripping as Step 2a).

Create a `.astro` file in `src/pages/` with the page title, meta description,
`BaseLayout` wrapper, and the converted content.

For pages that are primarily image galleries (10+ images), create a gallery page
with a responsive CSS grid layout.

## Step 4 — Generate redirect mappings

Read `POST_URL_PREFIX` from `.site-config` to determine the target URL pattern.

**Skip redirects when source and target URL patterns match.** For example, if the
source Eleventy site serves posts at `/{slug}/` and the owner chose to keep
`/{slug}/`, no blog post redirects are needed — the URLs are identical. Still
generate redirects for `aliases` or `permalink` overrides that differ from the
default pattern.

If redirects are needed (the URL structure changed), read the existing
`public/_redirects` file. Append new rules — do not overwrite existing entries.

The platform doc's "URL patterns for redirects" section describes the old URL
structure. Generate redirects based on the source file paths and any `permalink`
or `aliases` frontmatter. Use `POST_URL_PREFIX` to compute the target URL
(e.g., `/POST_URL_PREFIX/slug` or `/slug` if the prefix is empty). Common
patterns:
- Hugo `aliases` field → one redirect per alias
- Jekyll date-prefixed filenames → `/YYYY/MM/DD/slug/` → `/POST_URL_PREFIX/slug`
- Hexo permalink config in `_config.yml` → computed old URLs
- Docusaurus → `/docs/path` and `/POST_URL_PREFIX/slug`

Write the updated `_redirects` file, preserving all existing rules and comments.

## Step 4.5 — Update the homepage

The scaffold placeholder in `src/pages/index.astro` must be replaced with
content appropriate for the site type.

Read `SITE_TYPE` from `.site-config`.

**If `SITE_TYPE=blog`:** Replace `src/pages/index.astro` with a blog listing
homepage that shows recent posts. Read `POST_URL_PREFIX` from `.site-config`
to determine the correct link prefix.

Use the **Edit tool** to replace the entire file content with:

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
          <a href={`/POST_URL_PREFIX/${post.id}/`} class="u-url">
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

Replace `POST_URL_PREFIX` with the value from `.site-config`:
- If `POST_URL_PREFIX=blog`, the href becomes `` `/blog/${post.id}/` ``
- If `POST_URL_PREFIX=` (empty), the href becomes `` `/${post.id}/` ``

Replace `SITE_NAME` with the value from `.site-config` and `SITE_DESCRIPTION`
with a brief description of the site.

**If `SITE_TYPE` is not `blog`:** Keep the scaffold placeholder for now — the
owner will customize the homepage during the design phase.

## Step 5 — Build and verify

Follow the build-and-verify procedure in
`${CLAUDE_PLUGIN_ROOT}/skills/shared/content-conversion.md`. Fix all build
errors before presenting results (ADR-0012).

## Step 6 — Present the results

Give the owner a plain-English summary:

> "Your project has been converted! Here's what happened:
>
> **Design:** Carried over your colors, fonts, logo, and layout from the
> original site
> **Blog posts:** 21 of 23 converted successfully
> **Images:** 19 copied and optimized
> **Redirects:** 27 redirect rules added
> **Pages created:** 4 (About, FAQ, Services, Contact)
>
> The design should look close to your original site. If anything looks off
> or you'd like to tweak colors, fonts, or layout, just let me know."

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

See `${CLAUDE_PLUGIN_ROOT}/skills/shared/content-conversion.md` for shared edge
cases (large images, multilingual content, slug conflicts, mixed formats).

### No blog posts in the project

If BLOG_POSTS is empty after discovery:
> "Your project doesn't appear to have blog posts. I can still convert your
> pages and set up redirects."

Continue with Steps 3-4 for pages and redirects only.

### Monorepos and nested projects

If the SSG project is in a subdirectory of a monorepo (e.g., `packages/blog/`),
the content directories are relative to that subdirectory. Adjust Glob paths
accordingly.
