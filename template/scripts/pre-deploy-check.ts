/**
 * Pre-deploy security scans. Exit code 1 blocks deploy.
 *
 * Scans:
 * 1. PII (emails, phone numbers in dist/)
 * 2. API tokens in dist/, src/, public/
 * 3. Unauthorized third-party scripts
 * 4. Keystatic admin routes in production build
 * 5. OG image presence (warn only)
 *
 * Usage: tsx scripts/pre-deploy-check.ts
 * Also runs on Cloudflare's build system via the build command.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { readConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Exported patterns and constants
// ---------------------------------------------------------------------------

export const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const emailExcludes = ["charset", "viewport", "@astro", "@import", "@keyframes", "@media", "@font-face", "@layer", "@property"];
export const phonePattern = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
export const tokenPattern = /(?:pat[A-Za-z0-9]{14,}|sk-[A-Za-z0-9]{20,})/;
export const scriptSrcPattern = /<script[^>]*src=/gi;
export const allowedScripts = ["cloudflareinsights", "_astro", "challenges.cloudflare.com", "cdn.polar.sh"];

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

export function scanPhones(content: string): boolean {
  // Reset lastIndex since phonePattern has the global flag
  phonePattern.lastIndex = 0;
  return phonePattern.test(content);
}

export function scanTokens(content: string): boolean {
  return tokenPattern.test(content);
}

export function scanScripts(content: string): string[] {
  scriptSrcPattern.lastIndex = 0;
  const results: string[] = [];
  const matches = content.match(scriptSrcPattern) || [];
  for (const match of matches) {
    const lineIdx = content.indexOf(match);
    const line = content.slice(lineIdx, content.indexOf(">", lineIdx) + 1);
    if (!allowedScripts.some(allowed => line.includes(allowed))) {
      results.push(line);
    }
  }
  return results;
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
    if (scanPhones(content)) {
      failures.push(`PII: possible phone number in ${file}`);
    }
  }

  // 2. Token scan — API keys in dist/, src/, public/
  const scanDirs = [DIST, "src", "public"].filter(existsSync);

  for (const dir of scanDirs) {
    for (const file of walkAll(dir)) {
      try {
        const content = readFileSync(file, "utf-8");
        if (scanTokens(content)) {
          failures.push(`TOKEN: API token pattern found in ${file}`);
        }
      } catch {
        // Binary file, skip
      }
    }
  }

  // 3. Third-party scripts
  for (const file of htmlFiles) {
    const content = readFileSync(file, "utf-8");
    const unauthorized = scanScripts(content);
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

  // Report
  if (emailAllowlist.length > 0) {
    console.log(`PII allowlist: ${emailAllowlist.join(", ")}`);
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
