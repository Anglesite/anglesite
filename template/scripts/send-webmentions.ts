/**
 * Build-time webmention sender.
 *
 * ADR-0020 composes a receiving @dwk/webmention endpoint into the site
 * Worker, but a site never sent webmentions for its own outbound links —
 * the one spot where the self-owned IndieWeb story fell back to "use a
 * third-party tool" (template/docs/indieweb.md). This script closes that
 * gap at deploy time: it scans built h-entry pages (blog posts, notes) for
 * external links in their e-content, discovers each target's webmention
 * endpoint, and sends one.
 *
 * Runs against `dist/` after `astro build`, not against source Markdoc —
 * `microformats-parser` (already a dependency once Webmention is enabled;
 * see worker/webmention-inbox.js) scopes extraction to the actual h-entry
 * content instead of nav/footer boilerplate that a raw regex would also
 * catch.
 *
 * A (source, target) pair is attempted at most once, ever — tracked in a
 * ledger file committed to the repo (same precedent as `.site-config`:
 * cross-deploy state lives in a project file, not a Cloudflare binding).
 * This bounds the number of outbound network calls per deploy and avoids
 * hammering targets that don't support webmentions.
 *
 * Usage: tsx scripts/send-webmentions.ts [--dist dist] [--ledger webmention-sent.json]
 *
 * @module
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import dns from "node:dns";
import { mf2 } from "microformats-parser";
import { extractLinks, isExternalLink } from "./link-check.js";
import { readConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Outbound link extraction
// ---------------------------------------------------------------------------

/**
 * Extracts external links from the `e-content` of the first `h-entry` in
 * `html`, resolved to absolute URLs and deduped. Returns `[]` if there's no
 * h-entry or e-content — links in the nav, footer, or other page chrome are
 * never included even though they're on the same page.
 */
export function extractOutboundLinksFromEntry(html: string, permalink: string): string[] {
  let items;
  try {
    ({ items } = mf2(html, { baseUrl: permalink }));
  } catch {
    return [];
  }

  const entry = items.find((item: { type?: string[] }) => item.type?.includes("h-entry"));
  const contentHtml: string | undefined =
    entry?.properties?.content?.[0]?.html ?? entry?.properties?.content?.[0]?.value;
  if (!contentHtml) return [];

  const siteOrigin = new URL(permalink).origin;
  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of extractLinks(contentHtml)) {
    let absolute: string;
    try {
      absolute = new URL(href, permalink).toString();
    } catch {
      continue;
    }
    if (!isExternalLink(absolute)) continue;
    if (new URL(absolute).origin === siteOrigin) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    links.push(absolute);
  }
  return links;
}

// ---------------------------------------------------------------------------
// Webmention endpoint discovery
// ---------------------------------------------------------------------------

const LINK_HEADER_WEBMENTION =
  /<([^>]+)>\s*;\s*rel\s*=\s*"?(?:[^"]*\s)?webmention(?:\s[^"]*)?"?/i;
const HTML_LINK_WEBMENTION =
  /<(?:link|a)\b[^>]*\brel\s*=\s*["'][^"']*\bwebmention\b[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i;
const HTML_LINK_WEBMENTION_ALT =
  /<(?:link|a)\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'][^"']*\bwebmention\b[^"']*["'][^>]*>/i;

/** Follows the webmention discovery algorithm: HTTP Link header, then HTML `<link>`/`<a rel=webmention>`. */
export async function discoverWebmentionEndpoint(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(targetUrl, {
      headers: { "User-Agent": "Anglesite-WebmentionSender/1.0" },
    } as RequestInit);
  } catch {
    return null;
  }

  const linkHeader = response.headers?.get?.("link");
  if (linkHeader) {
    const match = LINK_HEADER_WEBMENTION.exec(linkHeader);
    if (match) return new URL(match[1], targetUrl).toString();
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    return null;
  }

  const bodyMatch = HTML_LINK_WEBMENTION.exec(html) ?? HTML_LINK_WEBMENTION_ALT.exec(html);
  if (bodyMatch) return new URL(bodyMatch[1], targetUrl).toString();

  return null;
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

/** True if `ip` falls in a loopback, private, link-local, or unique-local range. */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe80:/i.test(lower)) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true; // unique-local fc00::/7
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true; // "this network"
  return false;
}

type LookupImpl = (hostname: string) => Promise<{ address: string; family: number }>;

/** Rejects non-http(s) URLs and URLs that resolve to a private/loopback address. Fails closed on lookup error. */
export async function isSafeUrl(
  url: string,
  lookupImpl: LookupImpl = (h) => dns.promises.lookup(h),
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  try {
    const { address } = await lookupImpl(parsed.hostname);
    return !isPrivateAddress(address);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export async function sendWebmention(
  endpoint: string,
  source: string,
  target: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number }> {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ source, target }).toString(),
    } as RequestInit);
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  status: "sent" | "no-endpoint" | "failed";
  at: string;
}
export type SentLedger = Record<string, LedgerEntry>;

export function loadLedger(path: string): SentLedger {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function saveLedger(path: string, ledger: SentLedger): void {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Site scan
// ---------------------------------------------------------------------------

const SCAN_DIRS = ["blog", "notes"];

/** Permalink pages under blog/ and notes/: `<dir>/<slug>/index.html`, excluding the collection index and archive. */
function findEntryPages(distDir: string): { file: string; permalink: string }[] {
  const pages: { file: string; permalink: string }[] = [];
  for (const collection of SCAN_DIRS) {
    const collDir = join(distDir, collection);
    if (!existsSync(collDir)) continue;
    for (const entry of readdirSync(collDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(collDir, entry.name, "index.html");
      if (!existsSync(file)) continue;
      pages.push({ file, permalink: `/${collection}/${entry.name}/` });
    }
  }
  return pages;
}

export interface SendSummary {
  sent: number;
  skipped: number;
  noEndpoint: number;
  failed: number;
  blocked: number;
}

export async function sendWebmentionsForSite(options: {
  distDir: string;
  siteUrl: string;
  ledgerPath: string;
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
}): Promise<SendSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl;
  const ledger = loadLedger(options.ledgerPath);
  const summary: SendSummary = { sent: 0, skipped: 0, noEndpoint: 0, failed: 0, blocked: 0 };

  const siteUrl = options.siteUrl.replace(/\/$/, "");
  for (const { file, permalink: relPermalink } of findEntryPages(options.distDir)) {
    const permalink = `${siteUrl}${relPermalink}`;
    const html = readFileSync(file, "utf-8");
    const targets = extractOutboundLinksFromEntry(html, permalink);

    for (const target of targets) {
      const key = `${permalink}|${target}`;
      if (ledger[key]) {
        summary.skipped++;
        continue;
      }

      const safe = await isSafeUrl(target, lookupImpl);
      if (!safe) {
        ledger[key] = { status: "failed", at: new Date().toISOString() };
        summary.blocked++;
        continue;
      }

      const endpoint = await discoverWebmentionEndpoint(target, fetchImpl);
      if (!endpoint) {
        ledger[key] = { status: "no-endpoint", at: new Date().toISOString() };
        summary.noEndpoint++;
        continue;
      }

      const result = await sendWebmention(endpoint, permalink, target, fetchImpl);
      ledger[key] = { status: result.ok ? "sent" : "failed", at: new Date().toISOString() };
      if (result.ok) summary.sent++;
      else summary.failed++;
    }
  }

  saveLedger(options.ledgerPath, ledger);
  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("send-webmentions.ts")) {
  const distArgIdx = process.argv.indexOf("--dist");
  const distDir = distArgIdx !== -1 ? process.argv[distArgIdx + 1] : "dist";
  const ledgerArgIdx = process.argv.indexOf("--ledger");
  const ledgerPath = ledgerArgIdx !== -1 ? process.argv[ledgerArgIdx + 1] : "webmention-sent.json";

  if (!existsSync(distDir)) {
    console.error(`${distDir} not found — run \`npm run build\` first.`);
    process.exit(1);
  }

  const siteDomain = readConfig("SITE_DOMAIN");
  if (!siteDomain) {
    console.error("SITE_DOMAIN not set in .site-config — cannot build permalinks.");
    process.exit(1);
  }

  sendWebmentionsForSite({
    distDir,
    siteUrl: `https://${siteDomain}`,
    ledgerPath,
  }).then((summary) => {
    console.log(
      `Webmentions: ${summary.sent} sent, ${summary.skipped} already sent, ` +
        `${summary.noEndpoint} no endpoint, ${summary.failed} failed, ${summary.blocked} blocked (unsafe target)`,
    );
  });
}
