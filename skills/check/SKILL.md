---
name: Check
description: "Full health audit: build, privacy, security, accessibility"
user-invocable: true
---

Run a full health check on the site. The checklists below are for you (the agent) — **do not show raw checklist items, technical terms, or jargon to the owner.** Translate every finding into plain English. See the Results section at the bottom for how to present findings.

Before every tool call or command that will trigger a permission prompt, tell the owner what you're about to do and why in plain English. They should never see a permission dialog without context.

## Build checks
- [ ] `npx astro check` passes (TypeScript)
- [ ] `npm run build` succeeds
- [ ] All pages have title, meta description, OG tags
- [ ] Images have alt text and are reasonably sized (<500KB)

## Accessibility (WCAG AA)

These checks are not optional. Accessibility failures are as serious as security failures.

### Automated checks
Build the site first, then scan the output. Read `DEV_HOSTNAME` from `.site-config` for the URL (fall back to `localhost` if not set):
```sh
npx pa11y-ci --sitemap https://DEV_HOSTNAME/sitemap-index.xml
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

## IndieWeb (see `docs/indieweb.md`)
- [ ] `h-card` in site header with `p-name` and `u-url`
- [ ] `h-entry` on blog posts with `p-name`, `dt-published`, `e-content`
- [ ] Blog listing page wrapped in `h-feed`
- [ ] `rel="me"` links present for the owner's social profiles
- [ ] Syndication links render as `u-syndication` with `rel="syndication"`
- [ ] RSS feed at `/rss.xml` with `<link rel="alternate">` discovery in `<head>`
- [ ] Event pages use `h-event` markup if the business hosts events

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

## Results

**The owner is not technical.** Do not report raw checklist items. Translate every finding into one plain-English sentence that answers: what's wrong, why it matters, and what happens next. Group by severity using these everyday labels:

- **Must fix before publishing** — "Your site has a problem that needs to be fixed before it can go live."
- **Worth fixing soon** — "This won't break anything, but fixing it will make your site better."
- **All good** — "This part of your site is working well."

Examples of how to translate findings:

| Technical finding | What to tell the owner |
|---|---|
| Missing alt text on 3 images | "Three photos on your site don't have descriptions for people who use screen readers. I can add those for you." |
| Low color contrast on body text | "The text on some pages is hard to read against the background. I'll adjust the colors so it's easier on the eyes." |
| OG tags missing | "When you share your site link in a text or on social media, it won't show a nice preview card yet. I can fix that." |
| h-card missing | "Search engines and other sites can't find your business name and address in a standard format. I'll add that to the page." |
| npm audit found vulnerability | "One of the behind-the-scenes tools has a known security issue. I'll update it." |
| CSP header misconfigured | "Your site's security settings need a small adjustment. I'll take care of it." |
| EXIF GPS data in images | "Some of your photos have location information embedded in them. I'll strip that out so visitors can't see where the photos were taken." |

Never show the owner: CSS selectors, HTML tag names, HTTP headers, schema.org terms, WCAG levels, npm package names, or code snippets. If you need to explain *why* something matters, use an analogy or a concrete consequence ("visitors on phones will have to scroll sideways").

If any must-fix issues are found, explain and offer to fix them. If everything passes, keep it short: "Your site looks good — it builds correctly, works on phones, is secure, and is easy for search engines to find. No issues."

After the check, tell the owner: "This is the same kind of checkup a good web developer would do regularly. Your site should get one of these at least once a month — just type `/anglesite:check` anytime."
