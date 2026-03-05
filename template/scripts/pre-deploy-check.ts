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
 * Also runs automatically via `npm run deploy`.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "dist";

if (!existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
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

function walkAll(dir: string): string[] {
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
// Scans
// ---------------------------------------------------------------------------

const failures: string[] = [];
const warnings: string[] = [];

const htmlFiles = walkHtml(DIST);

// 1. PII scan — emails
const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const emailExcludes = ["charset", "viewport", "@astro", "@import", "@keyframes", "@media", "@font-face", "@layer", "@property"];

for (const file of htmlFiles) {
  const content = readFileSync(file, "utf-8");
  const matches = content.match(emailPattern) || [];
  const real = matches.filter(m => !emailExcludes.some(ex => m.includes(ex) || content.includes(ex + m)));
  if (real.length > 0) {
    failures.push(`PII: possible email address in ${file}: ${real.join(", ")}`);
  }
}

// 1b. PII scan — phone numbers
const phonePattern = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

for (const file of htmlFiles) {
  const content = readFileSync(file, "utf-8");
  if (phonePattern.test(content)) {
    failures.push(`PII: possible phone number in ${file}`);
  }
}

// 2. Token scan — API keys in dist/, src/, public/
const tokenPattern = /(?:pat[A-Za-z0-9]{14,}|sk-[A-Za-z0-9]{20,})/;
const scanDirs = [DIST, "src", "public"].filter(existsSync);

for (const dir of scanDirs) {
  for (const file of walkAll(dir)) {
    try {
      const content = readFileSync(file, "utf-8");
      if (tokenPattern.test(content)) {
        failures.push(`TOKEN: API token pattern found in ${file}`);
      }
    } catch {
      // Binary file, skip
    }
  }
}

// 3. Third-party scripts
const scriptSrcPattern = /<script[^>]*src=/gi;
const allowedScripts = ["cloudflareinsights", "_astro"];

for (const file of htmlFiles) {
  const content = readFileSync(file, "utf-8");
  const matches = content.match(scriptSrcPattern) || [];
  for (const match of matches) {
    const lineIdx = content.indexOf(match);
    const line = content.slice(lineIdx, content.indexOf(">", lineIdx) + 1);
    if (!allowedScripts.some(allowed => line.includes(allowed))) {
      failures.push(`SCRIPT: unauthorized third-party script in ${file}`);
    }
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

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

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
