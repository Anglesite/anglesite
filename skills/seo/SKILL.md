---
name: seo
description: "SEO audit, metadata editing, Schema.org, sitemap, and LLM/GEO optimization"
argument-hint: "[page /about | schema | sitemap | og-images]"
allowed-tools: Bash(npm run build), Bash(npx astro check), Bash(grep *), Bash(find dist/ *), Bash(git log *), Write, Read, Glob
disable-model-invocation: true
---

Audit and fix the site's SEO — page titles, meta descriptions, Open Graph tags, Schema.org structured data, sitemap, robots.txt, and AI search visibility. This is also called automatically as a non-blocking step before every deploy.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt.

## Architecture decisions

- [ADR-0001 Astro](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0001-astro-static-site-generator.md) — static pages, file-based routing
- [ADR-0007 Pre-deploy scans](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0007-mandatory-pre-deploy-scans.md) — mandatory pre-deploy checks
- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — no external scripts

## Reference

- [SEO & Discoverability guide](${CLAUDE_PLUGIN_ROOT}/docs/seo.md) — full SEO philosophy and checklists
- [SEO audit utilities](${CLAUDE_PLUGIN_ROOT}/template/scripts/seo.ts) — `auditPage`, `auditSite`, `validateSitemap`, `auditRobotsTxt`, `generateLlmsTxt`, `auditChunkability`, `formatSeoReport`, `inferPageSchemaType`, `generatePageJsonLd`, `detectFaqSections`

## Subcommands

Parse the argument to determine what the owner is asking for:

| Argument | Action |
|---|---|
| *(none)* | Full site audit (default) |
| `page /slug` | Audit + edit a specific page |
| `schema` | Audit and generate Schema.org markup site-wide |
| `sitemap` | Validate and configure sitemap |
| `og-images` | Audit og:image tags, offer Satori setup |

## Step 1 — Build

Build the site first. All audits run against the built output.

```sh
npm run build
```

If the build fails, fix it before proceeding.

## Step 2 — Full site audit

Crawl all HTML files in `dist/` and run the SEO audit functions from `scripts/seo.ts`:

1. **Per-page audit** — For each HTML file, call `auditPage(html, url)` to check:
   - Title present and 30–60 characters
   - Meta description present and 50–160 characters
   - Canonical URL present
   - Open Graph tags (og:title, og:description, og:image, og:url)
   - Twitter Card tags

2. **Cross-page audit** — Collect all page titles and descriptions, call `auditSite(pages)` to check:
   - Duplicate titles across pages
   - Duplicate descriptions across pages

3. **Schema.org audit** — For each page, check if `<script type="application/ld+json">` exists. Flag pages with no structured data.

4. **Sitemap validation** — Read `dist/sitemap-index.xml` (or `dist/sitemap-0.xml`), call `validateSitemap(xml, builtPages, siteUrl)` to check:
   - All built pages are listed
   - `<lastmod>` dates are present

5. **robots.txt audit** — Read `dist/robots.txt`, call `auditRobotsTxt(content, siteUrl)` to check:
   - Sitemap directive present
   - AI crawlers not blocked
   - Cloudflare default AI bot blocking warning

6. **LLM chunkability** — For content-heavy pages, call `auditChunkability(html, url)` to flag sections with >225 words of unbroken prose.

## Step 3 — Present results

Call `formatSeoReport(allIssues)` to generate the ranked report. Present it to the owner in plain English:

- **Critical issues** — "These need to be fixed before your site goes live." Offer one-shot fixes.
- **Warnings** — "These would improve how your site appears in search results." Explain each.
- **Nice-to-have** — "Bonus improvements for even better visibility." Brief mention.

Write the full report to `seo-report.md` in the project root.

## Step 4 — Fix issues (if owner approves)

For each Critical or Warning issue, offer to fix it:

### Missing or bad titles/descriptions

Read the page content and generate appropriate SEO fields based on the actual content. Write them to the page's frontmatter under a `seo:` block:

```yaml
seo:
  title: "Residential Plumbing Services in Springfield — Joe's Plumbing"
  description: "Licensed residential plumber serving Springfield, IL. Drain cleaning, water heater repair, and emergency plumbing. Call (555) 123-4567."
  ogImage: "/images/og/services.png"
```

For `.astro` pages without frontmatter, update the `title` and `description` props passed to `<BaseLayout>`.

### Missing Schema.org

Read `BUSINESS_TYPE` from `.site-config`. Use `inferPageSchemaType()` from `scripts/seo.ts` to determine the correct Schema type. Generate JSON-LD using `generatePageJsonLd()` and inject it via the `jsonLd` prop on `<BaseLayout>`.

For interactive experiment pages (canvas-based, WebGL, generative art), use `CreativeWork` or `VisualArtwork` Schema with `interactivityType: "active"`, `encodingFormat: "text/html"`, and `artMedium` matching the library used (e.g., "JavaScript", "WebGL", "p5.js"). For the lab/experiments index page, use `CollectionPage` with `hasPart` linking to individual experiments.

For pages with FAQ patterns (details/summary or dt/dd), call `detectFaqSections(html)` and generate `FAQPage` Schema.

For blog posts, generate `BlogPosting` with `datePublished`, `author`, and `image` from frontmatter.

### Missing sitemap entries

Verify `@astrojs/sitemap` is in `astro.config.ts` integrations. If pages are excluded, check for `noindex` in the page or explicit exclusion in the sitemap config.

### robots.txt issues

Update `public/robots.txt` to add the Sitemap directive with the correct domain. Do NOT add individual AI crawler rules — the Cloudflare dashboard controls bot access at the CDN level.

## Step 5 — LLM/GEO optimization

If the owner wants AI search visibility:

1. **Generate llms.txt** — Call `generateLlmsTxt()` with the site info and page list. Write to `public/llms.txt`.
2. **Explain Cloudflare bot settings** — Tell the owner: "Cloudflare blocks AI bots by default. To let AI search engines like ChatGPT and Perplexity cite your site, go to your Cloudflare dashboard → Security → Bot Management and allow the bots you want."
3. **FAQ generation** — For content-heavy pages, suggest adding FAQ sections. These pair with `FAQPage` Schema.org markup and are high-signal for AI search.

## Step 6 — Verify fixes

After any changes, rebuild and re-run the audit:

```sh
npm run build
```

Confirm all Critical issues are resolved. Present the updated report.

## Pre-deploy integration

When called from `/anglesite:deploy`, the SEO audit runs as a non-blocking step:

- **Critical issues** pause the deploy. Claude presents them with fix options.
- **Warnings and Nice-to-haves** are logged to `seo-report.md` but don't block.
- The owner can skip with `/anglesite:deploy --skip-seo`, which logs the skip with a timestamp.

## Keep docs in sync

After fixes, update:
- `docs/architecture.md` if Schema.org or structured data changed
- `.site-config` if any SEO-related config was added
