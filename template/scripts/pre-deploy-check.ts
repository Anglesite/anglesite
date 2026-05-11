/**
 * Pre-deploy security scans. Exit code 1 blocks deploy.
 *
 * Scans:
 * 1. PII (emails, phone numbers in dist/)
 * 2. API tokens in dist/, src/, public/
 * 3. Unauthorized third-party scripts
 * 4. Keystatic admin routes in production build
 * 5. OG image presence (warn only)
 * 6. Maintenance log freshness (warn only) — checks the monthly,
 *    quarterly, and annual stamps recorded by /anglesite:check and
 *    /anglesite:update. Never blocks deploy.
 *
 * Usage: tsx scripts/pre-deploy-check.ts
 * Also runs on Cloudflare's build system via the build command.
 */

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { readConfig } from "./config.js";
import { parseProviders, buildAllowedScripts } from "./csp.js";
import { runAudit as runSeoAudit } from "./seo-audit.js";
import { formatSeoReport, type AgenticCrawlersPolicy } from "./seo.js";

// ---------------------------------------------------------------------------
// Exported patterns and constants
// ---------------------------------------------------------------------------

export const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const emailExcludes = ["charset", "viewport", "@astro", "@import", "@keyframes", "@media", "@font-face", "@layer", "@property"];
export const phonePattern = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
/**
 * Airtable Personal Access Token: `pat` + 14 alphanumerics + `.` + 32+ alphanumerics.
 * The literal dot and second segment are mandatory in real PATs and eliminate
 * false positives against framework identifiers like `pathnameContainsDefaultLocale`.
 */
export const airtablePatPattern = /\bpat[A-Za-z0-9]{14}\.[A-Za-z0-9]{32,}\b/;

/** OpenAI secret key: `sk-` + 20+ alphanumerics. */
export const openaiKeyPattern = /\bsk-[A-Za-z0-9]{20,}\b/;

/** @deprecated Use airtablePatPattern or openaiKeyPattern. Kept for backwards-compatible imports. */
export const tokenPattern = new RegExp(`${airtablePatPattern.source}|${openaiKeyPattern.source}`);
export const scriptSrcPattern = /<script[^>]*src=/gi;

/**
 * Allowed third-party script domains for the pre-deploy scan.
 * Built dynamically from .site-config — only permits scripts for
 * providers the site actually uses.
 */
export function getAllowedScripts(configPath?: string): string[] {
  const configContent = (() => {
    const path = configPath ?? resolve(process.cwd(), ".site-config");
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8");
  })();
  return buildAllowedScripts(parseProviders(configContent));
}

/** @deprecated Use getAllowedScripts() for config-driven allowlist */
export const allowedScripts = ["cloudflareinsights", "_astro", "challenges.cloudflare.com", "cdn.polar.sh", "cdn.snipcart.com", "cdn.shopify.com", "sdks.shopifycdn.com"];

// ---------------------------------------------------------------------------
// Helpers
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

export function walkAll(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      results.push(...walkAll(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Scan functions
// ---------------------------------------------------------------------------

export function scanEmails(content: string, allowlist: string[]): string[] {
  emailPattern.lastIndex = 0;
  const matches = content.match(emailPattern) || [];
  return matches.filter(m => {
    // Skip CSS at-rules and meta tags
    if (emailExcludes.some(ex => m.includes(ex))) return false;
    // Skip emails in mailto: links (intentionally published)
    const idx = content.indexOf(m);
    if (idx >= 7 && content.slice(idx - 7, idx).includes("mailto:")) return false;
    // Skip emails on the allowlist
    if (allowlist.includes(m.toLowerCase())) return false;
    return true;
  });
}

export function scanPhones(content: string, allowlist: string[] = []): string[] {
  phonePattern.lastIndex = 0;
  const matches = content.match(phonePattern) || [];
  if (allowlist.length === 0) return matches;
  // Normalize to last 10 digits for comparison (strips country code)
  const norm = (s: string) => s.replace(/\D/g, "").slice(-10);
  const allowed = new Set(allowlist.map(norm));
  return matches.filter(m => !allowed.has(norm(m)));
}

export type TokenKind = "airtable-pat" | "openai-key";

export function scanTokens(content: string): TokenKind[] {
  const found: TokenKind[] = [];
  if (airtablePatPattern.test(content)) found.push("airtable-pat");
  if (openaiKeyPattern.test(content)) found.push("openai-key");
  return found;
}

const tokenLabels: Record<TokenKind, string> = {
  "airtable-pat": "Airtable Personal Access Token",
  "openai-key": "OpenAI secret key",
};

export function scanScripts(content: string, scriptAllowlist?: string[]): string[] {
  const allowed = scriptAllowlist ?? allowedScripts;
  scriptSrcPattern.lastIndex = 0;
  const results: string[] = [];
  const matches = content.match(scriptSrcPattern) || [];
  for (const match of matches) {
    const lineIdx = content.indexOf(match);
    const line = content.slice(lineIdx, content.indexOf(">", lineIdx) + 1);
    if (!allowed.some(a => line.includes(a))) {
      results.push(line);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Maintenance log
// ---------------------------------------------------------------------------

/**
 * Maintenance categories tracked in `.site-config`.
 * Each entry pairs the config key with a grace period in days — the scan
 * warns once the recorded date is older than that many days. Grace periods
 * include a small buffer over the nominal cadence so a one-week slip does
 * not nag the owner.
 */
export const maintenanceCategories: ReadonlyArray<{
  key: string;
  label: string;
  graceDays: number;
  command: string;
}> = [
  { key: "MAINTENANCE_MONTHLY_LAST",   label: "monthly health check",   graceDays: 35,  command: "/anglesite:check"  },
  { key: "MAINTENANCE_QUARTERLY_LAST", label: "quarterly update",       graceDays: 100, command: "/anglesite:update" },
  { key: "MAINTENANCE_ANNUAL_LAST",    label: "annual review",          graceDays: 380, command: "/anglesite:check"  },
];

/**
 * Compute days between two ISO calendar dates (YYYY-MM-DD).
 * Returns null if `iso` cannot be parsed. Uses UTC midnight to avoid
 * timezone drift turning "today" into a one-day stale warning.
 */
export function daysSince(iso: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const then = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(then)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - then) / 86_400_000);
}

export interface MaintenanceWarning {
  key: string;
  label: string;
  command: string;
  /** Days since the last recorded run, or null if no record exists. */
  age: number | null;
  graceDays: number;
}

/**
 * Inspect the maintenance log and return a warning for each category that
 * is overdue or has never been recorded. Pure function — pass the config
 * value lookup as `read` so callers can stub it in tests.
 */
export function scanMaintenance(
  read: (key: string) => string | undefined,
  now: Date = new Date(),
  categories: ReadonlyArray<{ key: string; label: string; graceDays: number; command: string }> = maintenanceCategories,
): MaintenanceWarning[] {
  const warnings: MaintenanceWarning[] = [];
  for (const cat of categories) {
    const value = read(cat.key);
    if (!value) {
      warnings.push({ key: cat.key, label: cat.label, command: cat.command, age: null, graceDays: cat.graceDays });
      continue;
    }
    const age = daysSince(value, now);
    if (age === null) {
      warnings.push({ key: cat.key, label: cat.label, command: cat.command, age: null, graceDays: cat.graceDays });
      continue;
    }
    if (age > cat.graceDays) {
      warnings.push({ key: cat.key, label: cat.label, command: cat.command, age, graceDays: cat.graceDays });
    }
  }
  return warnings;
}

/** Format a maintenance warning into a single-line, owner-facing message. */
export function formatMaintenanceWarning(w: MaintenanceWarning): string {
  if (w.age === null) {
    return `Maintenance: no record of a ${w.label}. Run \`${w.command}\` to log one.`;
  }
  return `Maintenance: ${w.label} last logged ${w.age} days ago (over the ${w.graceDays}-day window). Run \`${w.command}\`.`;
}

// ---------------------------------------------------------------------------
// Main script (only runs when executed directly)
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("pre-deploy-check.ts")) {
  const DIST = "dist";

  if (!existsSync(DIST)) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(1);
  }

  /**
   * Emails the site owner has explicitly approved for publication.
   * Set in .site-config as: PII_EMAIL_ALLOW=me@example.com,info@example.com
   */
  const emailAllowlist: string[] = (readConfig("PII_EMAIL_ALLOW") ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  /**
   * Phone numbers the site owner has explicitly approved for publication.
   * Set in .site-config as: PII_PHONE_ALLOW=1-800-662-4357,555-123-4567
   */
  const phoneAllowlist: string[] = (readConfig("PII_PHONE_ALLOW") ?? "")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);

  const failures: string[] = [];
  const warnings: string[] = [];

  const htmlFiles = walkHtml(DIST);

  // 1. PII scan — emails
  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf-8");
    const real = scanEmails(content, emailAllowlist);
    if (real.length > 0) {
      failures.push(`PII: possible email address in ${file}: ${real.join(", ")}`);
    }
  }

  // 1b. PII scan — phone numbers
  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf-8");
    const phones = scanPhones(content, phoneAllowlist);
    if (phones.length > 0) {
      failures.push(`PII: possible phone number in ${file}: ${phones.join(", ")}`);
    }
  }

  // 2. Token scan — API keys in dist/, src/, public/
  const scanDirs = [DIST, "src", "public"].filter(existsSync);

  for (const dir of scanDirs) {
    for (const file of walkAll(dir)) {
      try {
        const content = readFileSync(file, "utf-8");
        for (const kind of scanTokens(content)) {
          failures.push(`TOKEN: ${tokenLabels[kind]} found in ${file} — rotate this credential immediately`);
        }
      } catch {
        // Binary file, skip
      }
    }
  }

  // 3. Third-party scripts (allowlist driven by .site-config)
  const configAllowlist = getAllowedScripts();
  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf-8");
    const unauthorized = scanScripts(content, configAllowlist);
    for (const script of unauthorized) {
      failures.push(`SCRIPT: unauthorized third-party script in ${file}`);
    }
  }

  // 4. Keystatic admin routes
  const keystatic = walkAll(DIST).filter(f => f.includes("keystatic"));
  if (keystatic.length > 0) {
    failures.push(`KEYSTATIC: admin routes found in production build: ${keystatic.join(", ")}`);
  }

  // 5. OG image (warn only)
  const hasOgImage = htmlFiles.some(f => readFileSync(f, "utf-8").includes("og:image"));
  if (!hasOgImage) {
    warnings.push("No og:image meta tag found. Social shares won't show a preview image. Run `npm run ai-images` to generate one.");
  }

  // 6. Maintenance log (warn only)
  for (const w of scanMaintenance(readConfig)) {
    warnings.push(formatMaintenanceWarning(w));
  }

  // 7. SEO audit (warn only; critical issues surface as warnings here so they
  //    don't block deploy — the deploy skill walks the owner through fixes)
  const skipSeo = process.argv.includes("--skip-seo");
  if (!skipSeo) {
    try {
      const siteDomain = readConfig("SITE_DOMAIN");
      const siteUrl = siteDomain ? `https://${siteDomain}` : "";
      const agenticCrawlers =
        (readConfig("AGENTIC_CRAWLERS") as AgenticCrawlersPolicy | undefined) ?? "allow";
      const seoReport = runSeoAudit({ distDir: DIST, siteUrl, agenticCrawlers });
      const seoReportPath = "reports/seo-report.md";
      mkdirSync(dirname(seoReportPath), { recursive: true });
      writeFileSync(seoReportPath, formatSeoReport(seoReport.issues), "utf-8");
      if (seoReport.totals.critical > 0) {
        warnings.push(
          `SEO: ${seoReport.totals.critical} critical issue(s) — see ${seoReportPath}. Run \`/anglesite:seo\` to review.`,
        );
      } else if (seoReport.totals.warning > 0 || seoReport.totals.niceToHave > 0) {
        warnings.push(
          `SEO: ${seoReport.totals.warning} warning(s), ${seoReport.totals.niceToHave} nice-to-have — see ${seoReportPath}.`,
        );
      }
    } catch (err) {
      warnings.push(`SEO audit failed: ${(err as Error).message}`);
    }
  }

  // Report
  if (emailAllowlist.length > 0) {
    console.log(`PII email allowlist: ${emailAllowlist.join(", ")}`);
  }
  if (phoneAllowlist.length > 0) {
    console.log(`PII phone allowlist: ${phoneAllowlist.join(", ")}`);
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`WARN: ${w}`);
    }
  }

  if (failures.length > 0) {
    console.error("\nDeploy blocked — security scan failed:\n");
    for (const f of failures) {
      console.error(`  ${f}`);
    }
    console.error("\nFix these issues before deploying.");
    process.exit(1);
  }

  console.log("Pre-deploy security scan passed.");
}
