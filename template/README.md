# Your Website

This site was built with [Astro](https://astro.build) and [Keystatic](https://keystatic.com), scaffolded by the [Anglesite](https://anglesite.dwk.io) plugin for Claude Code. It deploys to [Cloudflare Pages](https://pages.cloudflare.com).

You own everything — code, content, domain, hosting. If you ever want to move on from Anglesite, any [Astro-compatible agency](https://astro.build/agencies/) can pick up where it left off.

## Project structure

```text
├── src/
│   ├── pages/          Astro pages (.astro)
│   ├── layouts/        Page layouts
│   ├── components/     Reusable components
│   ├── content/        Blog posts and collections (.mdoc)
│   └── styles/         Global CSS (custom properties for theming)
├── public/             Static assets (images, fonts, _headers, robots.txt)
├── docs/               Reference documentation
├── scripts/            Setup and maintenance scripts
├── astro.config.ts     Astro configuration
├── keystatic.config.ts Content schema
└── package.json        Dependencies
```

## Development

```sh
npm run dev       # Start dev server at https://DEV_HOSTNAME (see .site-config)
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
```

Astro produces static HTML with zero client JavaScript by default. Pages in `src/pages/` map directly to URL routes.

## Content editing

Blog posts and other content live in `src/content/` as `.mdoc` files. You can edit them directly or use the Keystatic visual editor at `https://DEV_HOSTNAME/keystatic` while the dev server is running.

Content schemas are defined in `keystatic.config.ts`. Frontmatter fields (title, description, publishDate, etc.) are validated at build time.

## Styling

The site uses vanilla CSS with custom properties defined in `src/styles/global.css`. No CSS frameworks. Colors, fonts, and spacing are controlled through custom properties so the design can be updated in one place.

## Deployment

The site deploys to Cloudflare Pages via Git integration — push to `main` triggers a production deploy. DNS records are managed through the Cloudflare dashboard or `/anglesite:domain`.

## More information

For plugin documentation, skills reference, and support: [anglesite.dwk.io](https://anglesite.dwk.io)
