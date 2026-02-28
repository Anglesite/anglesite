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
14. Blog listing wrapped in `h-feed`
15. Syndication links render as `u-syndication`
16. `rel="me"` links present for the owner's social profiles (see `docs/indieweb.md`)
17. Page titles include business type and location for key pages (see `docs/seo.md`)
18. Image alt text is descriptive (not filenames or keyword stuffing — see `docs/accessibility.md`)

### Privacy & security
15. No customer PII in built site
16. No API tokens or secrets in source or built files
17. No third-party scripts except Cloudflare Web Analytics
18. No `/keystatic` routes in production build
19. Security headers intact in `public/_headers`
20. `.env` files gitignored and not tracked
21. Docs updated to reflect configuration changes
22. Privacy policy, copyright notice, and accessibility statement present (see `docs/smb/legal-checklist.md`)
23. Contact form has honeypot field and submission handler (see `docs/security.md`)
24. Images stripped of EXIF metadata before publishing (see `docs/security.md`)

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
- Glance at Cloudflare Analytics — are visitors finding the site? (see `docs/measuring-success.md`)
- Check for new Google reviews and respond (see `docs/smb/reviews.md`)
- Verify business info is current on website and map listings (see `docs/smb/info-changes.md`)

**Quarterly**
- Run `/update` to get security patches and dependency updates
- Review blog posts — is the content still accurate and relevant?
- Quick competitor scan — any changes in the local landscape? (see `docs/smb/competitor-awareness.md`)
- Review analytics trends and check goals (see `docs/measuring-success.md`)

**Annually**
- Renew domain registration (Cloudflare sends email reminders)
- Verify iCloud+ subscription is active
- Consider refreshing the design if the brand has evolved
- Review all costs — any unused paid tools? (see `docs/cost-of-ownership.md`)
- Verify map listings are still claimed and accurate

## Local SEO

For businesses with a physical location:

### NAP consistency

Key details must be consistent everywhere (website, map listings, social media, directories):
- **N**ame — exact business name
- **A**ddress — exact street address
- **P**hone — primary phone number

Search engines cross-reference these to verify the business is legitimate. Inconsistencies (abbreviations, old phone numbers, wrong suite number) hurt rankings.

### Map listings

Customers find local businesses through maps. Each platform draws from different audiences — claim all three:

- **Google Business Profile** — business.google.com. Free. Powers Google Maps and "near me" searches. The most impactful listing for most businesses. Post updates, add photos, respond to reviews.
- **Apple Business Connect** — businessconnect.apple.com. Free. Powers Apple Maps results on iPhone, iPad, Mac, Siri, and CarPlay. iPhone users are roughly half the US market — if the business isn't on Apple Maps, it's invisible to those customers. Claim the listing and verify hours, photos, and categories.
- **OpenStreetMap** — openstreetmap.org. Community-maintained, open data. Powers many apps and services (DuckDuckGo, Bing Maps, many in-car systems, hiking/cycling apps). Anyone can add or edit a business. Search for the business — if it's missing or wrong, edit it. No account required for small edits; create a free account for ongoing updates.

Ask the owner: "Have you claimed your business on Google Maps, Apple Maps, and OpenStreetMap?" Most know about Google but haven't heard of Apple Business Connect.

### Structured data

The home page includes JSON-LD structured data (`LocalBusiness` or `Organization` schema) with the business name, address, phone, and hours. This helps search engines understand the business and display rich results.

Update the JSON-LD whenever the business info changes (new phone number, new hours, new address). Validate with:
- **Schema.org Validator** — validator.schema.org (vendor-neutral, checks schema.org compliance)
- **Google Rich Results Test** — search.google.com/test/rich-results (checks Google-specific rich result eligibility)
- **Bing Markup Validator** — bing.com/webmasters/markup-validator (checks Bing-specific rendering)
