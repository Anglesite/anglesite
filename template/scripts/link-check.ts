/**
 * Link checker for built Anglesite sites.
 *
 * Scans dist/ for broken internal links, broken external links,
 * orphaned pages, and redirect chains.
 *
 * Usage: tsx scripts/link-check.ts [--external] [--json]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, dirname, posix } from "node:path";
import { readConfig } from "./config.js";
import { indiewebWorkerRoutes } from "./pre-deploy-check.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueSeverity = "warn" | "info";

export interface LinkIssue {
  type: "broken-internal" | "broken-external" | "orphaned-page" | "redirect-chain";
  severity: IssueSeverity;
  source: string;
  target: string;
  detail: string;
}

export interface LinkCheckResult {
  issues: LinkIssue[];
  stats: {
    pagesScanned: number;
    internalLinksChecked: number;
    externalLinksChecked: number;
    brokenInternal: number;
    brokenExternal: number;
    orphanedPages: number;
    redirectChains: number;
  };
}

export interface RedirectEntry {
  source: string;
  destination: string;
  status: number;
}

// ---------------------------------------------------------------------------
// HTML link extraction
// ---------------------------------------------------------------------------

const hrefPattern = /href\s*=\s*["']([^"']*?)["']/gi;

export function extractLinks(html: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  hrefPattern.lastIndex = 0;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[1].trim();
    if (href) links.push(href);
  }
  return links;
}

export function isInternalLink(href: string): boolean {
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) {
    return false;
  }
  if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
    return false;
  }
  if (href.startsWith("#") || href.startsWith("data:")) {
    return false;
  }
  return true;
}

export function isExternalLink(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function normalizeInternalHref(href: string, sourcePath: string, distDir: string): string {
  let clean = href.split("#")[0].split("?")[0];
  if (!clean) return "";

  if (clean.startsWith("/")) {
    return clean;
  }

  const sourceRelative = sourcePath.replace(distDir, "").replace(/\\/g, "/");
  const sourceDir = posix.dirname(sourceRelative);
  return posix.resolve(sourceDir, clean);
}

/**
 * Routes served by the site Worker rather than by files in dist/. Built from
 * `.site-config`: each enabled IndieWeb endpoint flag contributes its route(s)
 * (see `indiewebWorkerRoutes` in pre-deploy-check.ts). These are intentional
 * public endpoints — the internal-link check must not report them as broken.
 */
export function getWorkerRoutes(read: (key: string) => string | undefined): string[] {
  const routes: string[] = [];
  for (const [flag, flagRoutes] of Object.entries(indiewebWorkerRoutes)) {
    if (read(flag) === "true") routes.push(...flagRoutes);
  }
  return routes;
}

/** True when the href is a worker route or lives under one (e.g. /auth/token). */
export function isWorkerRoute(normalizedHref: string, workerRoutes: string[]): boolean {
  return workerRoutes.some(r => normalizedHref === r || normalizedHref.startsWith(r + "/"));
}

export function resolveInternalLink(normalizedHref: string, distDir: string): boolean {
  if (!normalizedHref) return true;

  const candidates = [
    join(distDir, normalizedHref),
    join(distDir, normalizedHref, "index.html"),
    join(distDir, normalizedHref + ".html"),
  ];

  if (normalizedHref.endsWith("/")) {
    candidates.push(join(distDir, normalizedHref, "index.html"));
  }

  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

// ---------------------------------------------------------------------------
// External link checking
// ---------------------------------------------------------------------------

export async function checkExternalLink(
  url: string,
  timeoutMs: number = 10_000,
  retries: number = 1,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  let normalizedUrl = url;
  if (normalizedUrl.startsWith("//")) {
    normalizedUrl = "https:" + normalizedUrl;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(normalizedUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Anglesite-LinkChecker/1.0" },
      });
      clearTimeout(timer);

      if (response.ok || response.status === 405) {
        if (response.status === 405) {
          const getController = new AbortController();
          const getTimer = setTimeout(() => getController.abort(), timeoutMs);
          const getResponse = await fetch(normalizedUrl, {
            method: "GET",
            signal: getController.signal,
            redirect: "follow",
            headers: { "User-Agent": "Anglesite-LinkChecker/1.0" },
          });
          clearTimeout(getTimer);
          return { ok: getResponse.ok, status: getResponse.status };
        }
        return { ok: true, status: response.status };
      }

      if (response.status >= 400 && attempt < retries) continue;
      return { ok: false, status: response.status };
    } catch (err: unknown) {
      if (attempt < retries) continue;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  return { ok: false, error: "exhausted retries" };
}

// ---------------------------------------------------------------------------
// Redirect chain detection
// ---------------------------------------------------------------------------

export function parseRedirects(content: string): RedirectEntry[] {
  const entries: RedirectEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const source = parts[0];
      const destination = parts[1];
      const status = parts[2] ? parseInt(parts[2], 10) : 301;
      if (source && destination) {
        entries.push({ source, destination, status });
      }
    }
  }
  return entries;
}

export function findRedirectChains(redirects: RedirectEntry[]): LinkIssue[] {
  const issues: LinkIssue[] = [];
  const redirectMap = new Map(redirects.map((r) => [r.source, r]));

  for (const redirect of redirects) {
    const chain: string[] = [redirect.source];
    let current = redirect.destination;
    let depth = 0;

    while (redirectMap.has(current) && depth < 10) {
      chain.push(current);
      current = redirectMap.get(current)!.destination;
      depth++;
    }

    if (chain.length > 2) {
      issues.push({
        type: "redirect-chain",
        severity: "info",
        source: redirect.source,
        target: current,
        detail: `${chain.length}-hop chain: ${chain.join(" → ")} → ${current}`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Orphaned page detection
// ---------------------------------------------------------------------------

export function findOrphanedPages(
  distDir: string,
  pageFiles: string[],
  inboundLinks: Map<string, Set<string>>,
  sitemapPaths: string[],
): LinkIssue[] {
  const issues: LinkIssue[] = [];

  for (const page of pageFiles) {
    const pagePath = page.replace(distDir, "").replace(/\\/g, "/");
    const normalizedPath = pagePath.replace(/\/index\.html$/, "/").replace(/\.html$/, "/");

    if (normalizedPath === "/" || normalizedPath === "/index.html") continue;
    if (normalizedPath.includes("/404")) continue;

    const hasInbound = inboundLinks.has(normalizedPath) && inboundLinks.get(normalizedPath)!.size > 0;
    const altPath = normalizedPath.endsWith("/")
      ? normalizedPath.slice(0, -1)
      : normalizedPath + "/";
    const hasInboundAlt = inboundLinks.has(altPath) && inboundLinks.get(altPath)!.size > 0;

    const inSitemap = sitemapPaths.some(
      (sp) => sp === normalizedPath || sp === altPath || sp === normalizedPath.replace(/\/$/, ""),
    );

    if (!hasInbound && !hasInboundAlt && !inSitemap) {
      issues.push({
        type: "orphaned-page",
        severity: "info",
        source: pagePath,
        target: "",
        detail: "No inbound link from any other page or sitemap",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Sitemap parsing
// ---------------------------------------------------------------------------

export function extractSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const locPattern = /<loc>([^<]+)<\/loc>/g;
  let match: RegExpExecArray | null;
  while ((match = locPattern.exec(xml)) !== null) {
    try {
      const url = new URL(match[1]);
      urls.push(url.pathname);
    } catch {
      urls.push(match[1]);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export function parseAllowlist(configValue: string | undefined): string[] {
  if (!configValue) return [];
  return configValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowlisted(href: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(href);
    }
    return href.includes(pattern);
  });
}

// ---------------------------------------------------------------------------
// File walking (reuse pattern from pre-deploy-check.ts)
// ---------------------------------------------------------------------------

function walkHtml(dir: string): string[] {
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
// Main check function
// ---------------------------------------------------------------------------

export async function checkLinks(
  distDir: string,
  options: {
    checkExternal?: boolean;
    allowlist?: string[];
    externalTimeout?: number;
    externalRetries?: number;
    /** Worker-served routes (from getWorkerRoutes) that resolve without a dist/ file. */
    workerRoutes?: string[];
  } = {},
): Promise<LinkCheckResult> {
  const issues: LinkIssue[] = [];
  const htmlFiles = walkHtml(distDir);
  const inboundLinks = new Map<string, Set<string>>();
  let internalLinksChecked = 0;
  let externalLinksChecked = 0;

  const externalUrls = new Map<string, string[]>();

  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf-8");
    const links = extractLinks(content);
    const sourcePath = file.replace(distDir, "").replace(/\\/g, "/");

    for (const href of links) {
      if (options.allowlist && isAllowlisted(href, options.allowlist)) continue;

      if (isInternalLink(href)) {
        internalLinksChecked++;
        const normalized = normalizeInternalHref(href, file, distDir);
        if (!normalized) continue;

        if (options.workerRoutes && isWorkerRoute(normalized, options.workerRoutes)) continue;

        const targetPath = normalized.endsWith("/") ? normalized : normalized + "/";
        const altPath = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
        for (const p of [targetPath, altPath, normalized]) {
          if (!inboundLinks.has(p)) inboundLinks.set(p, new Set());
          inboundLinks.get(p)!.add(sourcePath);
        }

        if (!resolveInternalLink(normalized, distDir)) {
          issues.push({
            type: "broken-internal",
            severity: "warn",
            source: sourcePath,
            target: href,
            detail: `Link to "${href}" does not resolve to a file in dist/`,
          });
        }
      } else if (isExternalLink(href) && options.checkExternal) {
        if (!externalUrls.has(href)) externalUrls.set(href, []);
        externalUrls.get(href)!.push(sourcePath);
      }
    }
  }

  if (options.checkExternal) {
    for (const [url, sources] of externalUrls) {
      if (options.allowlist && isAllowlisted(url, options.allowlist)) continue;
      externalLinksChecked++;
      const result = await checkExternalLink(
        url,
        options.externalTimeout ?? 10_000,
        options.externalRetries ?? 1,
      );
      if (!result.ok) {
        issues.push({
          type: "broken-external",
          severity: "warn",
          source: sources[0],
          target: url,
          detail: result.status
            ? `HTTP ${result.status}`
            : `Error: ${result.error}`,
        });
      }
    }
  }

  // Redirect chains
  const redirectsPath = join(distDir, "../public/_redirects");
  const distRedirectsPath = join(distDir, "_redirects");
  const redirectFile = existsSync(redirectsPath)
    ? redirectsPath
    : existsSync(distRedirectsPath)
      ? distRedirectsPath
      : null;

  if (redirectFile) {
    const redirectContent = readFileSync(redirectFile, "utf-8");
    const redirects = parseRedirects(redirectContent);
    issues.push(...findRedirectChains(redirects));
  }

  // Orphaned pages
  let sitemapPaths: string[] = [];
  const sitemapFile = join(distDir, "sitemap-index.xml");
  const sitemapSingle = join(distDir, "sitemap-0.xml");
  if (existsSync(sitemapSingle)) {
    sitemapPaths = extractSitemapUrls(readFileSync(sitemapSingle, "utf-8"));
  } else if (existsSync(sitemapFile)) {
    sitemapPaths = extractSitemapUrls(readFileSync(sitemapFile, "utf-8"));
  }

  issues.push(...findOrphanedPages(distDir, htmlFiles, inboundLinks, sitemapPaths));

  return {
    issues,
    stats: {
      pagesScanned: htmlFiles.length,
      internalLinksChecked,
      externalLinksChecked,
      brokenInternal: issues.filter((i) => i.type === "broken-internal").length,
      brokenExternal: issues.filter((i) => i.type === "broken-external").length,
      orphanedPages: issues.filter((i) => i.type === "orphaned-page").length,
      redirectChains: issues.filter((i) => i.type === "redirect-chain").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export function formatReport(result: LinkCheckResult): string {
  const lines: string[] = [];

  lines.push(`Link check: ${result.stats.pagesScanned} pages scanned`);
  lines.push(`  Internal links checked: ${result.stats.internalLinksChecked}`);
  if (result.stats.externalLinksChecked > 0) {
    lines.push(`  External links checked: ${result.stats.externalLinksChecked}`);
  }

  if (result.issues.length === 0) {
    lines.push("\nNo issues found.");
    return lines.join("\n");
  }

  const warnings = result.issues.filter((i) => i.severity === "warn");
  const infos = result.issues.filter((i) => i.severity === "info");

  if (warnings.length > 0) {
    lines.push(`\nWarnings (${warnings.length}):`);
    for (const issue of warnings) {
      lines.push(`  ${issue.source} → ${issue.target}: ${issue.detail}`);
    }
  }

  if (infos.length > 0) {
    lines.push(`\nInfo (${infos.length}):`);
    for (const issue of infos) {
      if (issue.type === "orphaned-page") {
        lines.push(`  ${issue.source}: ${issue.detail}`);
      } else {
        lines.push(`  ${issue.source} → ${issue.target}: ${issue.detail}`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("link-check.ts")) {
  const DIST = "dist";

  if (!existsSync(DIST)) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(1);
  }

  const checkExternal = process.argv.includes("--external");
  const jsonOutput = process.argv.includes("--json");

  const allowlist = parseAllowlist(readConfig("LINK_CHECK_ALLOW"));
  const workerRoutes = getWorkerRoutes(readConfig);

  checkLinks(DIST, { checkExternal, allowlist, workerRoutes }).then((result) => {
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatReport(result));
    }

    if (result.stats.brokenInternal > 0 || result.stats.brokenExternal > 0) {
      process.exit(1);
    }
  });
}
