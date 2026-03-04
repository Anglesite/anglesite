---
name: new-page
description: "Create a new page with SEO and accessibility"
user-invokable: true
---

Create a new page on the site.

1. Ask what the page is for and what content it should have
2. Create the `.astro` file in `src/pages/`
3. Use `BaseLayout` with proper title, description, and OG tags
4. Follow the standards checklist:
   - Semantic HTML (headings, sections, nav)
   - Responsive (works on phone, tablet, desktop)
   - Accessible (alt text, skip links, color contrast)
   - Performance (optimized images, no unnecessary JS)
   - SEO (title, meta description, OG tags)
   - Matches the brand from `docs/brand.md` and follows `docs/design-system.md`
5. Add navigation link if appropriate
6. Preview on the dev server
7. Ask if they want to publish

## Important: Keep docs in sync

Update `docs/architecture.md` with the new page and its purpose.
