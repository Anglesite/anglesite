---
name: new-page
description: "Create a new page with SEO and accessibility"
user-invokable: false
argument-hint: "[page name or purpose]"
allowed-tools: Write, Read, Glob
---

Create a new page on the site.

## Architecture decisions

- [ADR-0001 Astro](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro-static-site-generator.md) — pages are `.astro` files with zero client JS by default
- [ADR-0004 Vanilla CSS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0004-vanilla-css-custom-properties.md) — styling uses CSS custom properties from `global.css`
- [ADR-0005 System fonts](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0005-system-fonts.md) — no external font loading

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
