#!/usr/bin/env npx tsx
/**
 * Pre-deploy security scan. Runs from the scaffolded site directory (not the template).
 *
 * Checks:
 * - No PII patterns (emails, phone numbers) in generated output
 * - No exposed API tokens or secrets
 * - No third-party tracking scripts
 * - No Keystatic admin routes in production output
 *
 * Usage: npx tsx scripts/pre-deploy-check.ts [--json] [--strict]
 *
 * Exit code 0: all clear. Exit code 1: issues found.
 * With --json: prints the versioned {version, ok, failures, warnings} envelope (#742).
 * With --strict: warnings are promoted into `failures` (both in the --json envelope and for
 * exit-code purposes) — used by `npm run build:ci`, the single entry point for non-interactive
 * runners (#799), where a warning-only issue must still block an automated bake/deploy.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllowedDomains } from "./csp";
import { readConfigFromString } from "./config";
import { isMTAStsMarkerOwned, isSecurityTxtMarkerOwned, normalizeMTAStsMX, resolveMTAStsMode, resolveSecurityTxtMode } from "./edge-artifacts";

interface Issue {
  severity: "error" | "warning";
  category: string;
  message: string;
  file?: string;
}

interface ScanReport {
  version: 1;
  ok: boolean;
  failures: Issue[];
  warnings: Issue[];
}

const JSON_MODE = process.argv.includes("--json");
const STRICT_MODE = process.argv.includes("--strict");
const DIST_DIR = join(process.cwd(), "dist");
const HEADERS_FILE = join(DIST_DIR, "_headers");
const CONFIG_FILE = join(process.cwd(), ".site-config");

const PII_PATTERNS = [
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone", pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
  { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
];

const SECRET_PATTERNS = [
  { name: "API key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_-]{20,}/gi },
  { name: "AWS key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
];

// Trackers with no first-party integration in this catalog. Google Analytics/Tag
// Manager are deliberately absent — the `tracking` integration (ga4 provider) makes
// them a supported, owner-opted-in choice, the same way Plausible/Fathom always were.
const BLOCKED_SCRIPTS = [
  /facebook\.net.*fbevents/i,
  /hotjar\.com/i,
];

const BLOCKED_ROUTES = [/\/keystatic(?:\/|$)/i, /\/api\/keystatic/i];

/**
 * Media hosts belonging to the platforms the embed snapshotter supports (#682). A reference to
 * one of these in built output means an embed is hotlinking rather than serving its snapshotted
 * copy, which leaks every visitor's IP and Referer to the platform — the tracking ADR-0008
 * exists to prevent. Anchor hrefs are excluded: a permalink back to the original post is the
 * point of a citation.
 *
 * Invariant: no entry may be a domain suffix of another entry here (e.g. don't add back
 * "scontent.cdninstagram.com" alongside "cdninstagram.com"). Matching is substring-based, and a
 * generic host already substring-matches every subdomain of it — a redundant, more-specific pair
 * doesn't catch anything extra, and previously caused a single hotlinked URL to be double-reported
 * once per matching entry (see the checkEmbedMedia doc comment for how that's guarded against now).
 */
const EMBED_MEDIA_HOSTS = [
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
  "cdninstagram.com",
  "cdn.bsky.app",
  "i.ytimg.com",
  "img.youtube.com",
  /** Mastodon media is per-instance; files.* covers the common CDN shape. */
  "files.mastodon.social",
];

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/**
 * Validate the generated CSP. Returns one error Issue per problem:
 * missing _headers, no CSP directive, or a configured SCRIPT_ALLOW domain
 * absent from the CSP.
 */
export function checkHeaders(headersContent: string | null, configContent: string): Issue[] {
  const issues: Issue[] = [];
  if (headersContent === null) {
    issues.push({ severity: "error", category: "csp-misconfigured", message: "No dist/_headers — CSP is not enforced.", file: "_headers" });
    return issues;
  }
  const cspLine = headersContent
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("Content-Security-Policy:"));
  if (!cspLine) {
    issues.push({ severity: "error", category: "csp-misconfigured", message: "dist/_headers has no Content-Security-Policy.", file: "_headers" });
    return issues;
  }
  const cspTokens = new Set(
    cspLine
      .replace(/^Content-Security-Policy:/, "")
      .split(/[\s;]+/)
      .filter((t) => t.length > 0),
  );
  const allow = parseAllowedDomains(configContent);
  for (const domain of allow) {
    if (!cspTokens.has(domain)) {
      issues.push({
        severity: "error",
        category: "csp-misconfigured",
        message: `Configured integration domain "${domain}" is missing from the CSP.`,
        file: "_headers",
      });
    }
  }
  return issues;
}

/**
 * Scan built content for likely PII (email, phone, SSN). An email that appears only as a
 * `mailto:` link target is published intent — e.g. a contact-form fallback the site owner
 * deliberately configured — not accidental exposure, so it's stripped before the email check.
 * Phone/SSN patterns are unaffected. One issue per pattern per file, matching the prior inline
 * scan's behavior.
 */
export function checkPII(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  const withoutMailtoLinks = content.replace(
    /mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "",
  );
  for (const { name, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    const haystack = name === "email" ? withoutMailtoLinks : content;
    if (pattern.test(haystack)) {
      issues.push({
        severity: "error",
        category: `pii-${name.toLowerCase()}`,
        message: `Possible ${name} found`,
        file,
      });
    }
  }
  return issues;
}

/**
 * Hotlinked platform media in built output. Scans the resource-loading contexts a browser
 * actually fetches from — `src`/`srcset` attributes (double-quoted, single-quoted, or unquoted,
 * so hand-authored or pasted embed HTML is caught too, not just Astro's always-quoted compiled
 * output; `\bsrc` also matches `data-src`, which is desirable — a lazy-loaded image still
 * describes a real fetch) and CSS `url(...)` — for a value naming one of the
 * `EMBED_MEDIA_HOSTS`. `href` is never matched, so a citation permalink to the original post
 * passes even when it points at a listed host.
 *
 * Matching is per-occurrence, not per-host: each `src`/`srcset`/`url()` match is checked and
 * reported independently, so two distinct hotlinks in the same file are two issues even when
 * both happen to match the same generic host entry (e.g. two different `*.cdninstagram.com`
 * subdomains) — a file-wide "did this host appear anywhere" pass would only catch one of them.
 */
export function checkEmbedMedia(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  const urlContextPattern =
    /\b(?:src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlContextPattern.exec(content)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
    const host = EMBED_MEDIA_HOSTS.find((h) => value.includes(h));
    if (host) {
      issues.push({
        severity: "error",
        category: "embed-media-hotlink",
        message: `Embed media hotlinked from ${host} — run "npm run embed -- <url>" to snapshot it first-party.`,
        file,
      });
    }
  }
  return issues;
}

/**
 * Insecure (http://) subresource references in built HTML/CSS. Targets resource
 * attributes (`src`) and CSS `url(...)` only — NOT `href` — so anchor links and
 * `xmlns="http://..."` declarations do not false-positive. Advisory: slice A's
 * `upgrade-insecure-requests` auto-upgrades these at runtime. One issue per file.
 */
export function checkMixedContent(content: string, file: string): Issue[] {
  const patterns = [/\bsrc\s*=\s*["']http:\/\//i, /url\(\s*["']?http:\/\//i];
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return [{ severity: "warning", category: "mixed-content", message: "Mixed content: insecure http:// resource reference", file }];
    }
  }
  return [];
}

/**
 * External (absolute or protocol-relative) <script> and stylesheet <link> tags
 * with a subresource-integrity problem: either missing `integrity`, or carrying
 * `integrity` without the `crossorigin` attribute it requires — the browser
 * blocks the response on CORS before integrity is evaluated, so the resource
 * silently fails to load. Heuristic tag-level regex match; multi-line tag
 * attributes are not matched. One issue per offending tag.
 */
export function checkSRI(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  const tagPattern = /<(script|link)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(content)) !== null) {
    const tag = m[0];
    const isScript = m[1].toLowerCase() === "script";
    const urlAttr = isScript
      ? /\bsrc\s*=\s*["'](?:https?:)?\/\//i
      : /\bhref\s*=\s*["'](?:https?:)?\/\//i;
    if (!urlAttr.test(tag)) continue;
    if (!isScript && !/\brel\s*=\s*["'][^"']*stylesheet/i.test(tag)) continue;
    const kind = isScript ? "script" : "stylesheet";
    if (!/\bintegrity\s*=/i.test(tag)) {
      issues.push({ severity: "warning", category: "sri-missing", message: `External ${kind} without subresource integrity (SRI)`, file });
    } else if (!/\scrossorigin\b/i.test(tag)) {
      issues.push({
        severity: "warning",
        category: "sri-missing",
        message: `External ${kind} has integrity but is missing crossorigin (will fail CORS)`,
        file,
      });
    }
  }
  return issues;
}

/**
 * Anchors that open a new tab (`target="_blank"`) without `rel="noopener"`,
 * which can expose `window.opener`. `rel="noreferrer"` also implies noopener
 * (per the HTML spec and all modern browsers), so either token is accepted.
 * Advisory — modern browsers imply noopener, but explicit is safer. One issue
 * per offending anchor.
 */
export function checkExternalLinkRel(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  const anchorPattern = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorPattern.exec(content)) !== null) {
    const tag = m[0];
    if (!/\btarget\s*=\s*["']_blank["']/i.test(tag)) continue;
    const relMatch = tag.match(/\brel\s*=\s*["']([^"']*)["']/i);
    const rel = relMatch ? relMatch[1].toLowerCase() : "";
    if (!/\bnoopener\b|\bnoreferrer\b/.test(rel)) {
      issues.push({ severity: "warning", category: "external-link-rel", message: 'Link with target="_blank" missing rel="noopener"', file });
    }
  }
  return issues;
}

/**
 * Warn when expected security artifacts are absent from the built output.
 * `scripts/edge-artifacts.ts` (C1) always generates robots.txt at build. security.txt's
 * lifecycle is mode-aware (`SECURITY_TXT_MODE`) and is checked separately by
 * `checkSecurityTxt`, since presence alone is not conformance for that file.
 */
export function checkArtifactPresence(relPaths: string[]): Issue[] {
  const set = new Set(relPaths.map((p) => p.replace(/\\/g, "/")));
  const required = ["dist/robots.txt"];
  const issues: Issue[] = [];
  for (const path of required) {
    if (!set.has(path)) {
      issues.push({
        severity: "warning",
        category: "missing-security-artifact",
        message: `Missing security artifact: ${path.replace(/^dist\//, "")}`,
        file: path,
      });
    }
  }
  return issues;
}

interface SecurityTxtFields {
  contactCount: number;
  expiresValues: string[];
  canonicalValues: string[];
  hasFinalNewline: boolean;
  hasReplacementChar: boolean;
}

function parseSecurityTxtFields(content: string): SecurityTxtFields {
  const lines = content.split("\n");
  const fieldValues = (name: string) =>
    lines
      .filter((l) => new RegExp(`^${name}:`, "i").test(l.trim()))
      .map((l) => l.trim().replace(new RegExp(`^${name}:\\s*`, "i"), ""));
  return {
    contactCount: fieldValues("Contact").length,
    expiresValues: fieldValues("Expires"),
    canonicalValues: fieldValues("Canonical"),
    hasFinalNewline: content.endsWith("\n"),
    hasReplacementChar: content.includes("�"),
  };
}

/**
 * State-aware security.txt check (#743): validates against the resolved `SECURITY_TXT_MODE`
 * rather than requiring unconditional presence. disabled-and-absent is silent; a mode/file
 * contradiction (disabled-but-published, generated-but-not-Anglesite's-own-output) is one
 * finding; otherwise the published content is parsed for RFC 9116 conformance — Contact present,
 * exactly one (non-expired) Expires, at most one Canonical (matching `SITE_URL`'s origin when
 * both are set), and a final newline.
 */
const RECOGNIZED_SECURITY_TXT_MODES = new Set(["generated", "manual", "disabled"]);

export function checkSecurityTxt(content: string | null, configContent: string, now: Date): Issue[] {
  const file = "dist/.well-known/security.txt";
  const rawMode = readConfigFromString(configContent, "SECURITY_TXT_MODE");
  const mode = resolveSecurityTxtMode(rawMode, readConfigFromString(configContent, "SECURITY_CONTACT"));

  // An unset key legitimately falls back to inference (see resolveSecurityTxtMode's own doc
  // comment) — but a non-empty, unrecognized value (e.g. a typo like "Generated") silently gets
  // the same fallback with no signal that the key was ignored. Surface that distinctly, then keep
  // evaluating with the inferred mode rather than short-circuiting on it.
  const modeIssues: Issue[] =
    rawMode !== undefined && rawMode.trim().length > 0 && !RECOGNIZED_SECURITY_TXT_MODES.has(rawMode)
      ? [
          {
            severity: "warning",
            category: "security-txt-issue",
            message: `SECURITY_TXT_MODE="${rawMode}" is not a recognized value (generated|manual|disabled) — falling back to inferring from SECURITY_CONTACT.`,
            file,
          },
        ]
      : [];

  if (mode === "disabled") {
    if (content === null) return modeIssues;
    return [
      ...modeIssues,
      {
        severity: "warning",
        category: "security-txt-issue",
        message: "SECURITY_TXT_MODE=disabled but dist/.well-known/security.txt was published.",
        file,
      },
    ];
  }

  if (mode === "generated" && content !== null && !isSecurityTxtMarkerOwned(content)) {
    return [
      ...modeIssues,
      {
        severity: "warning",
        category: "security-txt-issue",
        message: "SECURITY_TXT_MODE=generated but the published security.txt wasn't generated by Anglesite.",
        file,
      },
    ];
  }

  if (content === null) {
    return [
      ...modeIssues,
      {
        severity: "warning",
        category: "security-txt-issue",
        message:
          mode === "generated"
            ? "SECURITY_TXT_MODE=generated but dist/.well-known/security.txt is missing — check SECURITY_CONTACT is set to a usable contact."
            : "SECURITY_TXT_MODE=manual but dist/.well-known/security.txt is missing.",
        file,
      },
    ];
  }

  const issues: Issue[] = [...modeIssues];
  const fields = parseSecurityTxtFields(content);

  if (fields.contactCount === 0) {
    issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt has no Contact field.", file });
  }

  if (fields.expiresValues.length !== 1) {
    issues.push({
      severity: "warning",
      category: "security-txt-issue",
      message: `security.txt must have exactly one Expires field (found ${fields.expiresValues.length}).`,
      file,
    });
  } else {
    const expires = new Date(fields.expiresValues[0]);
    if (Number.isNaN(expires.getTime())) {
      issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt Expires value is not a valid date.", file });
    } else if (expires.getTime() < now.getTime()) {
      issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt Expires date has passed (stale).", file });
    }
  }

  if (fields.canonicalValues.length > 1) {
    issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt has more than one Canonical field.", file });
  } else if (fields.canonicalValues.length === 1) {
    let canonicalOrigin: string | null = null;
    try {
      const parsed = new URL(fields.canonicalValues[0]);
      canonicalOrigin = parsed.protocol === "https:" ? parsed.origin : null;
    } catch {
      canonicalOrigin = null;
    }
    if (canonicalOrigin === null) {
      issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt Canonical must be a valid HTTPS URL.", file });
    } else {
      const siteUrl = readConfigFromString(configContent, "SITE_URL");
      let siteOrigin: string | null = null;
      if (siteUrl) {
        try {
          siteOrigin = new URL(siteUrl).origin;
        } catch {
          siteOrigin = null;
        }
      }
      if (siteOrigin && siteOrigin !== canonicalOrigin) {
        issues.push({
          severity: "warning",
          category: "security-txt-issue",
          message: `security.txt Canonical origin (${canonicalOrigin}) does not match SITE_URL (${siteOrigin}).`,
          file,
        });
      }
    }
  }

  if (!fields.hasFinalNewline) {
    issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt does not end with a final newline.", file });
  }
  if (fields.hasReplacementChar) {
    issues.push({ severity: "warning", category: "security-txt-issue", message: "security.txt contains invalid UTF-8 (replacement character found).", file });
  }

  return issues;
}

/**
 * RFC 8461 MTA-STS policy check. A disabled site must not accidentally publish a policy; enabled
 * modes require an Anglesite-owned policy with exactly one version/mode/max_age, at least one MX,
 * and a max_age within the RFC's one-year upper bound. DNS is checked by the Domain settings
 * workflow because a static build has no authority to inspect the authoritative zone.
 */
export function checkMTAStsPolicy(content: string | null, configContent: string): Issue[] {
  const file = "dist/.well-known/mta-sts.txt";
  const rawMode = readConfigFromString(configContent, "MTA_STS_MODE");
  const mode = resolveMTAStsMode(rawMode);
  const issues: Issue[] = [];
  if (rawMode !== undefined && rawMode.trim().length > 0 && !["disabled", "testing", "enforce"].includes(rawMode)) {
    issues.push({ severity: "warning", category: "mta-sts-issue", message: `MTA_STS_MODE=\"${rawMode}\" is not a recognized value (disabled|testing|enforce).`, file });
  }
  if (mode === "disabled") {
    if (content !== null) issues.push({ severity: "warning", category: "mta-sts-issue", message: "MTA_STS_MODE=disabled but dist/.well-known/mta-sts.txt was published.", file });
    return issues;
  }
  if (normalizeMTAStsMX(readConfigFromString(configContent, "MTA_STS_MX")).length === 0) {
    issues.push({ severity: "warning", category: "mta-sts-issue", message: `MTA_STS_MODE=${mode} but MTA_STS_MX has no valid MX host.`, file });
  }
  if (content === null) {
    issues.push({ severity: "warning", category: "mta-sts-issue", message: `MTA_STS_MODE=${mode} but dist/.well-known/mta-sts.txt is missing.`, file });
    return issues;
  }
  if (!isMTAStsMarkerOwned(content)) {
    issues.push({ severity: "warning", category: "mta-sts-issue", message: "MTA_STS_MODE is enabled but the published MTA-STS policy was not generated by Anglesite.", file });
  }
  const values = (field: string) => content.split("\n")
    .filter((line) => new RegExp(`^${field}:`, "i").test(line.trim()))
    .map((line) => line.trim().replace(new RegExp(`^${field}:\\s*`, "i"), ""));
  const version = values("version");
  const policyMode = values("mode");
  const mx = values("mx");
  const maxAge = values("max_age");
  const normalizedMX = mx.map((host) => normalizeMTAStsMX(host));
  const mxHosts = normalizedMX.flat();
  if (version.length !== 1 || version[0] !== "STSv1") issues.push({ severity: "warning", category: "mta-sts-issue", message: "MTA-STS policy must contain exactly one version: STSv1 field.", file });
  if (policyMode.length !== 1 || policyMode[0] !== mode) issues.push({ severity: "warning", category: "mta-sts-issue", message: `MTA-STS policy mode must match MTA_STS_MODE=${mode}.`, file });
  if (mx.length === 0 || normalizedMX.some((hosts) => hosts.length !== 1) || new Set(mxHosts).size !== mxHosts.length) issues.push({ severity: "warning", category: "mta-sts-issue", message: "MTA-STS policy needs one valid, unique mx field per permitted MX host.", file });
  if (maxAge.length !== 1 || !/^\d{1,10}$/.test(maxAge[0]) || Number(maxAge[0]) > 31_557_600) issues.push({ severity: "warning", category: "mta-sts-issue", message: "MTA-STS policy must contain one max_age from 0 through 31557600.", file });
  if (!content.endsWith("\n")) issues.push({ severity: "warning", category: "mta-sts-issue", message: "MTA-STS policy does not end with a final newline.", file });
  return issues;
}

async function scan(): Promise<Issue[]> {
  const issues: Issue[] = [];

  try {
    await stat(DIST_DIR);
  } catch {
    issues.push({ severity: "warning", category: "missing-security-artifact", message: "No dist/ directory found — nothing to scan." });
    return issues;
  }

  const headersContent = await readFile(HEADERS_FILE, "utf-8").catch((e: NodeJS.ErrnoException) =>
    e.code === "ENOENT" ? null : Promise.reject(e),
  );
  const configContent = await readFile(CONFIG_FILE, "utf-8").catch((e: NodeJS.ErrnoException) =>
    e.code === "ENOENT" ? "" : Promise.reject(e),
  );
  issues.push(...checkHeaders(headersContent, configContent));

  const securityTxtContent = await readFile(join(DIST_DIR, ".well-known", "security.txt"), "utf-8").catch(
    (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)),
  );
  issues.push(...checkSecurityTxt(securityTxtContent, configContent, new Date()));
  const mtaStsContent = await readFile(join(DIST_DIR, ".well-known", "mta-sts.txt"), "utf-8").catch(
    (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)),
  );
  issues.push(...checkMTAStsPolicy(mtaStsContent, configContent));

  const relPaths: string[] = [];

  for await (const file of walk(DIST_DIR)) {
    if (!/\.(html?|js|css|json|xml|txt)$/i.test(file)) continue;
    const content = await readFile(file, "utf-8");
    const rel = relative(process.cwd(), file);
    relPaths.push(rel);

    issues.push(...checkPII(content, rel));

    const isHtmlOrCss = /\.(html?|css)$/i.test(file);
    if (isHtmlOrCss) {
      issues.push(...checkEmbedMedia(content, rel));
    }

    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        issues.push({ severity: "error", category: "exposed-token", message: `Possible ${name} exposed`, file: rel });
      }
    }

    if (isHtmlOrCss) {
      issues.push(...checkMixedContent(content, rel));
    }

    if (/\.html?$/i.test(file)) {
      for (const pattern of BLOCKED_SCRIPTS) {
        if (pattern.test(content)) {
          issues.push({
            severity: "warning",
            category: "third-party-script",
            message: `Third-party tracking script detected: ${pattern.source}`,
            file: rel,
          });
        }
      }

      for (const pattern of BLOCKED_ROUTES) {
        if (pattern.test(content)) {
          issues.push({
            severity: "error",
            category: "keystatic-route",
            message: "Keystatic admin route found in production output",
            file: rel,
          });
        }
      }

      issues.push(...checkSRI(content, rel));
      issues.push(...checkExternalLinkRel(content, rel));
    }
  }

  issues.push(...checkArtifactPresence(relPaths));

  return issues;
}

async function main() {
  const issues = await scan();
  let failures = issues.filter((i) => i.severity === "error");
  let warnings = issues.filter((i) => i.severity === "warning");

  if (STRICT_MODE) {
    failures = failures.concat(warnings);
    warnings = [];
  }

  if (JSON_MODE) {
    const report: ScanReport = { version: 1, ok: failures.length === 0, failures, warnings };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    if (issues.length === 0) {
      console.log("Pre-deploy check passed — no issues found.");
    } else {
      for (const issue of issues) {
        const prefix = issue.severity === "error" ? "ERROR" : "WARN";
        const loc = issue.file ? ` (${issue.file})` : "";
        console.log(`[${prefix}] ${issue.message}${loc}`);
      }
    }
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
