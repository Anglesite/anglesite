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

Run the unified accessibility audit:

```sh
npm run ai-a11y -- --report a11y-report.md
```

`scripts/a11y-audit.ts` walks every HTML file in `dist/` and produces a per-page WCAG 2.1 AA report with suggested fixes. It runs three checkers and skips any that aren't installed:

- Heuristic checks (always on) — heading hierarchy, link text, alt text quality
- pa11y / pa11y-ci (`npm install -D pa11y` or `pa11y-ci`) — full WCAG 2.1 AA scan including contrast, ARIA, label association, and landmarks
- axe-core via Playwright (`npm install -D @axe-core/playwright playwright`) — modern rule engine with rich remediation context

Severity-aware exit codes for CI: `0` clean, `1` errors, `2` warnings only. Pass `--warn-only` (or set `A11Y_WARN_ONLY=true` in `.site-config`) to always exit `0`.

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

## Link health

Run the automated link checker after a successful build:

```sh
npm run ai-linkcheck
```

Reports broken internal links and orphaned pages. Add `--external` to also check external URLs (slower).

If a link is intentionally broken or excluded, add it to `.site-config`:

```text
LINK_CHECK_ALLOW=staging.example.com,internal.corp
```

## Content and SEO

- Every page has unique `<title>` and `<meta name="description">`
- Open Graph tags present (`og:title`, `og:description`, `og:image`)
- Sitemap at `/sitemap-index.xml`
- `robots.txt` includes sitemap URL

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

For a thorough performance audit: <https://pagespeed.web.dev/>

## Troubleshooting

### Prerequisites

```sh
npm run ai-check
```

### Common issues

- **Dev server port conflict**: `lsof -i :4321` (macOS/Linux) or `netstat -ano | findstr :4321` (Windows)
- **HTTPS certificate error**: `npm run ai-setup`
- **Hostname not resolving**: `dscacheutil -q host -a name HOSTNAME` (macOS), `getent hosts HOSTNAME` (Linux), `nslookup HOSTNAME` (Windows)
- **Node not in PATH**: `npm run ai-setup`

### Diagnose

1. Check logs: `~/.anglesite/logs/build.log`, `deploy.log`, `dev.log`
2. Run `npx astro check` and `npm run build` to reproduce
3. Fix, verify, ask if the owner wants to deploy
