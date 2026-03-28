---
name: search
description: "Add on-site search so visitors can find content quickly"
allowed-tools: Bash(npm install *), Bash(npm run build), Bash(npx astro check), Write, Read, Glob
disable-model-invocation: true
---

Add on-site search powered by Pagefind. Builds a search index at build time from the site's static HTML output. Visitors search entirely client-side with no external API, no account, and no ongoing cost. The ~6 KB JavaScript loader only runs on the `/search` page.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — Pagefind JS is first-party (generated at build time, served from the same origin). Only loaded on the `/search` page, matching the Turnstile pattern on `/contact`.
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — No external search service. The index lives in the build output. Owner controls everything.
- [ADR-0015 Site search](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0015-site-search.md) — Research and rationale for choosing Pagefind over 10 alternatives.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Step 0 — Check prerequisites

Read `.site-config` for `SEARCH_ENABLED`. If it's already `true`, tell the owner: "Your site already has search set up. Would you like to reconfigure it, or is something not working?" Then troubleshoot as needed.

Verify the site builds cleanly: run `npm run build`. If the build fails, fix it before proceeding.

## Step 1 — Install Pagefind

Install the `astro-pagefind` package:

```
npm install astro-pagefind
```

This provides both the Astro integration (which runs Pagefind after each build) and the `<Search />` component for the search UI.

## Step 2 — Add the Pagefind integration

Read `astro.config.ts`. Add the Pagefind integration to the `integrations` array:

```typescript
import pagefind from "astro-pagefind";
```

Add `pagefind()` to the integrations list — place it after `sitemap()` since it runs post-build:

```typescript
integrations: [
  react(),
  markdoc(),
  ...(isDev ? [keystatic(), anglesiteToolbar()] : []),
  sitemap(),
  pagefind(),
],
```

## Step 3 — Mark content for indexing

Read `src/layouts/BaseLayout.astro`. Add `data-pagefind-body` to the `<main>` element so Pagefind only indexes page content (not navigation, header, or footer):

```html
<main id="main" data-pagefind-body>
```

Add `data-pagefind-ignore` to the `<header>` and `<footer>` elements as a safety net:

```html
<header class="h-card" data-pagefind-ignore>
```

```html
<footer data-pagefind-ignore>
```

## Step 4 — Create the search page

Create `src/pages/search.astro` with the following content:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), ".site-config");
const config = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
const siteName = config.match(/^SITE_NAME=(.+)$/m)?.[1]?.trim() ?? "this site";
---

<BaseLayout title="Search" description={`Search ${siteName} for pages, posts, and more.`}>
  <h1>Search</h1>
  <div id="search" data-pagefind-ignore></div>

  <noscript>
    <p>Search requires JavaScript. You can browse the site using the navigation above, or try searching on <a href={`https://www.google.com/search?q=site:${Astro.site?.hostname ?? ''}`}>Google</a>.</p>
  </noscript>

  <style>
    #search {
      margin-block: var(--space-lg);
    }

    /* Theme Pagefind's default UI to match site colors */
    :root {
      --pagefind-ui-scale: 1;
      --pagefind-ui-primary: var(--color-primary);
      --pagefind-ui-text: var(--color-text);
      --pagefind-ui-background: var(--color-bg);
      --pagefind-ui-border: var(--color-border);
      --pagefind-ui-tag: var(--color-surface);
      --pagefind-ui-border-width: 1px;
      --pagefind-ui-border-radius: var(--radius-md);
      --pagefind-ui-font: var(--font-body);
    }
  </style>

  <script>
    import { PagefindUI } from "astro-pagefind/components";
    // @ts-ignore — Pagefind UI mounts to the target element
    new PagefindUI({ element: "#search", showSubResults: true });
  </script>
</BaseLayout>
```

**Important:** Add `data-pagefind-ignore` to the search container so the search page itself is not indexed (avoids circular results).

## Step 5 — Add search link to navigation

Read `src/layouts/BaseLayout.astro`. Add a search link to the `<header>`:

```html
<header class="h-card" data-pagefind-ignore>
  <a href="/" class="p-name u-url">{siteName}</a>
  <nav>
    <a href="/search">Search</a>
  </nav>
</header>
```

If the site already has a `<nav>` in the header, add the search link to the existing nav. If there's no nav yet, create one.

Style the nav link to match existing navigation. Add minimal CSS if needed:

```css
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

header nav a {
  color: var(--color-primary);
  text-decoration: none;
}

header nav a:hover {
  text-decoration: underline;
}
```

## Step 6 — Save configuration

Append to `.site-config`:

```
SEARCH_ENABLED=true
```

## Step 7 — Build and verify

Run `npm run build` to generate the site and Pagefind index.

After a successful build, verify:
1. The `dist/_pagefind/` directory exists and contains index files
2. The search page is generated at `dist/search/index.html`

If the build fails, diagnose and fix before presenting to the owner.

Tell the owner: "Search is ready! Your site now has a `/search` page where visitors can find any content. The search index updates automatically every time you deploy. Want to preview it?"

## Re-running the command

If `/anglesite:search` is run again on a site that already has search:

1. Read `.site-config` for `SEARCH_ENABLED`
2. Ask what the owner wants to change (styling, placement, removal)
3. Update as needed and rebuild to verify

## Content-heavy sites

If the site has more than ~200 pages and the owner reports slow search or large page loads, consult [ADR-0015](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0015-site-search.md) for upgrade paths:

- **100-500 pages:** Consider Orama (self-hosted, ~45 KB, adds fuzzy/typo-tolerant search)
- **500+ pages:** Consider Typesense Cloud (~$7-40/month, fixed cost, no per-query charges)
- **Google Workspace users:** Google Programmable Search Engine (free with ads)

Present these as options only when Pagefind proves insufficient. For most small business sites (5-50 pages), Pagefind is the right choice.
