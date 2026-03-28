---
name: og-images
description: "Generate branded OG images for social sharing: per-page and site-wide, using Satori"
user-invokable: false
allowed-tools: Bash(npm run ai-images), Bash(npm run ai-og), Read, Glob, Write
---

Generate branded Open Graph images so every page has a social sharing preview. Called automatically during design, page creation, SEO audits, and deploy — not invoked directly by the owner.

## When to invoke this skill

- After `/anglesite:start` completes the design phase (site-wide OG image)
- After the design-interview skill changes branding (colors, logo, site name)
- After the new-page skill creates a page (per-page OG image)
- When the seo skill flags missing `og:image` tags
- Before deploy if pages lack OG images

## What it does

Two scripts work together:

| Script | Command | Output |
|---|---|---|
| `generate-images.ts` | `npm run ai-images` | `public/og-image.png` (site-wide default, 1200x630) + `public/apple-touch-icon.png` |
| `generate-og-pages.ts` | `npm run ai-og` | `public/images/og/<slug>.png` (per-page, 1200x630) |

Both use Satori to render HTML/CSS layouts to SVG, then rasterize to PNG via resvg. The font (Inter) is loaded from the `@fontsource/inter` npm package — no external fetch at build time.

## How images are resolved

BaseLayout auto-resolves `og:image` in this priority order:

1. **Custom image** — page passes an `image` prop (e.g., blog post with a hero photo)
2. **Per-page generated** — `/images/og/<slug>.png` from `npm run ai-og`
3. **Site-wide default** — `/og-image.png` from `npm run ai-images` (fallback)

Every page always emits an `og:image` meta tag — no page is left without a social preview.

## Templates

Two OG image templates are available:

| Template | When to use | Layout |
|---|---|---|
| `text-only` | No logo/favicon available | Page title + site name centered on brand primary color |
| `text-logo` | `public/favicon.svg` exists | Logo top-left, title centered, site name below |

The script auto-selects `text-logo` when a favicon is present.

## Step 1 — Generate the site-wide default

```sh
npm run ai-images
```

This creates `public/og-image.png` (site name on brand colors) and `public/apple-touch-icon.png`. Run this after any branding change.

## Step 2 — Generate per-page images

```sh
npm run ai-og
```

This scans content collections (`posts`, `services`, `events`) and static pages, then generates an OG image for each page that lacks a custom image. Skips drafts and pages with a custom `image` in frontmatter.

## Step 3 — Report to the owner

After generation, tell the owner what happened:

"I generated social sharing preview images for your pages. When someone shares a link to your site on social media, they'll see a branded card with the page title instead of a blank preview."

If branding changed: "I regenerated your social preview images to match your new colors/logo."

## Branding inputs

The scripts read brand identity from these sources:

| Input | Source | Used for |
|---|---|---|
| Site name | `SITE_NAME` in `.site-config` | Title text on OG images |
| Primary color | `--color-primary` in `src/styles/global.css` | Background color |
| Background color | `--color-bg` in `src/styles/global.css` | Text color (for contrast) |
| Logo | `public/favicon.svg` | Logo in `text-logo` template |

If any of these change, regenerate by running both commands.

## Cache behavior

- The font is installed via npm (`@fontsource/inter`) and cached in `node_modules`
- Generated images persist in `public/images/og/` across builds
- On Cloudflare Pages, `node_modules` is cached between deploys
- Images are only regenerated when the script runs — not automatically on content change

## Integration with other skills

| Skill | Integration |
|---|---|
| **start** | Run `npm run ai-images` after design phase completes |
| **design-interview** | Run both commands after branding changes |
| **new-page** | Run `npm run ai-og` after creating the page |
| **deploy** | Run `npm run ai-og` before build to catch any missing images |
| **seo** | Run `npm run ai-og` when audit flags missing `og:image` |
| **syndicate** | Per-page OG images double as social card previews |
