/**
 * SEO audit orchestrator.
 *
 * Walks `dist/` and runs the audit functions exported from `seo.ts`:
 *
 * 1. `auditPage` per HTML file (title, description, canonical, OG, Twitter)
 * 2. `auditSite` across collected pages (duplicate titles/descriptions)
 * 3. Schema.org JSON-LD presence per page
 * 4. `validateSitemap` against `dist/sitemap-index.xml` or `dist/sitemap-0.xml`
 * 5. `auditRobotsTxt` against the `AGENTIC_CRAWLERS` policy
 * 6. `auditChunkability` per content-heavy HTML page
 *
 * Pages with `<meta name="robots" content="...noindex...">` are skipped — they
 * are intentionally excluded from search and don't need title/description tuning.
 *
 * Sitemap URLs are normalized before comparison so a built page like
 * `/blog/index.html` matches a sitemap entry of `/blog/`.
 *
 * Writes the formatted report to `reports/seo-report.md` (the `reports/`
 * directory is gitignored — regenerated on demand) and prints a one-line
 * summary to stderr. Exit codes are severity-aware so the script is usable
 * in CI:
 *
 *   0  — no critical issues (warnings or nice-to-have are OK, or `--warn-only`)
 *   1  — at least one critical issue
 *
 * Usage:
 *   tsx scripts/seo-audit.ts                       # write reports/seo-report.md, log summary
 *   tsx scripts/seo-audit.ts --json                # machine-readable report on stdout
 *   tsx scripts/seo-audit.ts --warn-only           # always exit 0 (non-blocking mode)
 *   tsx scripts/seo-audit.ts --report path.md      # write the report to a custom path
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { readConfig } from "./config.js";
import {
  auditChunkability,
  auditPage,
  auditRobotsTxt,
  auditSite,
  formatSeoReport,
  validateSitemap,
  type AgenticCrawlersPolicy,
  type PageSeoData,
  type SeoIssue,
} from "./seo.js";

// ---------------------------------------------------------------------------
// HTML walking
// ---------------------------------------------------------------------------

export function walkHtml(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkHtml(full));
    } else if (extname(entry.name) === ".html") {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Per-file extraction helpers
// ---------------------------------------------------------------------------

/**
 * Convert a built HTML path under `dist/` to a public URL path.
 *   dist/blog/index.html      -> /blog/
 *   dist/blog/post/index.html -> /blog/post/
 *   dist/about.html           -> /about
 *   dist/index.html           -> /
 */
export function htmlPathToUrlPath(file: string, distDir: string): string {
  const rel = relative(distDir, file).replace(/\\/g, "/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) {
    return "/" + rel.slice(0, -"index.html".length);
  }
  return "/" + rel.replace(/\.html$/, "");
}

export function isNoindex(html: string): boolean {
  const m = html.match(
    /<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*\/?>|<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']robots["'][^>]*\/?>/i,
  );
  const content = m ? (m[1] ?? m[2] ?? "") : "";
  return /\bnoindex\b/i.test(content);
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : "";
}

export function extractDescription(html: string): string {
  const m = html.match(
    /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*\/?>|<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*\/?>/i,
  );
  return m ? (m[1] ?? m[2] ?? "").trim() : "";
}

export function hasJsonLd(html: string): boolean {
  return /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/i.test(html);
}

// ---------------------------------------------------------------------------
// Sitemap discovery
// ---------------------------------------------------------------------------

export function findSitemapFile(distDir: string): string | null {
  const candidates = ["sitemap-index.xml", "sitemap-0.xml", "sitemap.xml"];
  for (const name of candidates) {
    const full = join(distDir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface SeoAuditReport {
  issues: SeoIssue[];
  totals: { critical: number; warning: number; niceToHave: number };
  pagesAudited: number;
  pagesSkipped: number;
}

export interface RunAuditOptions {
  distDir?: string;
  siteUrl?: string;
  agenticCrawlers?: AgenticCrawlersPolicy;
}

export function runAudit(opts: RunAuditOptions = {}): SeoAuditReport {
  const distDir = opts.distDir ?? "dist";
  const siteUrl = opts.siteUrl ?? "";
  const agenticCrawlers = opts.agenticCrawlers ?? "allow";

  const issues: SeoIssue[] = [];
  let pagesAudited = 0;
  let pagesSkipped = 0;

  if (!existsSync(distDir)) {
    return {
      issues,
      totals: { critical: 0, warning: 0, niceToHave: 0 },
      pagesAudited: 0,
      pagesSkipped: 0,
    };
  }

  const htmlFiles = walkHtml(distDir);
  const pageData: PageSeoData[] = [];
  const indexedPagePaths: string[] = [];

  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf-8");
    const urlPath = htmlPathToUrlPath(file, distDir);

    if (isNoindex(html)) {
      pagesSkipped += 1;
      continue;
    }

    pagesAudited += 1;
    indexedPagePaths.push(urlPath);

    // Per-page audit
    issues.push(...auditPage(html, urlPath));

    // Schema.org presence
    if (!hasJsonLd(html)) {
      issues.push({
        code: "missing-jsonld",
        severity: "warning",
        message: "Page is missing Schema.org JSON-LD structured data",
        page: urlPath,
      });
    }

    // Chunkability
    issues.push(...auditChunkability(html, urlPath));

    pageData.push({
      url: urlPath,
      title: extractTitle(html),
      description: extractDescription(html),
    });
  }

  // Cross-page audit
  issues.push(...auditSite(pageData));

  // Sitemap validation — only when we have a site URL to normalize against
  const sitemapPath = findSitemapFile(distDir);
  if (sitemapPath && siteUrl) {
    const xml = readFileSync(sitemapPath, "utf-8");
    issues.push(...validateSitemap(xml, indexedPagePaths, siteUrl));
  } else if (!sitemapPath) {
    issues.push({
      code: "missing-sitemap",
      severity: "warning",
      message: "No sitemap.xml / sitemap-index.xml found in dist/",
      page: "sitemap.xml",
    });
  }

  // robots.txt audit
  const robotsPath = join(distDir, "robots.txt");
  if (existsSync(robotsPath)) {
    const content = readFileSync(robotsPath, "utf-8");
    issues.push(...auditRobotsTxt(content, siteUrl, agenticCrawlers));
  } else {
    issues.push({
      code: "missing-robots",
      severity: "warning",
      message: "No robots.txt found in dist/",
      page: "robots.txt",
    });
  }

  const totals = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    niceToHave: issues.filter((i) => i.severity === "nice-to-have").length,
  };

  return { issues, totals, pagesAudited, pagesSkipped };
}

export function exitCodeFor(report: SeoAuditReport, warnOnly: boolean): number {
  if (warnOnly) return 0;
  return report.totals.critical > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Script entry — executed when run directly
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("seo-audit.ts")) {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");
  const reportIdx = args.indexOf("--report");
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : "reports/seo-report.md";
  const warnOnly = args.includes("--warn-only");

  if (!existsSync("dist")) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(warnOnly ? 0 : 1);
  }

  const siteDomain = readConfig("SITE_DOMAIN");
  const siteUrl = siteDomain ? `https://${siteDomain}` : "";
  const agenticCrawlers =
    (readConfig("AGENTIC_CRAWLERS") as AgenticCrawlersPolicy | undefined) ?? "allow";

  const report = runAudit({ distDir: "dist", siteUrl, agenticCrawlers });

  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, formatSeoReport(report.issues), "utf-8");
  }

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (reportPath) {
    console.log(`Wrote SEO report to ${reportPath}`);
  } else {
    console.log(formatSeoReport(report.issues));
  }

  console.error(
    `SEO audit: ${report.totals.critical} critical, ${report.totals.warning} warning, ${report.totals.niceToHave} nice-to-have across ${report.pagesAudited} page(s) (skipped ${report.pagesSkipped} noindex).`,
  );

  process.exit(exitCodeFor(report, warnOnly));
}
