---
name: design-import
description: "Import design tokens and page layouts from a Canva site, Figma file, or freedesignmd system to build your Astro site"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: ["Bash(node *)", "Bash(npx sharp-cli *)", "Bash(npx playwright install *)", "Bash(npm install *)", "Bash(npm run dev *)", "Bash(npm run build)", "Bash(mkdir *)", "Bash(curl *)", "Bash(git add *)", "Bash(git commit *)", "Bash(git push *)", "Bash(ls *)", "Bash(npm ls *)", "Bash(grep *)", "WebFetch", "Write", "Read", "Edit", "Glob"]
metadata:
  author: "David W. Keith"
  version: "1.2.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
  argument-hint: "[Canva site URL, Figma file URL, or freedesignmd.com system URL]"
---

Import design tokens (colors, fonts, spacing) and page layouts from a Canva
published site, Figma file, or [freedesignmd.com](https://freedesignmd.com)
design system to build an Astro site that matches. Extracts the visual identity
automatically so the owner doesn't have to describe it manually.

## Architecture decisions

- [ADR-0004 Vanilla CSS](references/docs/decisions/0004-vanilla-css-custom-properties.md) — custom properties for theming, no framework overhead
- [ADR-0005 System fonts](references/docs/decisions/0005-system-fonts.md) — map extracted fonts to performant system stacks
- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — no Canva embeds or external scripts in the output
- [ADR-0011 Owner ownership](references/docs/decisions/0011-owner-controls-everything.md) — imported content must not depend on Canva to display

Before every tool call or command that will trigger a permission prompt, explain
what you're about to do and why. The owner is non-technical.

## Step 0 — Get the URL and detect source

### 0a — Get the URL

If the owner provided a URL as an argument, use it. Otherwise ask:

> "What's the URL of your design? I can import from a Canva site
> (`something.my.canva.site`), a Figma file (`figma.com`), or a freedesignmd
> system (`freedesignmd.com/system/...`)."

Normalize: strip trailing slashes, ensure `https://`. Store as SOURCE_URL.

### 0b — Detect the source platform

Check the URL to determine the source:

**freedesignmd** — if SOURCE_URL contains `freedesignmd.com/system/` or `freedesignmd.com/pattern/`:
Set SOURCE to `freedesignmd`. Skip directly to the freedesignmd path in Step 2.

**Canva** — if SOURCE_URL contains `my.canva.site` or `canva.site`:
Set SOURCE to `canva`. Continue to Step 0c.

**Figma** — if SOURCE_URL contains `figma.com/design/` or `figma.com/file/`:
Tell the owner:

> "Figma import is coming soon! In the meantime, here are two options:
> 1. If your designer can export a PDF, I can extract colors, fonts, and layout from that
> 2. Or we can build your design from scratch — just say `/anglesite:design-interview`"

Stop and wait for the owner's response.

**Claude Design / opendesign / open-design** — if SOURCE_URL is a `claude.ai` share link, an opendesign `localhost:8289` URL, or any other AI design-tool mockup URL:
Tell the owner:

> "Those tools generate HTML mockups, not editable site content. Anglesite
> can't import them directly, but we can match the look. Two options:
> 1. Export the design as a PNG or PDF and I'll pull the colors and fonts from
>    that — say `/anglesite:design-interview` and I'll walk you through it.
> 2. If it's a hero image or graphic for a page, save it to `public/images/`
>    and I'll reference it from your site."

Then read `references/docs/design-tools.md` for the full workflow before responding to follow-ups. Stop and wait.

**Unrecognized** — if the URL doesn't match any pattern:
Tell the owner:

> "I don't recognize that link. Could you double-check the URL? It should be one
> of:
> - `https://something.my.canva.site` for a Canva site
> - `https://figma.com/design/...` for a Figma file
> - `https://freedesignmd.com/system/...` for a freedesignmd design system"

Wait for a corrected URL.

### 0c — Check project state

Use Glob to check for `src/content/config.ts` or `src/content.config.ts` (Astro 5
moved the content config; either path means this is an Anglesite project).

**If already scaffolded:**

Read `.site-config` to load `SITE_NAME` (and `OWNER_NAME` if it happens to be set; do not prompt for it here — design import doesn't need it).

Check if `src/design/design.json` exists:

- If it exists, ask the owner:
  > "You already have a design system set up. Would you like me to:
  > 1. **Replace it entirely** with the design from your Canva site
  > 2. **Keep your current design** and just import the page layouts"

  Set DESIGN_MODE to `replace` or `keep` based on their answer.

- If it does not exist, set DESIGN_MODE to `replace`.

**If not scaffolded:**

Tell the owner:
> "I need to set up the basic project files first. This only takes a moment."

```sh
zsh references/scripts/scaffold.sh --yes .
```

Ask only: "What should we call the site?" — that's `SITE_NAME`. **Don't ask for the owner's name here**; the design-import flow doesn't need it. It will be collected on-demand by skills that do (see "On-demand owner name" in the `start` skill).

Save to `.site-config` using the **Write tool**:

```
SITE_TYPE=business
SITE_NAME=My Site
DEV_HOSTNAME=mysite.local
AI_MODEL=(write your actual model name here)
EXPLAIN_STEPS=true
```

```sh
npm install
```

Set DESIGN_MODE to `replace`.

## Step 1 — Check Playwright

Skip this step if SOURCE is `freedesignmd` — freedesignmd files are markdown, no browser needed.

Tell the owner:
> "I need to check if a browser tool is available — it's how I read your Canva
> site's design."

```sh
npm ls playwright
```

If Playwright is not installed, tell the owner:

> "To read your Canva site's design, I need to install a browser tool called
> Playwright. It's about 150 MB. Want me to go ahead and install it?"

If they agree:

```sh
npm install playwright
npx playwright install chromium
```

If they decline, tell the owner:

> "No problem! We have two other options:
> 1. Export your Canva design as a PDF and I can extract the colors and fonts from that
> 2. We can build the design together from scratch — just say `/anglesite:design-interview`"

Stop and wait.

## Step 2 — Extract design

### freedesignmd path

If SOURCE is `freedesignmd`, delegate to the freedesignmd skill: read and
follow the `freedesignmd` skill. Pass the slug
extracted from SOURCE_URL (the segment after `/system/` or `/pattern/`).

That skill handles fetching the DESIGN.md, writing it to `src/design/DESIGN.md`,
translating tokens to CSS custom properties, updating `docs/brand.md`, and
verifying the build.

When it returns, present results to the owner:

> "I've imported the **\<system name\>** design system from freedesignmd:
>
> - **Tokens:** colors, typography, and spacing applied to `src/styles/global.css`
> - **DESIGN.md:** saved at `src/design/DESIGN.md` so I can keep new pages consistent
> - **No images or pages were imported** — freedesignmd is a design system catalog,
>   not a page builder. If you want pages too, run `/anglesite:design-import`
>   with a Canva URL, or build pages from scratch."

Skip to Step 8 (Commit). Steps 3–7 are Canva-specific.

### Canva path

Tell the owner:
> "I'm going to open your Canva site in a browser and extract the design —
> colors, fonts, images, and page layouts. This takes about a minute."

```sh
node references/scripts/design-import/canva-playwright.mjs --site "SOURCE_URL" > /tmp/canva-extraction.json
```

Read `/tmp/canva-extraction.json` as EXTRACTION_RESULT. It contains:
- `pages` — array of page objects, each with `url` and `sections` (text and image elements with bounds and font sizes)
- `tokens.colors` — mapped color roles (background, primary, accent, text)
- `tokens.fonts` — array of font names found in the design
- `images` — array of image URLs and alt text, deduplicated across pages
- `navigation` — navigation links (`label` + `path`) extracted from the site

If the extraction fails, tell the owner:

> "I wasn't able to read the Canva site automatically. This sometimes happens
> with certain Canva templates. We can build the design together instead —
> just say `/anglesite:design-interview`."

Stop and wait.

If extraction succeeds, present the inventory:

> "Here's what I found on your Canva site:
>
> **Pages:** N pages (list page names)
> **Colors:** N colors extracted (primary, accent, background, text)
> **Fonts:** font1, font2
> **Images:** N images to download
>
> I'll use these to build your website. Let me get started."

## Step 3 — Generate design system

Skip this step if DESIGN_MODE is `keep`.

### 3a — Map colors to CSS custom properties

Read `src/styles/global.css`. Map the extracted `tokens.colors` roles to CSS custom
properties:

| Extracted role | CSS custom property |
|---|---|
| background | `--color-bg` |
| primary | `--color-primary` |
| accent | `--color-accent` |
| text | `--color-text` |

Update the values in `global.css` using the Edit tool. If additional color roles
were extracted (muted, surface), map them to `--color-muted` and `--color-surface`.

Tell the owner:
> "I've applied your brand colors:
> - Primary: [hex] (used for headings and buttons)
> - Accent: [hex] (used for highlights and links)
> - Background: [hex]
> - Text: [hex]"

### 3b — Map fonts to system stacks

Map the extracted fonts to performant system font stacks per ADR-0005. Update
`global.css`:

- First font found → `--font-heading`
- Second font found (or same if only one) → `--font-body`

Common mappings:
- Serif fonts (Playfair Display, Merriweather, etc.) → `Georgia, 'Times New Roman', serif`
- Sans-serif fonts (Montserrat, Open Sans, etc.) → `system-ui, -apple-system, sans-serif`
- Monospace fonts → `'SF Mono', 'Fira Code', monospace`

Tell the owner:
> "Your Canva design uses [font1] for headings and [font2] for body text. I've
> mapped these to fast-loading system fonts that look similar — no extra
> downloads needed for your visitors."

### 3c — Infer design axes and write design.json

Run the design axis inference script:

```sh
node references/scripts/design-import/infer-axes.mjs /tmp/canva-extraction.json
```

This reads the extracted colors, fonts, and layout patterns to determine where
the design falls on axes like warm/cool, minimal/detailed, modern/traditional.

Write the result to `src/design/design.json`.

Generate `docs/design-rationale.md` explaining the design decisions:
- What was extracted from the Canva site
- How colors and fonts were mapped
- The inferred design axes and what they mean

Tell the owner:
> "I've saved your design system. It captures the look and feel of your Canva
> site so everything stays consistent as you add new pages."

## Step 4 — Generate pages

### 4a — Classify sections

For each page in EXTRACTION_RESULT, classify the sections using the layout
heuristics script:

```sh
node references/scripts/design-import/layout-heuristics.mjs /tmp/canva-extraction.json
```

This maps each extracted section to a semantic type: `hero`, `feature-grid`,
`testimonial`, `content`, `gallery`, `cta`, `footer`, or `generic`.

### 4b — Download and optimize images

Tell the owner:
> "I'm downloading images from your Canva site and optimizing them for fast
> loading."

```sh
mkdir -p public/images/design
```

For each image in EXTRACTION_RESULT:

```sh
curl -L -s -o "public/images/design/FILENAME" "IMAGE_URL"
```

Optimize with sharp-cli if over 500 KB:

```sh
npx sharp-cli -i "public/images/design/FILENAME" -o "public/images/design/FILENAME" --format webp --quality 80
```

### 4c — Assign text hierarchy

Run the text hierarchy script to determine heading levels and body text from
the extracted text elements:

```sh
node references/scripts/design-import/text-hierarchy.mjs /tmp/canva-extraction.json
```

This uses font size, weight, and position to assign `h1`, `h2`, `h3`, `p`, and
other semantic roles to text blocks.

### 4d — Assemble Astro pages

Create Astro pages from the classified sections. All pages use `BaseLayout`.

**Homepage** → `src/pages/index.astro`
**Other pages** → `src/pages/<slug>.astro` (slugified from the page name)

Map each classified section to semantic HTML:

| Section type | HTML output |
|---|---|
| `hero` | `<section class="hero">` with `<h1>`, tagline `<p>`, and CTA `<a>` button |
| `feature-grid` | `<section class="features">` with CSS Grid cards, each with heading and description |
| `testimonial` | `<blockquote>` with quote text and `<cite>` for attribution |
| `content` | Prose section with headings and paragraphs preserving hierarchy |
| `gallery` | CSS Grid of `<img>` elements with alt text |
| `cta` | `<section class="cta">` with heading and button link |
| `footer` | Fold content into BaseLayout footer (do not create a separate section) |
| `generic` | `<section>` preserving the original content order |

Use local image paths (`/images/design/filename.webp`) for all images. Do not
reference any Canva URLs in the output (ADR-0008, ADR-0011).

### 4e — Generate navigation

Build site navigation from the extracted `navigation` links in EXTRACTION_RESULT. For
each link:
- Map to the local page path (e.g., `/about`, `/services`)
- Drop any links to external Canva URLs

Update the navigation in `src/layouts/BaseLayout.astro` (or the equivalent
layout file) with the imported links.

If no navigation was extracted, build it from the list of generated pages.

## Step 5 — Build and verify

Tell the owner:
> "I'm building the site to make sure everything works correctly."

```sh
npm run build
```

If the build fails, fix the errors. Common issues:
- Missing imports in Astro files
- Invalid HTML in generated sections
- Image paths that don't match downloaded files

After a clean build, check for remaining Canva URLs in the output:

```sh
grep -rE "my\.canva\.site|canva\.com" dist/ --include="*.html"
```

If any Canva URLs remain in the built output, find the source files and replace
them with local paths. Rebuild until clean.

## Step 6 — Comparison screenshots

Tell the owner:
> "I'm taking screenshots of the new site so you can compare it with your
> Canva original."

Start the dev server:

```sh
npm run dev -- --port 4321 &
```

Wait a few seconds for it to start, then run the comparison script, passing the
page paths you imported (defaults to `/` if omitted):

```sh
node references/scripts/design-import/comparison.mjs "SOURCE_URL" "http://localhost:4321" / /services /about
```

Save screenshots to `docs/design-import/comparison/`. Stop the dev server.

If the comparison script is not available or fails, skip this step — it's
helpful but not blocking.

## Step 7 — Present results

Give the owner a plain-English summary:

> "Your Canva design has been imported! Here's what I built:
>
> **Design system:** Colors, fonts, and spacing extracted and applied
> **Pages:** N pages created (list them)
> **Images:** N images downloaded and optimized
> **Navigation:** Set up with links to all your pages
>
> **What's different from the Canva version:**
> - The layout uses clean, semantic HTML instead of Canva's absolute positioning.
>   It's responsive and works on all screen sizes.
> - Fonts are mapped to fast-loading system fonts that look similar to your
>   Canva fonts.
> - Any Canva-specific features (animations, embedded videos, forms) aren't
>   carried over — we can add alternatives that work better for a real website.
>
> **Comparison screenshots** are saved in `docs/design-import/comparison/` so
> you can see the original and new version side by side."

If any pages failed to import, list them:
> "I wasn't able to import [page names]. You can add these manually or I can
> help build them from scratch."

For any Canva-hosted features that couldn't be imported (forms, videos,
animations), suggest alternatives:
- Contact forms → `/anglesite:contact`
- Booking → `/anglesite:booking`
- Animations → the animate skill can add CSS animations
- Video → self-hosted video or a privacy-friendly embed

## Step 8 — Commit

Tell the owner:
> "I'm saving all the changes so nothing gets lost."

```sh
git add -A
```

```sh
git commit -m "Import design from Canva (N pages, design system)"
```

Replace N with the actual number of pages created.

Read `GITHUB_REPO` from `.site-config`. If set, push to GitHub:

```sh
git push origin draft
```

If the push fails, log the issue but don't block the import.

## Step 9 — Offer next steps

Tell the owner:

> "Your site is ready! Here's what you can do next:
>
> - **Publish it** — `/anglesite:deploy` to put it online
> - **Refine the design** — `/anglesite:design-interview` to adjust colors,
>   fonts, or layout
> - **Improve SEO** — `/anglesite:seo` to optimize for search engines
> - **Edit content** — open Keystatic to update text and images in a visual editor
>
> What would you like to do?"

Wait for the owner's response.
