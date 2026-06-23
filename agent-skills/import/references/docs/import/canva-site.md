# Canva Published Sites (*.my.canva.site)

Canva is a design-first platform where users build visuals rather than web pages. Published Canva sites are JavaScript SPAs with no semantic HTML, absolute positioning throughout, and no content API. Playwright is mandatory — curl and WebFetch return nothing useful. See [hosted-platforms.md](hosted-platforms.md) for standard HTML-to-Markdown conversion rules, image optimization pipeline, and missing field fallbacks. This doc covers only what's specific to Canva.

## How it detects this platform

Check the URL for `my.canva.site` or `canva.site`. Free-tier sites publish to `<name>.my.canva.site`. Pro users with custom domains may not have either string in the URL — in that case, look for Canva's root `<div id="root">` and hashed class names in the page source after a Playwright render.

## Site characteristics

- **JS SPA** — the initial HTML response is a shell with `<div id="root">`. All page content is hydrated by JavaScript. A `curl` or WebFetch request returns only the shell; there is no usable content.
- **Playwright mandatory** — there is no fallback extraction method for Canva. If Playwright is unavailable, inform the owner that the import cannot proceed without a browser.
- **Absolute positioning** — every element is placed with inline `style` containing `transform: translate(Xpx, Ypx)` and explicit `width` / `height`. This means there is no DOM reading order; spatial relationships are visual, not structural.
- **No semantic HTML** — the page tree is `<section>` elements containing deeply nested `<div>` elements. There are no `<h1>`–`<h6>`, `<p>`, `<article>`, or `<nav>` tags written by Canva.
- **Hashed class names** — class names like `onhyOQ` are build-time hashes. Never use them as selectors. They change on every Canva publish.
- **No bot detection** — published Canva sites do not use CAPTCHAs or bot-detection on the published domain.

## Design tokens

### Colors

Colors are applied entirely via inline `style` attributes using `rgb()` values. Canva does not write CSS custom properties or a stylesheet you can parse for brand colors.

To extract the color palette, use `getComputedStyle()` on visible text and background elements in Playwright. Classify colors by saturation:
- Saturation < 0.15 → gray (neutral/muted candidate)
- Saturation ≥ 0.15 → brand (primary/accent candidate)

Exclude pure black (`rgb(0,0,0)`), pure white (`rgb(255,255,255)`), and browser defaults.

### Fonts

Canva loads fonts via `@font-face` rules in external CSS files. Retrieve them by scanning `document.styleSheets` in Playwright for `@font-face` blocks containing `src: url(...)` with `.woff2` URLs.

Filter out Canva's system fonts — these are Canva UI fonts, not the owner's brand fonts:

| Font name to exclude |
| --- |
| Canva Sans |
| Canva Sans Text |
| Canva Sans Display |
| Noto Sans |
| Noto Serif |
| Noto Color Emoji |

Any remaining WOFF2 font families are the owner's chosen typefaces and should be mapped to `--font-heading` and `--font-body`.

## Image URLs

Canva serves images from the same subdomain as the site:

```
https://<name>.my.canva.site/media/<32-char-hex-hash>.<ext>
```

There is no separate CDN domain. The 32-character hex hash is the stable asset identifier. Download images with a `?w=1200` parameter for web-optimized sizes:

```
https://<name>.my.canva.site/media/a1b2c3d4e5f6...7890abcdef123456.jpg?w=1200
```

Rename downloaded images to `SLUG-hero.webp` (or `SLUG-body-N.webp`) per the standard naming convention — original filenames are not preserved.

## Multi-page structure

Canva supports up to 45 pages per site. Each page gets a path-based URL:

```
https://<name>.my.canva.site/            ← homepage
https://<name>.my.canva.site/about       ← inner page
https://<name>.my.canva.site/services    ← inner page
```

Canva can auto-generate a navigation menu. If the site has a nav, extract links from the rendered DOM via Playwright after hydration. If there is no nav, visit `/` and look for `<a>` elements pointing to same-domain paths to discover additional pages.

There is no sitemap. Page discovery is nav-link only.

## Metadata

Canva sites have minimal metadata. Expect:

| Tag | Present | Notes |
| --- | --- | --- |
| `<title>` | Yes | Usually the design name |
| `og:title` | Yes | Usually same as `<title>` |
| `viewport` | Yes | Standard responsive viewport |
| `favicon` | Yes | Canva-generated favicon |
| `og:description` | Rarely | Usually absent — fall back to first paragraph of extracted body text |
| `og:image` | Rarely | Usually absent — use first extracted image |
| JSON-LD | No | Canva does not generate structured data |

## Extraction script

Run the Canva Playwright extractor against each page URL:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/import/canva/canva-playwright.mjs "PAGE_URL"
```

Extract design tokens from the **homepage only** — they apply site-wide. Extract content from each page individually.

The script outputs JSON with both `tokens` and `content`:

```json
{
  "tokens": {
    "--color-bg": "#ffffff",
    "--color-text": "#1a1a1a",
    "--color-primary": "#e63946",
    "--color-accent": "#457b9d",
    "--color-muted": "#6b6b6b",
    "--font-heading": "\"Playfair Display\"",
    "--font-body": "\"Lato\""
  },
  "content": {
    "title": "Page Title",
    "body": "Markdown-formatted content...",
    "images": [{"src": "https://...", "alt": ""}],
    "navLinks": [{"text": "About", "href": "https://..."}]
  }
}
```

Use `--content-only` to skip style extraction, or `--styles-only` to skip content.

**Browser setup:** Playwright is a required dependency. After `npm install`, run `npx playwright install chromium` to download the browser binary (~150 MB, one-time). The import skill handles this automatically.

## Content conversion

Because Canva pages have no semantic HTML, infer structure from visual layout:

- **Headings** — detect by font-size (24px+) and font-weight (600+). Map the largest visible text to `##`, smaller prominent text to `###`.
- **Reading order** — sort text nodes by their `translate(Xpx, Ypx)` Y value to approximate top-to-bottom reading order. Left-to-right within the same Y band.
- **Body text** — smaller, lighter-weight text nodes that do not qualify as headings.
- **Alt text** — Canva images typically have empty or missing alt attributes. Set `imageAlt` to `""` and note it for the owner to fill in after import.

## Known limitations

- **Canva forms** — contact and signup forms on Canva sites are hosted and processed by Canva. They cannot be imported or replicated without a replacement form solution. Flag any form elements as "app-powered — needs replacement" in the import report.
- **Embedded Canva videos** — video embeds use the Canva video player. Strip them from extracted content and note in the import report: "Video present on original page — needs manual replacement."
- **Complex overlapping layers** — Canva designs often use overlapping decorative elements (shapes, images layered over text). The extractor captures text and images separately; the visual layering effect is lost. The resulting import will be clean but simpler than the original design.
- **No redirects needed** — Canva sites do not use paths that need preserving for SEO (they have no domain authority by default). Redirect mapping is not required unless the owner had a custom domain with significant traffic.
- **No blog or posts** — Canva is not a blogging platform. All content is modeled as pages, not posts.
