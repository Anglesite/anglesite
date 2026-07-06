---
name: seo
description: "SEO audit, metadata editing, Schema.org, sitemap, and LLM/GEO optimization"
license: ISC
compatibility: "Designed for Claude Code / compatible agents operating inside an Anglesite project (Astro + Keystatic, Node >=22)."
allowed-tools: Bash(npm run build), Bash(npm run ai-seo*), Bash(npx astro check), Bash(grep *), Bash(find dist/ *), Bash(git log *), Write, Read, Glob
metadata:
  author: "David W. Keith"
  version: "1.3.0"
  source: "https://github.com/Anglesite/anglesite"
  invocation: "user-facing"
  argument-hint: "[page /about | schema | sitemap | og-images]"
---

Audit and fix the site's SEO — page titles, meta descriptions, Open Graph tags, Schema.org structured data, sitemap, robots.txt, and AI search visibility. This is also called automatically as a non-blocking step before every deploy.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt.

## Architecture decisions

- [ADR-0001 Astro](references/docs/decisions/0001-astro-static-site-generator.md) — static pages, file-based routing
- [ADR-0007 Pre-deploy scans](references/docs/decisions/0007-mandatory-pre-deploy-scans.md) — mandatory pre-deploy checks
- [ADR-0008 No third-party JS](references/docs/decisions/0008-no-third-party-javascript.md) — no external scripts

## Reference

- [SEO audit utilities](references/template/scripts/seo.ts) — `auditPage`, `auditSite`, `validateSitemap`, `auditRobotsTxt`, `generateRobotsTxt`, `generateLlmsTxt`, `auditChunkability`, `formatSeoReport`, `inferPageSchemaType`, `generatePageJsonLd`, `detectFaqSections`, the `AGENTIC_CRAWLER_BOTS` constant, and the `AgenticCrawlersPolicy` type

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

Run the audit script, which walks `dist/` and applies every audit function from `scripts/seo.ts`:

```sh
npm run ai-seo
```

The script writes the formatted report to `reports/seo-report.md` (the `reports/` directory is gitignored — regenerated on demand, never committed), prints a one-line summary to stderr, and exits 0 unless there are critical issues. Pages with `<meta name="robots" content="noindex">` are skipped. Pass `--warn-only` to always exit 0 (used during the predeploy non-blocking call) or `--json` to get the machine-readable form on stdout.

The audit covers:

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

5. **robots.txt audit** — Read `dist/robots.txt` and `AGENTIC_CRAWLERS` from `.site-config` (default `allow`), then call `auditRobotsTxt(content, siteUrl, agenticCrawlers)` to check:
   - Sitemap directive present
   - **Alignment with `AGENTIC_CRAWLERS`** — under `allow`, warn if any agentic crawler is blocked; under `block`, warn if any centralized agentic crawler is *not* disallowed (the policy and the file have drifted apart)
   - Cloudflare default AI bot blocking reminder (only under `allow`)
   - Whether `dist/llms.txt` exists when `AGENTIC_CRAWLERS=block` — if so, flag the inconsistency and offer to delete it (publishing an AI-readable index contradicts the owner's stance)

6. **LLM chunkability** — For content-heavy pages, call `auditChunkability(html, url)` to flag sections with >225 words of unbroken prose.

## Step 3 — Present results

Call `formatSeoReport(allIssues)` to generate the ranked report. Present it to the owner in plain English:

- **Critical issues** — "These need to be fixed before your site goes live." Offer one-shot fixes.
- **Warnings** — "These would improve how your site appears in search results." Explain each.
- **Nice-to-have** — "Bonus improvements for even better visibility." Brief mention.

Write the full report to `reports/seo-report.md` (the `reports/` directory is gitignored).

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

Read `AGENTIC_CRAWLERS` from `.site-config` (default `allow`) and call `generateRobotsTxt({ sitemapUrl, agenticCrawlers, disallowPaths: ["/keystatic/"] })` from `scripts/seo.ts` to render the file, then write the result to `public/robots.txt`. The function is the single source of truth:

- **`allow`** — emits the standard `User-agent: *` / `Allow: /` block plus the Sitemap directive. No individual AI crawler rules; Cloudflare's bot dashboard controls AI access at the CDN level.
- **`block`** — emits a `User-agent: <bot>` / `Disallow: /` block for every entry in `AGENTIC_CRAWLER_BOTS` *before* the catch-all, so `robots.txt` reflects the owner's stance even if Cloudflare's settings are bypassed.

To add a new agentic crawler, edit the `AGENTIC_CRAWLER_BOTS` array at the top of `template/scripts/seo.ts` — every surface (`generateRobotsTxt`, `auditRobotsTxt`, `/anglesite:check`) reads from that one list.

## Step 5 — LLM/GEO optimization

This step only runs when the owner allows agentic crawlers. Read `AGENTIC_CRAWLERS` from `.site-config` first:

- **`AGENTIC_CRAWLERS=block`** — skip this entire step. Don't generate `llms.txt`. If `public/llms.txt` already exists, delete it so it doesn't get republished, and confirm `robots.txt` blocks the centralized crawlers (regenerate with `generateRobotsTxt({ ..., agenticCrawlers: "block" })` if needed).
- **`AGENTIC_CRAWLERS=allow`** (default when unset) — proceed with the steps below.

When agentic crawlers are allowed:

1. **Generate llms.txt** — Call `generateLlmsTxt({ ..., agenticCrawlers: "allow" })` from `scripts/seo.ts` with the site info and page list. The function returns `null` when the policy is `block`; under `allow` it returns the markdown index. Write the result to `public/llms.txt`.
2. **Explain Cloudflare bot settings** — Tell the owner: "Cloudflare blocks AI bots by default. To let AI search engines like ChatGPT and Perplexity cite your site, go to your Cloudflare dashboard → Security → Bot Management and allow the bots you want."
3. **FAQ generation** — For content-heavy pages, suggest adding FAQ sections. These pair with `FAQPage` Schema.org markup and are high-signal for AI search.

`AGENTIC_CRAWLERS` is the single source of truth across three surfaces:

| Surface | `AGENTIC_CRAWLERS=allow` (default) | `AGENTIC_CRAWLERS=block` |
|---|---|---|
| Deploy gate (a14y) | runs as a deploy gate | skipped (informational only in `/anglesite:check`) |
| `llms.txt` | generated | not generated; existing file is removed |
| `robots.txt` | no `Disallow` for centralized agentic crawlers | each entry in `AGENTIC_CRAWLER_BOTS` gets its own `Disallow: /` |

When new agentic crawlers need to be tracked, add them to `AGENTIC_CRAWLER_BOTS` in `template/scripts/seo.ts` — every surface above reads from that array.

## Step 6 — Verify fixes

After any changes, rebuild and re-run the audit:

```sh
npm run build
```

Confirm all Critical issues are resolved. Present the updated report.

## Pre-deploy integration

`scripts/pre-deploy-check.ts` invokes `runAudit` from `scripts/seo-audit.ts` as a non-blocking step on every deploy. It writes `reports/seo-report.md` and surfaces a one-line summary in the predeploy warnings:

- **Critical issues** are surfaced as a `WARN:` line pointing at `reports/seo-report.md`. The deploy is not blocked — `/anglesite:deploy` reads the report and walks the owner through fixes.
- **Warnings and Nice-to-haves** are summarized in the same line.
- Pass `--skip-seo` to `npm run predeploy` (or `/anglesite:deploy --skip-seo`) to skip the audit entirely.

## Keep docs in sync

After fixes, update:
- `docs/architecture.md` if Schema.org or structured data changed
- `.site-config` if any SEO-related config was added
