Run a full health check on the site. Group results by severity.

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context.

## Build checks
- [ ] `npx astro check` passes (TypeScript)
- [ ] `npm run build` succeeds
- [ ] All pages have title, meta description, OG tags
- [ ] Images have alt text and are reasonably sized (<500KB)

## Accessibility (WCAG AA)

These checks are not optional. Accessibility failures are as serious as security failures.

### Automated checks
Build the site first, then scan the output:
```sh
npx pa11y-ci --sitemap http://localhost:4321/sitemap-index.xml
```
If `pa11y-ci` is not installed, run:
```sh
npx pa11y dist/index.html
```
Either tool checks for WCAG 2.1 AA violations: missing alt text, low contrast, missing form labels, broken ARIA, heading order, etc.

### Manual checks (inspect the built HTML)
- [ ] Every page has exactly one `<h1>`, and headings don't skip levels
- [ ] Color contrast meets 4.5:1 for body text and 3:1 for large text — verify the CSS custom properties in `src/styles/global.css`
- [ ] All interactive elements (links, buttons, form inputs) are keyboard-reachable
- [ ] No images of text (use real text instead)
- [ ] Skip-to-content link present in the layout
- [ ] Form inputs have associated `<label>` elements
- [ ] `lang` attribute set on `<html>` element

If any accessibility check fails, explain what the issue is, who it affects, and how to fix it.

## Mobile and responsive

Check that the site works on small screens. Start the dev server if not already running.

- [ ] Viewport meta tag present: `<meta name="viewport" content="width=device-width, initial-scale=1">`
- [ ] No horizontal scrolling at 320px width — check for fixed-width elements, overflow, or images without `max-width: 100%`
- [ ] Text is readable without zooming (minimum 16px body text)
- [ ] Touch targets are at least 44x44px (links, buttons)
- [ ] Navigation is usable on small screens (hamburger menu, collapsible nav, or simple enough to not need one)
- [ ] Images use responsive sizing (`max-width: 100%` or `srcset`)
- [ ] No content hidden on mobile that's visible on desktop (all information should be available)

## Privacy audit
- [ ] No customer PII in `dist/` (emails, phone numbers, names)
- [ ] No customer PII in git staging area
- [ ] `.env` files not tracked by git
- [ ] No API tokens or secrets in source or built files

## Security audit
- [ ] Security headers intact in `public/_headers` (CSP, X-Frame-Options, etc.)
- [ ] No third-party scripts except Cloudflare Web Analytics
- [ ] No `/keystatic` routes in production build
- [ ] `robots.txt` blocks `/keystatic/`
- [ ] No `.env` files in `dist/` or `public/`
- [ ] `npm audit` — check for known vulnerabilities
- [ ] Images in `public/images/` checked for EXIF GPS data (see `docs/security.md`)

## Content and SEO
- [ ] Every page has a unique `<title>` and `<meta name="description">`
- [ ] Open Graph tags present (`og:title`, `og:description`, `og:image`)
- [ ] Sitemap exists at `/sitemap-index.xml`
- [ ] `robots.txt` exists and includes sitemap URL
- [ ] No broken internal links — scan `dist/` for hrefs that don't resolve to a file
- [ ] Blog posts have valid frontmatter (title, description, publishDate)
- [ ] Business name, address, and contact info are easy to find (not buried)
- [ ] `h-card` microformat present in site header
- [ ] `h-entry` microformat present on blog posts

## Performance
- [ ] Images are in modern formats (.webp preferred) and optimized (<500KB)
- [ ] No render-blocking resources in `<head>` beyond essential CSS
- [ ] CSS is reasonably sized (check for unused rules)
- [ ] No large JavaScript bundles in `dist/_astro/` (Astro should produce near-zero client JS)

For a thorough performance audit, tell the owner: "Let's check how fast your site loads. I'll open Google's free speed test tool." Then open:

```sh
open https://pagespeed.web.dev/
```

Have the owner paste their site URL. Explain the scores: green (90+) is great, orange (50-89) needs work, red (<50) is urgent.

## Social preview
- [ ] OG image exists and is approximately 1200x630 pixels
- [ ] Test by pasting the site URL into a group chat or social media draft — the preview card should show the site title, description, and image
- [ ] Each page has its own `og:title` and `og:description` (not all the same)

## iCloud health
- [ ] `.nosync` symlinks intact for node_modules, dist, .astro, .wrangler
- [ ] No large binary files syncing unnecessarily

## Results

Report as:
- **Critical** — blocks deployment, fix immediately
- **Warning** — should fix soon
- **Pass** — all good

If any critical issues found, explain what they are and how to fix them. Offer to fix anything you can fix directly.

After the check, tell the owner: "This is the same kind of health check a good web developer would run regularly. Your site should get one of these at least once a month — just type `/check` anytime."
