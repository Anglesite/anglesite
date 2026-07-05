/**
 * Pre-deploy security scans. Exit code 1 blocks deploy.
 *
 * Scans:
 * 1. PII (emails, phone numbers in dist/)
 * 2. API tokens and committed secret bindings in dist/, src/, public/,
 *    worker/, and the wrangler configs
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
import { runAudit as runSeoAudit, resolveDistDir } from "./seo-audit.js";
import { formatSeoReport, type AgenticCrawlersPolicy } from "./seo.js";

// ---------------------------------------------------------------------------
// Exported patterns and constants
// ---------------------------------------------------------------------------

export const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const emailExcludes = ["charset", "viewport", "@astro", "@import", "@keyframes", "@media", "@font-face", "@layer", "@property"];

/**
 * RFC 2606 reserved second-level domains. Email addresses on these domains are
 * documentation placeholders by convention and never represent real PII.
 */
export const reservedExampleDomains = ["example.com", "example.net", "example.org"];

/**
 * RFC 2606 / RFC 6761 reserved top-level domains. Any address whose domain
 * ends in one of these is a placeholder.
 */
export const reservedExampleTlds = [".example", ".test", ".invalid", ".localhost"];

/**
 * True when an email address sits on a reserved documentation domain. Used by
 * the PII scan to ignore scaffold-shipped placeholders like `you@example.com`
 * without forcing owners to enumerate them in `PII_EMAIL_ALLOW`.
 */
export function isReservedExampleEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (reservedExampleDomains.includes(domain)) return true;
  return reservedExampleTlds.some(tld => domain.endsWith(tld));
}
/**
 * North-American phone numbers (3-3-4 with optional separators / parens).
 *
 * Boundary guards keep the unanchored 3-3-4 shape from matching digit runs
 * embedded in longer tokens — the false positives that were blocking real
 * deploys (issues #362, #365):
 *   - a Nature DOI in a citation URL (`…s41598-025-97652-6` → `598-025-9765`)
 *   - a Wayback Machine timestamp (`/web/20120120031959/` → `2012012003`)
 *   - a decimal geo-coordinate (`37.3268981241` → `3268981241`)
 *
 * Leading: reject when preceded by a digit or `/` (URL path / longer number),
 * or by a digit-then-dot (the fractional part of a decimal). A preceding `-`
 * is allowed so a country-code prefix (`1-800-662-4357`) is still detected.
 * Trailing: reject when followed by a digit or `/`, or by a dot-then-digit
 * (a decimal) — while still allowing a sentence-ending period after the number.
 */
export const phonePattern = /(?<![\d/])(?<!\d\.)\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d/])(?!\.\d)/g;
/**
 * Airtable Personal Access Token: `pat` + 14 alphanumerics + `.` + 32+ alphanumerics.
 * The literal dot and second segment are mandatory in real PATs and eliminate
 * false positives against framework identifiers like `pathnameContainsDefaultLocale`.
 */
export const airtablePatPattern = /\bpat[A-Za-z0-9]{14}\.[A-Za-z0-9]{32,}\b/;

/** OpenAI secret key: `sk-` + 20+ alphanumerics. */
export const openaiKeyPattern = /\bsk-[A-Za-z0-9]{20,}\b/;

/**
 * GitHub tokens: classic prefixes (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)
 * and fine-grained PATs (`github_pat_`). The Micropub→GitHub bridge set up by
 * /anglesite:indieweb uses a fine-grained PAT that must live in Cloudflare's
 * secret store (`wrangler secret put GITHUB_TOKEN`), never in source.
 */
export const githubTokenPattern = /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/;

/**
 * IndieWeb secret bindings committed as literals. `TOKEN_SIGNING_KEY` (the
 * IndieAuth access-token signing secret @dwk/indieauth and @dwk/micropub both
 * read) and `GITHUB_TOKEN` are wrangler / GitHub secrets — referencing the
 * *name* is fine (`env.GITHUB_TOKEN`, `${{ secrets.GITHUB_TOKEN }}`, `wrangler
 * secret put TOKEN_SIGNING_KEY`), but a credential-shaped literal assigned to
 * any of these names means the secret was committed. `INDIEAUTH_SIGNING_KEY`
 * stays in the list so sites scaffolded before the TOKEN_SIGNING_KEY rename are
 * still caught. The value class excludes `$`, `<`, and `.` so env
 * interpolations, doc placeholders, and property accesses never match.
 */
export const committedSecretPattern = /\b(?:TOKEN_SIGNING_KEY|INDIEAUTH_SIGNING_KEY|INDIEAUTH_SESSION_KEY|INDIEWEB_REG_TOKEN|GITHUB_TOKEN)["']?\s*[:=]\s*["']?[A-Za-z0-9+/_-]{16,}/;

/**
 * IndieWeb endpoints served by the site Worker (`worker/site-entry.js`), set
 * up by /anglesite:indieweb and keyed by their `.site-config` feature flag.
 * These are intentional public routes — route-shaped scans (the Keystatic
 * admin-route scan here, the internal-link check in link-check.ts) must never
 * flag them. They have no files in dist/: the Worker answers these paths
 * before falling through to static assets. `/auth` covers everything under it
 * (e.g. `/auth/token`).
 */
export const indiewebWorkerRoutes: Readonly<Record<string, readonly string[]>> = {
  INDIEWEB_INDIEAUTH: ["/auth", "/.well-known/oauth-authorization-server"],
  INDIEWEB_MICROPUB: ["/micropub", "/media"],
  INDIEWEB_WEBMENTION: ["/webmention"],
};

/** @deprecated Use airtablePatPattern or openaiKeyPattern. Kept for backwards-compatible imports. */
export const tokenPattern = new RegExp(`${airtablePatPattern.source}|${openaiKeyPattern.source}`);

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
    // Skip RFC 2606 / RFC 6761 reserved documentation domains
    if (isReservedExampleEmail(m)) return false;
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

export type TokenKind = "airtable-pat" | "openai-key" | "github-token" | "committed-secret-binding";

export function scanTokens(content: string): TokenKind[] {
  const found: TokenKind[] = [];
  if (airtablePatPattern.test(content)) found.push("airtable-pat");
  if (openaiKeyPattern.test(content)) found.push("openai-key");
  if (githubTokenPattern.test(content)) found.push("github-token");
  if (committedSecretPattern.test(content)) found.push("committed-secret-binding");
  return found;
}

const tokenLabels: Record<TokenKind, string> = {
  "airtable-pat": "Airtable Personal Access Token",
  "openai-key": "OpenAI secret key",
  "github-token": "GitHub token",
  "committed-secret-binding": "Committed secret binding (TOKEN_SIGNING_KEY / GITHUB_TOKEN)",
};

const tokenRemediations: Record<TokenKind, string> = {
  "airtable-pat": "Rotate this credential immediately and move it to a runtime environment variable.",
  "openai-key": "Rotate this credential immediately and move it to a runtime environment variable.",
  "github-token":
    "Rotate this token immediately, then store it with `npx wrangler secret put GITHUB_TOKEN` (and `gh secret set` for the Actions workflow).",
  "committed-secret-binding":
    "This is a secret binding — rotate the leaked value, then store it with `npx wrangler secret put <NAME>`. It must never appear in source or wrangler config.",
};

export function scanScripts(content: string, scriptAllowlist?: string[]): string[] {
  const allowed = scriptAllowlist ?? allowedScripts;
  const results: string[] = [];
  // Capture each <script …> tag along with its src value. Iterating with
  // exec (rather than indexOf on a prefix match) handles repeated and minified
  // one-line tags correctly.
  const re = /<script[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tag = m[0];
    const src = m[1] ?? "";
    // Only EXTERNAL scripts can be third-party. A "third-party script" gate
    // flags external origins only — scheme-qualified (https://) or
    // protocol-relative (//). Root-relative (/…), relative, and same-document
    // srcs are first-party by definition (issues #362, #365).
    if (!/^(?:https?:)?\/\//i.test(src)) continue;
    if (!allowed.some(a => tag.includes(a))) {
      results.push(tag);
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

// ---------------------------------------------------------------------------
// Structured scan report (used by Anglesite-app to render the blocked sheet)
// ---------------------------------------------------------------------------

/** A blocker — surfaces in the macOS app as a non-overridable sheet entry. */
export interface ScanFailure {
  category: "pii-email" | "pii-phone" | "exposed-token" | "third-party-script" | "keystatic-route";
  /** Repo-relative path of the file where the issue was found. */
  file?: string;
  /** Short, owner-facing description of what was found. */
  detail: string;
  /** Action the owner can take to clear the failure. */
  remediation: string;
}

/** A non-blocking notice. Surfaced in the sheet but does not gate deploy. */
export interface ScanWarning {
  category: "missing-og-image" | "maintenance-overdue" | "seo-critical" | "seo-warning";
  detail: string;
  remediation: string;
}

export interface ScanReport {
  /** `true` when no failures were found. `false` blocks the deploy. */
  ok: boolean;
  failures: ScanFailure[];
  warnings: ScanWarning[];
}

/**
 * Pure scan entry point — used by the macOS app's `PreDeployCheck` actor to get
 * a structured report it can render. Reads `dist/`, `src/`, `public/`, and
 * `.site-config` from `siteDir`; performs the same four mandatory blockers the
 * CLI runs (PII, tokens, third-party scripts, Keystatic routes) plus the
 * non-blocking warnings (missing OG image, overdue maintenance, SEO audit);
 * returns a `ScanReport` instead of printing.
 *
 * Read-only: unlike the CLI path it does not write a `reports/seo-report.md`
 * file. Throws on script error (missing `dist/`, unreadable files) — call sites
 * should catch and surface those distinctly from a clean scan failure.
 */
export function runScan(input: { siteDir: string }): ScanReport {
  const failures: ScanFailure[] = [];
  const warnings: ScanWarning[] = [];

  const baseDistDir = resolve(input.siteDir, "dist");
  if (!existsSync(baseDistDir)) {
    throw new Error(`dist/ not found at ${baseDistDir} — run \`npm run build\` first.`);
  }
  // The @astrojs/cloudflare adapter (Workers Static Assets) writes the client
  // build to dist/client/, not dist/ directly — scan the resolved directory
  // so PII/token/Keystatic checks see the real production output.
  const distDir = resolveDistDir(baseDistDir);

  const configPath = resolve(input.siteDir, ".site-config");
  const readSiteConfig = (key: string): string | undefined => {
    if (!existsSync(configPath)) return undefined;
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match?.[1];
  };

  const emailAllowlist = (readSiteConfig("PII_EMAIL_ALLOW") ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  const phoneAllowlist = (readSiteConfig("PII_PHONE_ALLOW") ?? "")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);

  const relativeToSite = (full: string): string => {
    const prefix = input.siteDir.endsWith("/") ? input.siteDir : input.siteDir + "/";
    return full.startsWith(prefix) ? full.slice(prefix.length) : full;
  };

  // 1. PII (emails, phones) in dist/ HTML
  const htmlFiles = walkHtml(distDir);
  const scriptAllowlist = getAllowedScripts(configPath);
  let hasOgImage = false;
  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf-8");
    if (content.includes("og:image")) hasOgImage = true;
    for (const email of scanEmails(content, emailAllowlist)) {
      failures.push({
        category: "pii-email",
        file: relativeToSite(file),
        detail: `Possible email address: ${email}`,
        remediation: `Wrap the address in a \`mailto:\` link if it should be published, or add it to PII_EMAIL_ALLOW in .site-config.`,
      });
    }
    for (const phone of scanPhones(content, phoneAllowlist)) {
      failures.push({
        category: "pii-phone",
        file: relativeToSite(file),
        detail: `Possible phone number: ${phone}`,
        remediation: `Remove the number from the source, or add it to PII_PHONE_ALLOW in .site-config if it is intentionally published.`,
      });
    }
    // 3. Third-party scripts (allowlist from .site-config providers)
    for (const scriptTag of scanScripts(content, scriptAllowlist)) {
      failures.push({
        category: "third-party-script",
        file: relativeToSite(file),
        detail: `Unauthorized third-party script: ${scriptTag}`,
        remediation: `Remove the script or add the provider to .site-config (ECOMMERCE_PROVIDER, BOOKING_PROVIDER, TURNSTILE_SITE_KEY, etc.) so its CDN is allowlisted.`,
      });
    }
  }

  // 2. Exposed tokens in dist/, src/, public/, worker/, and the wrangler
  //    configs. worker/ and the configs are where the IndieWeb secret
  //    bindings (TOKEN_SIGNING_KEY, GITHUB_TOKEN) would land if someone
  //    committed them instead of using `wrangler secret put`.
  const tokenScanFiles = [
    distDir,
    resolve(input.siteDir, "src"),
    resolve(input.siteDir, "public"),
    resolve(input.siteDir, "worker"),
  ].flatMap(dir => walkAll(dir));
  for (const name of ["wrangler.jsonc", "wrangler.toml"]) {
    const full = resolve(input.siteDir, name);
    if (existsSync(full)) tokenScanFiles.push(full);
  }
  for (const file of tokenScanFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue; // binary file
    }
    for (const kind of scanTokens(content)) {
      failures.push({
        category: "exposed-token",
        file: relativeToSite(file),
        detail: `${tokenLabels[kind]} pattern detected`,
        remediation: tokenRemediations[kind],
      });
    }
  }

  // 4. Keystatic admin routes leaking into dist/. The IndieWeb endpoints
  //    (/auth, /micropub, /media, /webmention — see indiewebWorkerRoutes) are
  //    Worker-served, intentionally public, and never appear in dist/; do not
  //    extend this scan to flag them.
  for (const file of walkAll(distDir).filter(f => f.includes("keystatic"))) {
    failures.push({
      category: "keystatic-route",
      file: relativeToSite(file),
      detail: `Keystatic admin route in production build: ${relativeToSite(file)}`,
      remediation: `Set \`output: 'static'\` for Keystatic routes or exclude them from the production build.`,
    });
  }

  // ---- Warnings (non-blocking; surfaced by the app's health badge) ----

  // 5. OG image presence (warn only)
  if (htmlFiles.length > 0 && !hasOgImage) {
    warnings.push({
      category: "missing-og-image",
      detail: `No og:image meta tag found — social shares won't show a preview image.`,
      remediation: `Run \`npm run ai-images\` to generate one.`,
    });
  }

  // 6. Maintenance log freshness (warn only)
  for (const w of scanMaintenance(readSiteConfig)) {
    warnings.push({
      category: "maintenance-overdue",
      detail:
        w.age === null
          ? `No record of a ${w.label}.`
          : `${w.label} last logged ${w.age} days ago (over the ${w.graceDays}-day window).`,
      remediation: `Run \`${w.command}\`.`,
    });
  }

  // 7. SEO audit (warn only). Best-effort in scan mode — a failed audit must
  //    never break the structured report, so errors are swallowed.
  try {
    const siteDomain = readSiteConfig("SITE_DOMAIN");
    const siteUrl = siteDomain ? `https://${siteDomain}` : "";
    const agenticCrawlers =
      (readSiteConfig("AGENTIC_CRAWLERS") as AgenticCrawlersPolicy | undefined) ?? "allow";
    const seoReport = runSeoAudit({ distDir, siteUrl, agenticCrawlers });
    if (seoReport.totals.critical > 0) {
      warnings.push({
        category: "seo-critical",
        detail: `${seoReport.totals.critical} critical SEO issue(s).`,
        remediation: `Run \`/anglesite:seo\` to review.`,
      });
    } else if (seoReport.totals.warning > 0 || seoReport.totals.niceToHave > 0) {
      warnings.push({
        category: "seo-warning",
        detail: `${seoReport.totals.warning} SEO warning(s), ${seoReport.totals.niceToHave} nice-to-have.`,
        remediation: `Run \`/anglesite:seo\` to review.`,
      });
    }
  } catch {
    // SEO audit is best-effort here; never gate the report on it.
  }

  return { ok: failures.length === 0, failures, warnings };
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
  // --json: structured output for the Anglesite-app's PreDeployCheck. Runs the
  // four mandatory blockers (PII, tokens, third-party scripts, Keystatic) and
  // emits a single ScanReport JSON document on stdout. Exit 0 = ok, 1 = blocked
  // or script error (script-error JSON has ok=false with a synthetic failure;
  // missing dist/ throws inside runScan and surfaces on stderr).
  if (process.argv.includes("--json")) {
    try {
      const report = runScan({ siteDir: process.cwd() });
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      process.exit(report.ok ? 0 : 1);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  const BASE_DIST = "dist";

  if (!existsSync(BASE_DIST)) {
    console.error("dist/ not found — run `npm run build` first.");
    process.exit(1);
  }

  // The @astrojs/cloudflare adapter (Workers Static Assets) writes the client
  // build to dist/client/, not dist/ directly — scan the resolved directory
  // so PII/token/Keystatic checks see the real production output.
  const DIST = resolveDistDir(BASE_DIST);

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

  // 2. Token scan — API keys and committed secret bindings in dist/, src/,
  //    public/, worker/, and the wrangler configs
  const tokenScanFiles = [
    ...[DIST, "src", "public", "worker"].flatMap(dir => walkAll(dir)),
    ...["wrangler.jsonc", "wrangler.toml"].filter(f => existsSync(f)),
  ];

  for (const file of tokenScanFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      for (const kind of scanTokens(content)) {
        failures.push(`TOKEN: ${tokenLabels[kind]} found in ${file} — ${tokenRemediations[kind]}`);
      }
    } catch {
      // Binary file, skip
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

  // 4. Keystatic admin routes. IndieWeb worker routes (/auth, /micropub,
  //    /media, /webmention) are intentional public endpoints — never flag them.
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
