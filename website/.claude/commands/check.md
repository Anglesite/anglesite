Run a full health check on the site. Group results by severity.

## Build checks
- [ ] `npx astro check` passes (TypeScript)
- [ ] `npm run build` succeeds
- [ ] All pages have title, meta description, OG tags
- [ ] Images have alt text and are reasonably sized (<500KB)

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

## iCloud health
- [ ] `.nosync` symlinks intact for node_modules, dist, .astro, .wrangler
- [ ] No large binary files syncing unnecessarily

## Results

Report as:
- 🔴 **Critical** — blocks deployment, fix immediately
- 🟡 **Warning** — should fix soon
- 🟢 **Pass** — all good

If any critical issues found, explain what they are and how to fix them.
