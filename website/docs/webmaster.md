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

## What the owner can do without a developer

- **Write and edit blog posts** — Keystatic at `localhost:4321/keystatic` while the preview is running
- **Publish changes** — Type `/deploy`
- **Check site health** — Type `/check`
- **Fix problems** — Type `/fix` (diagnoses and repairs common issues)

Everything else (new pages, design changes, custom features) the webmaster handles through conversation.

## Accessibility is not optional

The site must be usable by people with disabilities. This is legally required in many jurisdictions (ADA in the US, EAA in the EU) and it's the right thing to do. The `/check` and `/deploy` commands enforce WCAG AA compliance. Never skip these checks.

## Maintenance schedule

**Monthly**
- Run `/check` to verify site health
- Glance at Cloudflare Analytics — are visitors finding the site?

**Quarterly**
- Run `/update` to get security patches and dependency updates
- Review blog posts — is the content still accurate and relevant?

**Annually**
- Renew domain registration (Cloudflare sends email reminders)
- Verify iCloud+ subscription is active
- Consider refreshing the design if the brand has evolved

## Local SEO

For businesses with a physical location:

### Google Business Profile
Suggest the owner claim or create their Google Business Profile at https://business.google.com. This is free and helps the business appear in Google Maps and local search results.

Key details to keep consistent everywhere (website, Google Business Profile, social media, directories):
- **N**ame — exact business name
- **A**ddress — exact street address
- **P**hone — primary phone number

This is called NAP consistency. Search engines use it to verify the business is legitimate.

### Structured data
The home page includes JSON-LD structured data (`LocalBusiness` or `Organization` schema) with the business name, address, phone, and hours. This helps search engines understand the business and display rich results.

Update the JSON-LD whenever the business info changes (new phone number, new hours, new address). Test with Google's Rich Results Test: https://search.google.com/test/rich-results
