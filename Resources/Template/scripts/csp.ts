#!/usr/bin/env npx tsx
/**
 * Build-time CSP generator. Reads SCRIPT_ALLOW from .site-config and writes a
 * complete public/_headers file. Integration domains are applied broadly to the
 * five directives embeds/forms need (script/frame/connect/img/form-action). See
 * docs/superpowers/specs/2026-06-22-csp-headers-enforcement-design.md.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigFromString } from "./config";

/** Directives each configured integration domain is added to. */
const EMBED_DIRECTIVES = ["script-src", "frame-src", "connect-src", "img-src", "form-action"];

/** Baseline directive values (secure-by-default). */
const BASE: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "static.cloudflareinsights.com"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'", "cloudflareinsights.com"],
  "frame-src": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "upgrade-insecure-requests": [],
};

/** Emission order for directives (stable, reproducible output). */
const DIRECTIVE_ORDER = [
  "default-src", "script-src", "style-src", "img-src", "font-src",
  "connect-src", "frame-src", "object-src", "frame-ancestors", "base-uri", "form-action",
  "upgrade-insecure-requests",
];

/** Sorted, deduped, non-empty domains from the SCRIPT_ALLOW key. */
export function parseAllowedDomains(configContent: string): string[] {
  const raw = readConfigFromString(configContent, "SCRIPT_ALLOW") ?? "";
  const domains = raw.split(",").map((d) => d.trim()).filter((d) => d.length > 0);
  return [...new Set(domains)].sort();
}

/** Compose the Content-Security-Policy header value. */
export function buildCSP(configContent: string): string {
  const domains = parseAllowedDomains(configContent);
  const directives: Record<string, string[]> = {};
  for (const name of DIRECTIVE_ORDER) directives[name] = [...BASE[name]];
  for (const name of EMBED_DIRECTIVES) {
    for (const d of domains) {
      if (!directives[name].includes(d)) directives[name].push(d);
    }
  }
  // Inline video (#682) is opt-in and narrow: click-to-load youtube-nocookie only, and only
  // frame-src. The default card is a thumbnail link, so the baseline policy stays untouched.
  // Exact "true" only — matching HSTS_PRELOAD's deliberate strictness above.
  if ((readConfigFromString(configContent, "EMBED_VIDEO_INLINE") ?? "").trim().toLowerCase() === "true") {
    directives["frame-src"].push("www.youtube-nocookie.com");
  }
  return DIRECTIVE_ORDER.map((name) =>
    directives[name].length ? `${name} ${directives[name].join(" ")}` : name,
  ).join("; ");
}

/**
 * Compose the full public/_headers file body.
 *
 * `serviceWorkerPresent` is derived by `main()` from whether `public/sw.js` exists on disk. The
 * pwa integration doesn't append its own `/sw.js` cache rule directly into `_headers` — this
 * function unconditionally regenerates the whole file on every build's `prebuild` step, so
 * anything appended outside of it would be silently wiped on the very next build. Re-deriving the
 * rule here from the file's presence means it survives every rebuild without pwa needing to touch
 * `_headers` at all.
 */
export function buildHeaders(configContent: string, serviceWorkerPresent = false): string {
  const csp = buildCSP(configContent);
  // Only the exact (case-insensitive) string "true" enables preload — submission to
  // the browser preload lists is hard to reverse, so "1"/"yes"/"on" deliberately do not.
  const hstsPreload =
    (readConfigFromString(configContent, "HSTS_PRELOAD") ?? "").trim().toLowerCase() === "true";
  const hsts = `max-age=31536000; includeSubDomains${hstsPreload ? "; preload" : ""}`;
  // COOP: same-origin-allow-popups (not same-origin) preserves window.opener for
  // popups the site itself opens — OAuth sign-in, Stripe/PayPal checkout — while
  // still isolating attacker-opened windows.
  // CORP: same-site (not same-origin) keeps cross-origin (cross-site) isolation but
  // lets same-site subdomains load shared assets (e.g. a logo on blog.example.com).
  let out = `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Cross-Origin-Resource-Policy: same-site
  Strict-Transport-Security: ${hsts}
  Content-Security-Policy: ${csp}
  Cache-Control: public, max-age=0, must-revalidate

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/.well-known/security.txt
  Content-Type: text/plain; charset=utf-8

/.well-known/mta-sts.txt
  Content-Type: text/plain; charset=utf-8
`;
  if (serviceWorkerPresent) {
    out += `
/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /
`;
  }
  return out;
}

function main(): void {
  const configPath = resolve(process.cwd(), ".site-config");
  const config = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const outPath = resolve(process.cwd(), "public", "_headers");
  const serviceWorkerPresent = existsSync(resolve(process.cwd(), "public", "sw.js"));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildHeaders(config, serviceWorkerPresent), "utf-8");
  console.log(`Wrote ${outPath}`);
}

// Run only when invoked directly (e.g. `npx tsx scripts/csp.ts`), never on import.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
