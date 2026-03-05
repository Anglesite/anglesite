# Health Check Workflow

Run a full site audit — build, accessibility, security, SEO, IndieWeb, and performance. Fix issues as you find them.

## Quick check

```sh
npx astro check
npm run build
```

If either fails, fix it before checking other categories.

## Build

- `npx astro check` — TypeScript errors
- `npm run build` — full build succeeds
- All pages have title, meta description, OG tags
- Images have alt text and are under 500KB

## Accessibility (WCAG AA)

Run automated checks:

```sh
npx pa11y dist/index.html
```

Manual checks:
- Every page has exactly one `<h1>`, headings don't skip levels
- Color contrast: 4.5:1 for body text, 3:1 for large text
- All interactive elements keyboard-reachable
- No images of text
- Skip-to-content link present
- Form inputs have `<label>` elements
- `lang` attribute on `<html>`

## Mobile and responsive

- Viewport meta tag present
- No horizontal scrolling at 320px width
- Body text at least 16px
- Touch targets at least 44x44px
- Images use responsive sizing (`max-width: 100%` or `srcset`)

## Privacy

- No customer PII in `dist/` (emails, phone numbers, names)
- `.env` files not tracked by git
- No API tokens in source or built files

## Security

- Security headers in `public/_headers` (CSP, X-Frame-Options)
- No third-party scripts except Cloudflare Web Analytics
- No `/keystatic` routes in production build
- `robots.txt` blocks `/keystatic/`
- `npm audit` — check for known vulnerabilities
- Images in `public/images/` checked for EXIF GPS data

## Content and SEO

- Every page has unique `<title>` and `<meta name="description">`
- Open Graph tags present (`og:title`, `og:description`, `og:image`)
- Sitemap at `/sitemap-index.xml`
- `robots.txt` includes sitemap URL
- No broken internal links

## IndieWeb

See `docs/indieweb.md` for full guidance.

- `h-card` in site header with `p-name` and `u-url`
- `h-entry` on blog posts with `p-name`, `dt-published`, `e-content`
- `h-feed` on blog listing page
- `rel="me"` links for social profiles
- RSS feed at `/rss.xml` with `<link rel="alternate">` in `<head>`

## Social preview

- `og:title`, `og:description`, `og:image` on every page
- `twitter:card` meta tag present
- OG image exists and is approximately 1200x630
- `apple-touch-icon.png` exists in `public/` (180x180)
- `manifest.webmanifest` icon paths reference existing files

## Performance

- Images in modern formats (.webp preferred), under 500KB
- No render-blocking resources beyond essential CSS
- Near-zero client JavaScript (Astro default)

For a thorough performance audit: https://pagespeed.web.dev/

## Troubleshooting

### Prerequisites
```sh
npm run ai-check
```

### Common issues
- **Dev server port conflict**: `lsof -i :4321` or `lsof -i :443`
- **HTTPS certificate error**: `npm run ai-setup`
- **Hostname not resolving**: `dscacheutil -q host -a name HOSTNAME`
- **Node not in PATH**: `npm run ai-setup`

### Diagnose
1. Check logs: `~/.anglesite/logs/build.log`, `deploy.log`, `dev.log`
2. Run `npx astro check` and `npm run build` to reproduce
3. Fix, verify, ask if the owner wants to deploy
