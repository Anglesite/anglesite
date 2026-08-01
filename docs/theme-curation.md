# Theme curation for the template chooser (#1179)

Criteria and approved shortlist for porting third-party Astro themes into the
template chassis as packs. Spec:
`docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md`.

## Criteria

1. **MIT license**, verifiable in the source repository.
2. **Adaptation feasibility** — semantic HTML skeleton; layout expressible in
   vanilla CSS on the chassis's 12-token system. The original's dependencies
   (Tailwind, React, …) do not come along; the design does.
3. **Category fit** — clearly Business, Personal, Blog, Portfolio, or
   Organization, and visually distinct from the 8 built-in palettes.
4. **No content-model conflict** with the chassis collections.

## Shortlist (pending owner sign-off)

| Category | Theme | Repo | License verified | Adaptation notes |
|---|---|---|---|---|
| Business | AstroWind | [github.com/arthelokyo/astrowind](https://github.com/arthelokyo/astrowind) (formerly `onwidget/astrowind`, transferred; most-starred Astro theme 2022–2025, 5.8k★) | MIT — [`LICENSE.md`](https://raw.githubusercontent.com/arthelokyo/astrowind/main/LICENSE.md) (verified by direct fetch, Copyright onWidget) | Marketing-site skeleton: hero, features, pricing, FAQ, stats, testimonial/brands widgets over `about`/`services`/`contact`/`pricing` pages, plain `<header>`/`<nav>` (`src/components/widgets/Header.astro`). Rebuild widget grid as vanilla-CSS section components; drop Tailwind utility classes and the widget-config JS layer, keep the section *order and hierarchy* as the personality. |
| Personal | Astro Cactus | [github.com/chrismwilliams/astro-theme-cactus](https://github.com/chrismwilliams/astro-theme-cactus) (1.7k★) | MIT — [`LICENSE`](https://raw.githubusercontent.com/chrismwilliams/astro-theme-cactus/main/LICENSE) (verified by direct fetch, Copyright Chris Williams) | Minimal single-column personal site: posts, notes, "now" page, social list, light/dark toggle; semantic `<header>`/`<nav>` in `src/components/layout/Header.astro`. Its `post`/`note` collections map onto the chassis's existing `blog`/`notes` collections — no schema needed. Rebuild the type-forward, generous-whitespace layout in vanilla CSS; theme toggle already fits the chassis's CSS-var pattern. |
| Blog | AstroPaper | [github.com/satnaing/astro-paper](https://github.com/satnaing/astro-paper) (4.9k★) | MIT — [`LICENSE`](https://raw.githubusercontent.com/satnaing/astro-paper/main/LICENSE) (verified by direct fetch, Copyright Sat Naing) | Accessible, SEO-first blog: post list with search/tags/pagination, minimal chrome, strong type scale. Maps directly onto the chassis `blog` collection. Rebuild the type-scale and list/detail layout in vanilla CSS; drop its Fuse.js client-search island (or reimplement without a framework) since search isn't part of the port contract. |
| Portfolio | Starfolio | [github.com/webrating/starfolio](https://github.com/webrating/starfolio) (43★, active) | MIT — [`LICENSE`](https://raw.githubusercontent.com/webrating/starfolio/master/LICENSE) (verified by direct fetch, Copyright Starfolio) | Single-page developer portfolio driven from one data file: bio, work history, project grid, skills, MDX blog. Semantic `<header>`/`<main>` in `src/layouts/Layout.astro`; nav is a React island (`NavbarIsland`) that renders a real `<nav>` — rebuild as static markup. Drop the shadcn/ui + Radix component layer and the decorative canvas background effect; keep the one-page bio→work→projects→blog structure as the layout skeleton. |
| Organization | Astroplate | [github.com/zeon-studio/astroplate](https://github.com/zeon-studio/astroplate) (1.2k★) | MIT — [`LICENSE`](https://raw.githubusercontent.com/zeon-studio/astroplate/main/LICENSE) (verified by direct fetch, Copyright Zeon Studio) | General-purpose marketing/content site (`about`, `contact`, blog with authors, CTA and testimonial partials, semantic `<header>`/`<nav>` in `src/layouts/partials/Header.astro`). No theme in the free catalog is nonprofit/association-specific with a verifiable MIT repo (see Rejected); Astroplate's about/testimonial/CTA/blog section set adapts cleanly to mission statement, member or donor quotes, "get involved" CTA, and news — reframe copy and section labels rather than restructure layout. Visually distinct from AstroWind's pick via a different section order and a testimonial-first rhythm instead of a pricing-first one. |

## Rejected candidates

| Theme | Reason |
|---|---|
| Astroship (`surjithctly/astroship`) | Wrong license — repo is GPL-3.0, not MIT (verified via GitHub API license metadata; GPL-3.0 is not redistributable the way the pack format requires). Seed list called this a business/startup candidate; AstroWind fills that slot instead. |
| Dante (`JustGoodUI/dante-astro-theme`) | Wrong license — GPL-3.0, not MIT (verified via GitHub API license metadata). Seed list called this a blog/personal candidate; AstroPaper and Astro Cactus fill those slots instead. |
| Astrofy (`manuelernestog/astrofy`) | Unmaintained — despite 1.4k★ and a genuinely distinctive sidebar-drawer CV/blog/store layout, last pushed 2024-07-04 (over two years stale as of this survey), still pinned to Astro v4, and 24 open issues with no recent activity. License is MIT (verified) and the design is portable, but Starfolio is a safer, actively-maintained pick for Portfolio. |
| Kindora Astro (Themefisher) | License unverifiable — astro.build's "Free" filter lists it, but Themefisher does not publish its source in a public GitHub repo (only a hosted demo/marketplace page); there is no LICENSE file to fetch and confirm MIT. Rejected on the criteria's "verifiable in the source repository" requirement, not a confirmed bad license. |
| Voluntia (`Astro-Phile/Voluntia`) | Unportable / content-model conflict — despite an MIT license, this is a full volunteer-management platform (separate `backend/`, `server/`, `client/`, `apps/` directories) rather than a static marketing site; it doesn't reduce to a layout/component/style pack over the chassis. |
| Astro Rocket (`hansmartensdev/Astro-Rocket`) | Category overlap / no organization-specific personality — a generic 44-component, 12-color-theme starter kit rather than a designed site with its own layout point of view. Astroplate's concrete about/testimonial/CTA section set gives clearer, more defensible adaptation notes for Organization. |
| AstroWind forks/clones (e.g. `wilfriedago/astrowind`, `K1zum1/AstroWind`, `leonnoel/astrowind`, 3–9★) | Category overlap — unmodified or trivial forks of the same theme already shortlisted (`arthelokyo/astrowind`); not independent candidates. |
| Church Starter (`MauCariApa-com/maucariapacom-church-starter`) | Unportable design — a single organization's live production site (hardcoded church-specific copy, imagery, and events data), not a generalized template; too narrow to serve as a reusable pack base. |
