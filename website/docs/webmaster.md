# Webmaster Best Practices

## Before every deploy

### Content & quality
1. All pages have `<title>` and `<meta name="description">`
2. All images have `alt` text
3. Images optimized (<500KB each, prefer .webp)
4. No broken links
5. TypeScript check passes (`npx astro check`)
6. Build succeeds (`npm run build`)

### Responsive & accessible
7. Pages work on phone, tablet, and desktop
8. Text is readable without zooming on mobile
9. Color contrast meets WCAG AA (4.5:1 for text)
10. Skip link works (first focusable element)
11. Heading hierarchy is logical (h1 → h2 → h3, no skips)

### SEO & social
12. OG tags on every page (title, description, image)
13. Blog posts have proper `h-entry` markup
14. Syndication links render as `u-syndication`

### Privacy & security
15. No customer PII in built site
16. No API tokens or secrets in source or built files
17. No third-party scripts except Cloudflare Web Analytics
18. No `/keystatic` routes in production build
19. Security headers intact in `public/_headers`
20. `.env` files gitignored and not tracked
21. Docs updated to reflect configuration changes

### iCloud
22. `.nosync` symlinks intact for heavy directories
23. No large unnecessary files syncing to iCloud
