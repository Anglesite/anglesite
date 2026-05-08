/**
 * Performance budget audit for built Anglesite sites.
 *
 * Walks dist/ and computes the JS + CSS weight referenced by each HTML page.
 * Compares against budgets defined in .site-config (with per-template
 * overrides). Optionally drives Lighthouse for LCP/CLS measurements.
 *
 * Defaults (ADR-0018):
 *   PERF_BUDGET_JS=51200    (50 KB total JS per page)
 *   PERF_BUDGET_CSS=51200   (50 KB total CSS per page)
 *   PERF_BUDGET_LCP_MS=2500 (LCP target, only checked if Lighthouse runs)
 *   PERF_BUDGET_CLS=0.1     (CLS target, only checked if Lighthouse runs)
 *
 * Per-template overrides match a path prefix:
 *   PERF_BUDGET_JS_LAB=512000   raises the JS budget for /lab/* pages
 *   PERF_BUDGET_CSS_BLOG=102400 raises the CSS budget for /blog/* pages
 *
 * Usage:
 *   tsx scripts/perf-budget.ts                    # static audit, text report
 *   tsx scripts/perf-budget.ts --json             # machine-readable
 *   tsx scripts/perf-budget.ts --report reports/perf-report.md
 *   tsx scripts/perf-budget.ts --lighthouse --url http://localhost:4321
 *   tsx scripts/perf-budget.ts --warn-only        # never exit non-zero
 *
 * Exit codes:
 *   0 — clean
 *   1 — page exceeds an applicable budget (only when not warn-only)
 *   2 — Lighthouse not installed but --lighthouse requested
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, resolve } from "node:path";
import { readConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerfBudget {
  jsBytes: number;
  cssBytes: number;
  lcpMs: number;
  clsScore: number;
}

export interface PageMetrics {
  path: string;
  jsBytes: number;
  cssBytes: number;
  jsAssets: string[];
  cssAssets: string[];
  lcpMs?: number;
  clsScore?: number;
}

export type BudgetStatus = "pass" | "warn" | "fail";

export interface BudgetFinding {
  path: string;
  metric: "js" | "css" | "lcp" | "cls";
  actual: number;
  budget: number;
  status: BudgetStatus;
}

export interface PerfReport {
  generatedAt: string;
  defaults: PerfBudget;
  pages: PageMetrics[];
  findings: BudgetFinding[];
  lighthouseRan: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGET: PerfBudget = {
  jsBytes: 50 * 1024,
  cssBytes: 50 * 1024,
  lcpMs: 2500,
  clsScore: 0.1,
};

// ---------------------------------------------------------------------------
// Budget resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a numeric budget key from .site-config, with the given default.
 * Treats blanks, NaN, and missing files as "unset".
 */
export function readBudget(key: string, fallback: number, configContent?: string): number {
  const raw =
    configContent !== undefined
      ? configContent.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim()
      : readConfig(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Pull the page-template suffix from a budget key like
 * `PERF_BUDGET_JS_LAB` → `LAB`.
 */
export function templateSuffix(key: string, metric: "JS" | "CSS" | "LCP_MS" | "CLS"): string | undefined {
  const prefix = `PERF_BUDGET_${metric}_`;
  if (!key.startsWith(prefix)) return undefined;
  const suffix = key.slice(prefix.length);
  return suffix.length > 0 ? suffix : undefined;
}

/**
 * Build the per-template override map from a .site-config string.
 * Returns a map keyed by lowercase template suffix.
 */
export function parseOverrides(
  configContent: string,
  metric: "JS" | "CSS" | "LCP_MS" | "CLS",
): Map<string, number> {
  const overrides = new Map<string, number>();
  const prefix = `PERF_BUDGET_${metric}_`;
  for (const line of configContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1).trim();
    const suffix = templateSuffix(key, metric);
    if (!suffix) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      overrides.set(suffix.toLowerCase(), parsed);
    }
  }
  return overrides;
}

/**
 * Match a page path (e.g., `/lab/colors/`) against an override suffix
 * (e.g., `lab`). Suffixes match the first non-empty path segment.
 */
export function matchOverride(pagePath: string, overrides: Map<string, number>): number | undefined {
  const segment = pagePath.replace(/^\/+/, "").split("/")[0]?.toLowerCase();
  if (!segment) return undefined;
  return overrides.get(segment);
}

export function budgetForPage(
  pagePath: string,
  metric: "js" | "css" | "lcp" | "cls",
  defaults: PerfBudget,
  overrides: Map<string, number>,
): number {
  const override = matchOverride(pagePath, overrides);
  if (override !== undefined) return override;
  switch (metric) {
    case "js":
      return defaults.jsBytes;
    case "css":
      return defaults.cssBytes;
    case "lcp":
      return defaults.lcpMs;
    case "cls":
      return defaults.clsScore;
  }
}

// ---------------------------------------------------------------------------
// Asset extraction
// ---------------------------------------------------------------------------

const scriptSrcPattern = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const stylesheetPattern = /<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
const stylesheetPatternRev = /<link[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi;

export function extractAssets(html: string): { scripts: string[]; styles: string[] } {
  const scripts: string[] = [];
  const styles: string[] = [];
  for (const match of html.matchAll(scriptSrcPattern)) scripts.push(match[1]);
  for (const match of html.matchAll(stylesheetPattern)) styles.push(match[1]);
  for (const match of html.matchAll(stylesheetPatternRev)) {
    if (!styles.includes(match[1])) styles.push(match[1]);
  }
  return { scripts, styles };
}

/**
 * Convert an `href`/`src` to a path inside `dist/`. Returns undefined for
 * absolute URLs and protocol-relative references — those don't count toward
 * the local budget.
 */
export function resolveAssetPath(href: string, htmlPath: string, distDir: string): string | undefined {
  if (!href) return undefined;
  if (/^[a-z]+:/i.test(href) || href.startsWith("//") || href.startsWith("data:")) {
    return undefined;
  }
  const stripped = href.split("#")[0].split("?")[0];
  if (!stripped) return undefined;
  if (stripped.startsWith("/")) {
    return join(distDir, stripped);
  }
  const relativeFromDist = htmlPath.slice(distDir.length).replace(/\\/g, "/");
  const dir = posix.dirname(relativeFromDist);
  const resolved = posix.resolve(dir, stripped);
  return join(distDir, resolved);
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function walkHtml(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkHtml(full));
    } else if (extname(entry.name) === ".html") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Convert a dist-relative HTML path to a public URL path.
 * `dist/index.html` → `/`, `dist/about/index.html` → `/about/`,
 * `dist/blog/post.html` → `/blog/post`.
 */
export function htmlToUrlPath(htmlPath: string, distDir: string): string {
  const rel = htmlPath.slice(distDir.length).replace(/\\/g, "/");
  if (rel.endsWith("/index.html")) {
    return rel.slice(0, -"index.html".length) || "/";
  }
  if (rel === "/index.html") return "/";
  return rel.replace(/\.html$/, "");
}

// ---------------------------------------------------------------------------
// Static audit
// ---------------------------------------------------------------------------

export function measurePage(htmlPath: string, distDir: string): PageMetrics {
  const html = readFileSync(htmlPath, "utf-8");
  const { scripts, styles } = extractAssets(html);
  let jsBytes = 0;
  let cssBytes = 0;
  const jsAssets: string[] = [];
  const cssAssets: string[] = [];

  for (const src of scripts) {
    const path = resolveAssetPath(src, htmlPath, distDir);
    if (!path) continue;
    const size = fileSize(path);
    jsBytes += size;
    jsAssets.push(src);
  }

  for (const href of styles) {
    const path = resolveAssetPath(href, htmlPath, distDir);
    if (!path) continue;
    const size = fileSize(path);
    cssBytes += size;
    cssAssets.push(href);
  }

  return {
    path: htmlToUrlPath(htmlPath, distDir),
    jsBytes,
    cssBytes,
    jsAssets,
    cssAssets,
  };
}

export function evaluatePage(
  metrics: PageMetrics,
  defaults: PerfBudget,
  overrides: { js: Map<string, number>; css: Map<string, number>; lcp: Map<string, number>; cls: Map<string, number> },
  warnOnly: boolean = false,
): BudgetFinding[] {
  const findings: BudgetFinding[] = [];
  const status: BudgetStatus = warnOnly ? "warn" : "fail";

  const jsBudget = budgetForPage(metrics.path, "js", defaults, overrides.js);
  if (metrics.jsBytes > jsBudget) {
    findings.push({ path: metrics.path, metric: "js", actual: metrics.jsBytes, budget: jsBudget, status });
  }

  const cssBudget = budgetForPage(metrics.path, "css", defaults, overrides.css);
  if (metrics.cssBytes > cssBudget) {
    findings.push({ path: metrics.path, metric: "css", actual: metrics.cssBytes, budget: cssBudget, status });
  }

  if (metrics.lcpMs !== undefined) {
    const lcpBudget = budgetForPage(metrics.path, "lcp", defaults, overrides.lcp);
    if (metrics.lcpMs > lcpBudget) {
      findings.push({ path: metrics.path, metric: "lcp", actual: metrics.lcpMs, budget: lcpBudget, status });
    }
  }

  if (metrics.clsScore !== undefined) {
    const clsBudget = budgetForPage(metrics.path, "cls", defaults, overrides.cls);
    if (metrics.clsScore > clsBudget) {
      findings.push({ path: metrics.path, metric: "cls", actual: metrics.clsScore, budget: clsBudget, status });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatReport(report: PerfReport): string {
  const lines: string[] = [];
  lines.push("# Performance Budget Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Budgets");
  lines.push("");
  lines.push(`- Total JS per page: ${formatBytes(report.defaults.jsBytes)}`);
  lines.push(`- Total CSS per page: ${formatBytes(report.defaults.cssBytes)}`);
  if (report.lighthouseRan) {
    lines.push(`- LCP: ${report.defaults.lcpMs} ms`);
    lines.push(`- CLS: ${report.defaults.clsScore}`);
  }
  lines.push("");
  lines.push(`Source: ${report.lighthouseRan ? "static asset audit + Lighthouse" : "static asset audit"}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("All pages within budget.");
    lines.push("");
  } else {
    lines.push("## Over budget");
    lines.push("");
    lines.push("| Page | Metric | Actual | Budget |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of report.findings) {
      const actual = f.metric === "js" || f.metric === "css" ? formatBytes(f.actual) : f.metric === "lcp" ? `${f.actual} ms` : f.actual.toFixed(3);
      const budget = f.metric === "js" || f.metric === "css" ? formatBytes(f.budget) : f.metric === "lcp" ? `${f.budget} ms` : f.budget.toFixed(3);
      lines.push(`| ${f.path} | ${f.metric.toUpperCase()} | ${actual} | ${budget} |`);
    }
    lines.push("");
  }

  lines.push("## All pages");
  lines.push("");
  lines.push("| Page | JS | CSS |" + (report.lighthouseRan ? " LCP | CLS |" : ""));
  lines.push("| --- | --- | --- |" + (report.lighthouseRan ? " --- | --- |" : ""));
  for (const page of report.pages) {
    const lcp = page.lcpMs !== undefined ? `${page.lcpMs} ms` : "—";
    const cls = page.clsScore !== undefined ? page.clsScore.toFixed(3) : "—";
    const tail = report.lighthouseRan ? ` ${lcp} | ${cls} |` : "";
    lines.push(`| ${page.path} | ${formatBytes(page.jsBytes)} | ${formatBytes(page.cssBytes)} |${tail}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Audit driver
// ---------------------------------------------------------------------------

export interface AuditOptions {
  distDir?: string;
  configContent?: string;
  lighthouse?: boolean;
  url?: string;
  warnOnly?: boolean;
}

export async function runAudit(options: AuditOptions = {}): Promise<PerfReport> {
  const distDir = options.distDir ?? "dist";
  const configPath = resolve(process.cwd(), ".site-config");
  const configContent = options.configContent ?? (existsSync(configPath) ? readFileSync(configPath, "utf-8") : "");

  const defaults: PerfBudget = {
    jsBytes: readBudget("PERF_BUDGET_JS", DEFAULT_BUDGET.jsBytes, configContent),
    cssBytes: readBudget("PERF_BUDGET_CSS", DEFAULT_BUDGET.cssBytes, configContent),
    lcpMs: readBudget("PERF_BUDGET_LCP_MS", DEFAULT_BUDGET.lcpMs, configContent),
    clsScore: readBudget("PERF_BUDGET_CLS", DEFAULT_BUDGET.clsScore, configContent),
  };

  const overrides = {
    js: parseOverrides(configContent, "JS"),
    css: parseOverrides(configContent, "CSS"),
    lcp: parseOverrides(configContent, "LCP_MS"),
    cls: parseOverrides(configContent, "CLS"),
  };

  const htmlFiles = walkHtml(distDir);
  const pages: PageMetrics[] = htmlFiles.map((f) => measurePage(f, distDir));

  let lighthouseRan = false;
  if (options.lighthouse && options.url) {
    lighthouseRan = await runLighthouse(pages, options.url);
  }

  const findings: BudgetFinding[] = [];
  for (const page of pages) {
    findings.push(...evaluatePage(page, defaults, overrides, options.warnOnly));
  }

  return {
    generatedAt: new Date().toISOString(),
    defaults,
    pages,
    findings,
    lighthouseRan,
  };
}

/**
 * Drive Lighthouse against a running preview server. The lighthouse package
 * is optional — if it's not installed, the function returns false and the
 * caller falls back to the static-only report.
 */
async function runLighthouse(pages: PageMetrics[], baseUrl: string): Promise<boolean> {
  let lighthouse: ((url: string, opts?: unknown, config?: unknown) => Promise<{ lhr: unknown }>) | undefined;
  try {
    const mod = await import("lighthouse" as string);
    lighthouse = (mod as { default?: typeof lighthouse }).default ?? (mod as typeof lighthouse);
  } catch {
    return false;
  }
  if (!lighthouse) return false;

  for (const page of pages) {
    const url = baseUrl.replace(/\/$/, "") + page.path;
    try {
      const result = (await lighthouse(url, { output: "json", logLevel: "error", onlyCategories: ["performance"] })) as {
        lhr: { audits: Record<string, { numericValue?: number }> };
      };
      const lcp = result?.lhr?.audits?.["largest-contentful-paint"]?.numericValue;
      const cls = result?.lhr?.audits?.["cumulative-layout-shift"]?.numericValue;
      if (typeof lcp === "number") page.lcpMs = Math.round(lcp);
      if (typeof cls === "number") page.clsScore = Number(cls.toFixed(3));
    } catch {
      // Skip pages Lighthouse fails to score; static metrics still recorded.
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Trend tracking
// ---------------------------------------------------------------------------

export interface TrendEntry {
  generatedAt: string;
  totalJs: number;
  totalCss: number;
  pageCount: number;
  findingCount: number;
  worstLcpMs?: number;
  worstCls?: number;
}

export function summarizeForTrend(report: PerfReport): TrendEntry {
  const totalJs = report.pages.reduce((sum, p) => sum + p.jsBytes, 0);
  const totalCss = report.pages.reduce((sum, p) => sum + p.cssBytes, 0);
  const lcpValues = report.pages.map((p) => p.lcpMs).filter((v): v is number => typeof v === "number");
  const clsValues = report.pages.map((p) => p.clsScore).filter((v): v is number => typeof v === "number");
  return {
    generatedAt: report.generatedAt,
    totalJs,
    totalCss,
    pageCount: report.pages.length,
    findingCount: report.findings.length,
    worstLcpMs: lcpValues.length ? Math.max(...lcpValues) : undefined,
    worstCls: clsValues.length ? Math.max(...clsValues) : undefined,
  };
}

export function appendTrend(trendPath: string, entry: TrendEntry, maxEntries = 30): TrendEntry[] {
  let history: TrendEntry[] = [];
  if (existsSync(trendPath)) {
    try {
      const parsed = JSON.parse(readFileSync(trendPath, "utf-8"));
      if (Array.isArray(parsed)) history = parsed as TrendEntry[];
    } catch {
      history = [];
    }
  }
  history.push(entry);
  if (history.length > maxEntries) {
    history = history.slice(history.length - maxEntries);
  }
  return history;
}

export function exitCodeFor(report: PerfReport, warnOnly: boolean): number {
  if (warnOnly) return 0;
  return report.findings.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("perf-budget.ts")) {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");
  const reportIdx = args.indexOf("--report");
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : "reports/perf-report.md";
  const trendIdx = args.indexOf("--trend");
  const trendPath = trendIdx >= 0 ? args[trendIdx + 1] : "reports/perf-trend.json";
  const lighthouse = args.includes("--lighthouse");
  const urlIdx = args.indexOf("--url");
  const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const cliWarnOnly = args.includes("--warn-only");
  const configWarnOnly = (readConfig("PERF_WARN_ONLY") ?? "").toLowerCase() === "true";
  const warnOnly = cliWarnOnly || configWarnOnly;

  if (!existsSync("dist")) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(1);
  }

  if (lighthouse && !url) {
    console.error("--lighthouse requires --url <preview-url>.");
    process.exit(1);
  }

  runAudit({ lighthouse, url, warnOnly })
    .then((report) => {
      if (reportPath) {
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, formatReport(report), "utf-8");
        console.log(`Wrote performance report to ${reportPath}`);
      }

      const history = appendTrend(trendPath, summarizeForTrend(report));
      mkdirSync(dirname(trendPath), { recursive: true });
      writeFileSync(trendPath, JSON.stringify(history, null, 2), "utf-8");

      if (wantJson) {
        console.log(JSON.stringify(report, null, 2));
      } else if (!reportPath) {
        console.log(formatReport(report));
      }

      if (lighthouse && !report.lighthouseRan) {
        console.warn("Hint: install lighthouse (`npm install -D lighthouse`) to record LCP and CLS.");
      }

      process.exit(exitCodeFor(report, warnOnly));
    })
    .catch((err) => {
      console.error("Performance audit failed:", err);
      process.exit(1);
    });
}
