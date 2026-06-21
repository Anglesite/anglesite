import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  scanEmails,
  scanPhones,
  scanTokens,
  scanScripts,
  walkHtml,
  walkAll,
  daysSince,
  scanMaintenance,
  formatMaintenanceWarning,
  maintenanceCategories,
  isReservedExampleEmail,
  indiewebWorkerRoutes,
} from "../template/scripts/pre-deploy-check.js";

// ---------------------------------------------------------------------------
// Shell script safety
// ---------------------------------------------------------------------------

describe("pre-deploy-check.sh safety", () => {
  const src = readFileSync(
    resolve(__dirname, "../scripts/pre-deploy-check.sh"),
    "utf-8",
  );

  it("does not use eval for script grep", () => {
    expect(src).not.toContain("eval ");
  });

  it("scans worker/ and the wrangler configs for tokens", () => {
    expect(src).toContain("worker/");
    expect(src).toContain("wrangler.jsonc");
    expect(src).toContain("wrangler.toml");
  });

  it("greps for GitHub token shapes and committed IndieWeb secret bindings", () => {
    expect(src).toContain("github_pat_");
    expect(src).toContain("INDIEAUTH_SIGNING_KEY");
    expect(src).toContain("GITHUB_TOKEN");
  });

  it("documents the IndieWeb worker routes as intentional public endpoints", () => {
    for (const route of ["/auth", "/micropub", "/media", "/webmention"]) {
      expect(src).toContain(route);
    }
  });

  it("boundary-guards the phone scan so URL/DOI/coordinate digit runs don't match (issues #362, #365)", () => {
    // Leading/trailing context classes emulate the .ts lookarounds in POSIX ERE.
    expect(src).toContain("(^|[^0-9/.])");
    expect(src).toContain("([^0-9/]|$)");
  });

  it("only flags external (third-party) script srcs, not same-origin ones (issues #362, #365)", () => {
    expect(src).toContain('src=[\\"\']?(https?:)?//');
  });
});

// ---------------------------------------------------------------------------
// scanEmails
// ---------------------------------------------------------------------------

describe("scanEmails", () => {
  it("finds real emails", () => {
    const result = scanEmails("Contact us at user@mysite.com for info.", []);
    expect(result).toEqual(["user@mysite.com"]);
  });

  it("ignores RFC 2606 reserved example.com placeholders", () => {
    expect(scanEmails("Try you@example.com to subscribe.", [])).toEqual([]);
  });

  it("ignores RFC 2606 reserved example.net and example.org placeholders", () => {
    expect(scanEmails("Reach hello@example.net or info@example.org.", [])).toEqual([]);
  });

  it("ignores reserved .test / .invalid / .localhost TLDs", () => {
    expect(scanEmails("Test a@foo.test, b@bar.invalid, c@baz.localhost.", [])).toEqual([]);
  });

  it("still flags real-looking addresses on non-reserved domains", () => {
    expect(scanEmails("Reach jane@yourbusiness.com today.", [])).toEqual(["jane@yourbusiness.com"]);
  });

  it("ignores CSS at-rules: @import", () => {
    expect(scanEmails("@import url('fonts.css');", [])).toEqual([]);
  });

  it("ignores CSS at-rules: @media", () => {
    expect(scanEmails("@media screen and (min-width: 768px)", [])).toEqual([]);
  });

  it("ignores CSS at-rules: @keyframes", () => {
    expect(scanEmails("@keyframes fadeIn { from { opacity: 0; } }", [])).toEqual([]);
  });

  it("ignores CSS at-rules: @font-face", () => {
    expect(scanEmails("@font-face { font-family: 'Custom'; }", [])).toEqual([]);
  });

  it("ignores CSS at-rules: @layer", () => {
    expect(scanEmails("@layer base { h1 { color: red; } }", [])).toEqual([]);
  });

  it("ignores CSS at-rules: @property", () => {
    expect(scanEmails("@property --color { syntax: '<color>'; }", [])).toEqual([]);
  });

  it("excludes mailto: emails", () => {
    const html = '<a href="mailto:info@example.com">Email us</a>';
    expect(scanEmails(html, [])).toEqual([]);
  });

  it("respects allowlist", () => {
    const result = scanEmails("Reach out to hello@mysite.com today.", ["hello@mysite.com"]);
    expect(result).toEqual([]);
  });

  it("returns empty array for content with no emails", () => {
    expect(scanEmails("No email addresses here.", [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isReservedExampleEmail
// ---------------------------------------------------------------------------

describe("isReservedExampleEmail", () => {
  it("recognizes example.com / example.net / example.org", () => {
    expect(isReservedExampleEmail("a@example.com")).toBe(true);
    expect(isReservedExampleEmail("b@EXAMPLE.NET")).toBe(true);
    expect(isReservedExampleEmail("c@example.org")).toBe(true);
  });

  it("recognizes reserved TLDs (.test, .invalid, .localhost, .example)", () => {
    expect(isReservedExampleEmail("a@foo.test")).toBe(true);
    expect(isReservedExampleEmail("a@foo.invalid")).toBe(true);
    expect(isReservedExampleEmail("a@foo.localhost")).toBe(true);
    expect(isReservedExampleEmail("a@foo.example")).toBe(true);
  });

  it("does not flag normal domains", () => {
    expect(isReservedExampleEmail("a@mysite.com")).toBe(false);
    expect(isReservedExampleEmail("a@yourbusiness.com")).toBe(false);
    expect(isReservedExampleEmail("a@example.com.evil.com")).toBe(false);
  });

  it("returns false for strings without an @", () => {
    expect(isReservedExampleEmail("not-an-email")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanPhones
// ---------------------------------------------------------------------------

describe("scanPhones", () => {
  it("detects (555) 123-4567", () => {
    expect(scanPhones("Call us at (555) 123-4567")).toEqual(["(555) 123-4567"]);
  });

  it("detects 555.123.4567", () => {
    expect(scanPhones("Phone: 555.123.4567")).toEqual(["555.123.4567"]);
  });

  it("detects 555-123-4567", () => {
    expect(scanPhones("Phone: 555-123-4567")).toEqual(["555-123-4567"]);
  });

  it("returns empty array for content without phone numbers", () => {
    expect(scanPhones("No phone numbers here.")).toEqual([]);
  });

  it("respects allowlist with exact format match", () => {
    expect(scanPhones("Call 1-800-662-4357 for help", ["1-800-662-4357"])).toEqual([]);
  });

  it("respects allowlist with different formatting", () => {
    // Allowlist uses dashes, content uses dots — should still match via digit normalization
    expect(scanPhones("Call 800.662.4357 for help", ["1-800-662-4357"])).toEqual([]);
  });

  it("only filters allowlisted numbers, keeps others", () => {
    const content = "Call 800-662-4357 or 555-123-4567";
    expect(scanPhones(content, ["800-662-4357"])).toEqual(["555-123-4567"]);
  });

  it("handles multiple allowlisted numbers", () => {
    const content = "Lines: 800-662-4357, 800-273-8255, 555-000-1234";
    expect(scanPhones(content, ["800-662-4357", "800-273-8255"])).toEqual(["555-000-1234"]);
  });

  // Boundary-guard regressions (issues #362, #365): digit runs embedded in
  // longer tokens must not be mistaken for phone numbers.
  it("ignores a Nature DOI / article id in a citation URL", () => {
    expect(scanPhones("See https://www.nature.com/articles/s41598-025-97652-6 for details.")).toEqual([]);
  });

  it("ignores a Wayback Machine URL timestamp", () => {
    expect(scanPhones('<a href="https://web.archive.org/web/20120120031959/http://example.com/">snapshot</a>')).toEqual([]);
  });

  it("ignores a decimal geo-coordinate", () => {
    expect(scanPhones("The marker sits at 37.3268981241 degrees.")).toEqual([]);
  });

  it("still detects a phone number that ends a sentence", () => {
    expect(scanPhones("Reach the front desk at 555-123-4567.")).toEqual(["555-123-4567"]);
  });

  it("still detects a number with a country-code prefix", () => {
    // The leading '1-' must not suppress the match.
    expect(scanPhones("Call 1-800-662-4357 anytime.")).toEqual(["800-662-4357"]);
  });
});

// ---------------------------------------------------------------------------
// scanTokens
// ---------------------------------------------------------------------------

describe("scanTokens", () => {
  it("detects real-shaped Airtable PATs (pat + 14 chars + . + 32+ chars)", () => {
    // pat + 14 alphanumerics + . + 64 alphanumerics
    const pat = "pat" + "A".repeat(14) + "." + "B".repeat(64);
    expect(scanTokens(`token: ${pat}`)).toEqual(["airtable-pat"]);
  });

  it("detects sk- prefix tokens (20+ alphanumeric chars)", () => {
    expect(scanTokens("key: sk-AbcDefGhiJklMnOpQrStUv")).toEqual(["openai-key"]);
  });

  it("ignores 'pat' followed by alphanumerics without the dot+second segment", () => {
    // Real false positives from Astro SSR adapter
    expect(scanTokens("pathnameContainsDefaultLocale")).toEqual([]);
    expect(scanTokens("patibleDescriptorOptions")).toEqual([]);
    expect(scanTokens("pathFallbackLocale")).toEqual([]);
  });

  it("ignores 'pat' as a substring of larger identifiers", () => {
    // Word boundary keeps `compatibleX` and similar from matching
    expect(scanTokens("compatibleDescriptorXXXXXXXXXX")).toEqual([]);
  });

  it("returns empty for short pat string", () => {
    expect(scanTokens("pat123")).toEqual([]);
  });

  it("returns empty for short sk- string", () => {
    expect(scanTokens("sk-abc")).toEqual([]);
  });

  it("returns empty for normal content", () => {
    expect(scanTokens("Just some regular text about patterns.")).toEqual([]);
  });

  it("detects both kinds when both are present", () => {
    const pat = "pat" + "A".repeat(14) + "." + "B".repeat(64);
    const sk = "sk-" + "C".repeat(40);
    expect(scanTokens(`${pat} and ${sk}`).sort()).toEqual(["airtable-pat", "openai-key"]);
  });

  it("detects classic GitHub PATs (ghp_ + 36 chars)", () => {
    expect(scanTokens("token: ghp_" + "A".repeat(36))).toEqual(["github-token"]);
  });

  it("detects other classic GitHub token prefixes (gho_, ghu_, ghs_, ghr_)", () => {
    for (const prefix of ["gho_", "ghu_", "ghs_", "ghr_"]) {
      expect(scanTokens(`${prefix}${"B".repeat(36)}`)).toEqual(["github-token"]);
    }
  });

  it("detects fine-grained GitHub PATs (github_pat_…)", () => {
    const token = "github_pat_" + "A".repeat(22) + "_" + "B".repeat(59);
    expect(scanTokens(token)).toEqual(["github-token"]);
  });

  it("ignores short gh-prefixed strings", () => {
    expect(scanTokens("ghp_tooshort")).toEqual([]);
  });

  it("flags a committed INDIEAUTH_SIGNING_KEY literal (wrangler vars, .env, source)", () => {
    const key = "a1b2c3d4".repeat(8); // openssl rand -hex 32 shape
    expect(scanTokens(`INDIEAUTH_SIGNING_KEY=${key}`)).toEqual(["committed-secret-binding"]);
    expect(scanTokens(`"INDIEAUTH_SIGNING_KEY": "${key}"`)).toEqual(["committed-secret-binding"]);
    expect(scanTokens(`INDIEAUTH_SIGNING_KEY = "${key}"`)).toEqual(["committed-secret-binding"]);
  });

  it("flags a committed GITHUB_TOKEN literal (both as binding and token shape)", () => {
    const result = scanTokens(`GITHUB_TOKEN="ghp_${"A".repeat(36)}"`).sort();
    expect(result).toEqual(["committed-secret-binding", "github-token"]);
  });

  it("ignores secret *name* references — env access, Actions secrets, wrangler put, docs", () => {
    expect(scanTokens("if (!env.MICROPUB_DB || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return;")).toEqual([]);
    expect(scanTokens("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}")).toEqual([]);
    expect(scanTokens("npx wrangler secret put INDIEAUTH_SIGNING_KEY --name my-site")).toEqual([]);
    expect(scanTokens("gh secret set GITHUB_TOKEN --repo owner/site")).toEqual([]);
    expect(scanTokens("*   GITHUB_TOKEN (secret) — Fine-grained PAT, contents:write only")).toEqual([]);
    expect(scanTokens("INDIEAUTH_SIGNING_KEY: string;")).toEqual([]);
    expect(scanTokens('GITHUB_TOKEN="$GITHUB_TOKEN"')).toEqual([]);
    expect(scanTokens("GITHUB_TOKEN=<paste-your-token-here>")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// indiewebWorkerRoutes — intentional public endpoints (issue #336)
// ---------------------------------------------------------------------------

describe("indiewebWorkerRoutes", () => {
  it("covers the four intentional public endpoints", () => {
    const all = Object.values(indiewebWorkerRoutes).flat();
    for (const route of ["/auth", "/micropub", "/media", "/webmention"]) {
      expect(all).toContain(route);
    }
  });

  it("keys each route group by its .site-config feature flag", () => {
    expect(Object.keys(indiewebWorkerRoutes).sort()).toEqual([
      "INDIEWEB_INDIEAUTH",
      "INDIEWEB_MICROPUB",
      "INDIEWEB_WEBMENTION",
    ]);
  });

  it("includes the IndieAuth metadata discovery path", () => {
    expect(indiewebWorkerRoutes.INDIEWEB_INDIEAUTH).toContain(
      "/.well-known/oauth-authorization-server",
    );
  });
});

// ---------------------------------------------------------------------------
// Template files must never trip the token scan (false-positive regression)
// ---------------------------------------------------------------------------

describe("template IndieWeb files never trip the token scan", () => {
  const templateFiles = [
    "../template/worker/site-entry.js",
    "../template/worker/indieweb-bridge.js",
    "../template/wrangler.jsonc",
    "../template/.github/workflows/deploy.yml",
  ];

  for (const rel of templateFiles) {
    it(`${rel.replace("../template/", "")} is clean`, () => {
      const content = readFileSync(resolve(__dirname, rel), "utf-8");
      expect(scanTokens(content)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// scanScripts
// ---------------------------------------------------------------------------

describe("scanScripts", () => {
  it("detects unauthorized external scripts", () => {
    const html = '<script src="https://evil.com/script.js"></script>';
    const result = scanScripts(html);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("evil.com");
  });

  it("allows internal _astro scripts", () => {
    const html = '<script src="/_astro/hoisted.abc123.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });

  it("allows cloudflareinsights scripts", () => {
    const html = '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });

  it("allows Cloudflare Turnstile scripts", () => {
    const html = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
    expect(scanScripts(html)).toEqual([]);
  });

  it("returns empty array for content with no scripts", () => {
    expect(scanScripts("<p>No scripts here</p>")).toEqual([]);
  });

  // First-party scripts are not third-party (issues #362, #365).
  it("allows a site's own root-relative script", () => {
    const html = '<script src="/js/footnote-popup.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });

  it("allows a relative script path", () => {
    const html = '<script src="js/footnote-popup.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });

  it("flags protocol-relative external scripts", () => {
    const html = '<script src="//evil.example.com/x.js"></script>';
    const result = scanScripts(html);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("evil.example.com");
  });

  it("flags only the external script when first- and third-party scripts coexist", () => {
    const html =
      '<script src="/js/app.js"></script><script src="https://evil.example.com/x.js"></script>';
    const result = scanScripts(html);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("evil.example.com");
  });
});

// ---------------------------------------------------------------------------
// walkHtml / walkAll
// ---------------------------------------------------------------------------

describe("walkHtml", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-walk-test-"));
    // Create nested structure
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html></html>");
    writeFileSync(join(tmpDir, "style.css"), "body {}");
    writeFileSync(join(tmpDir, "sub", "page.html"), "<html></html>");
    writeFileSync(join(tmpDir, "sub", "data.json"), "{}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("only returns .html files", () => {
    const results = walkHtml(tmpDir);
    expect(results.length).toBe(2);
    expect(results.every(f => f.endsWith(".html"))).toBe(true);
  });

  it("finds nested .html files", () => {
    const results = walkHtml(tmpDir);
    expect(results.some(f => f.includes("sub"))).toBe(true);
  });
});

describe("walkAll", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-walkall-test-"));
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    mkdirSync(join(tmpDir, ".hidden"), { recursive: true });
    mkdirSync(join(tmpDir, "node_modules"), { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html></html>");
    writeFileSync(join(tmpDir, "style.css"), "body {}");
    writeFileSync(join(tmpDir, "sub", "page.html"), "<html></html>");
    writeFileSync(join(tmpDir, ".hidden", "secret.txt"), "hidden");
    writeFileSync(join(tmpDir, "node_modules", "pkg.js"), "module");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns all files including non-html", () => {
    const results = walkAll(tmpDir);
    expect(results.some(f => f.endsWith(".html"))).toBe(true);
    expect(results.some(f => f.endsWith(".css"))).toBe(true);
  });

  it("skips dot-directories", () => {
    const results = walkAll(tmpDir);
    expect(results.some(f => f.includes(".hidden"))).toBe(false);
  });

  it("skips node_modules", () => {
    const results = walkAll(tmpDir);
    expect(results.some(f => f.includes("node_modules"))).toBe(false);
  });

  it("returns empty array for non-existent directory", () => {
    expect(walkAll(join(tmpDir, "nonexistent"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Maintenance log
// ---------------------------------------------------------------------------

describe("daysSince", () => {
  it("returns 0 for today", () => {
    const now = new Date("2026-05-07T12:00:00Z");
    expect(daysSince("2026-05-07", now)).toBe(0);
  });

  it("returns positive day count for past dates", () => {
    const now = new Date("2026-05-07T12:00:00Z");
    expect(daysSince("2026-04-07", now)).toBe(30);
  });

  it("returns null for malformed dates", () => {
    expect(daysSince("yesterday")).toBeNull();
    expect(daysSince("2026/05/07")).toBeNull();
    expect(daysSince("")).toBeNull();
  });

  it("ignores time-of-day and timezone drift", () => {
    // Stamp written at the end of a day; "now" is early next morning UTC.
    const now = new Date("2026-05-08T01:00:00Z");
    expect(daysSince("2026-05-07", now)).toBe(1);
  });
});

describe("scanMaintenance", () => {
  const now = new Date("2026-05-07T12:00:00Z");

  it("warns when a category has never been recorded", () => {
    const result = scanMaintenance(() => undefined, now);
    expect(result).toHaveLength(maintenanceCategories.length);
    expect(result.every(w => w.age === null)).toBe(true);
  });

  it("does not warn when stamps are within their grace period", () => {
    const stamps: Record<string, string> = {
      MAINTENANCE_MONTHLY_LAST: "2026-05-01",   // 6 days ago
      MAINTENANCE_QUARTERLY_LAST: "2026-03-01", // 67 days ago
      MAINTENANCE_ANNUAL_LAST: "2025-08-01",    // 279 days ago
    };
    const result = scanMaintenance(k => stamps[k], now);
    expect(result).toEqual([]);
  });

  it("warns when monthly check is overdue", () => {
    const stamps: Record<string, string> = {
      MAINTENANCE_MONTHLY_LAST: "2026-03-01",   // 67 days ago — over 35-day window
      MAINTENANCE_QUARTERLY_LAST: "2026-03-01",
      MAINTENANCE_ANNUAL_LAST: "2025-08-01",
    };
    const result = scanMaintenance(k => stamps[k], now);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("MAINTENANCE_MONTHLY_LAST");
    expect(result[0].age).toBe(67);
  });

  it("warns when quarterly update is overdue", () => {
    const stamps: Record<string, string> = {
      MAINTENANCE_MONTHLY_LAST: "2026-05-01",
      MAINTENANCE_QUARTERLY_LAST: "2026-01-01", // 126 days ago — over 100-day window
      MAINTENANCE_ANNUAL_LAST: "2025-08-01",
    };
    const result = scanMaintenance(k => stamps[k], now);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("MAINTENANCE_QUARTERLY_LAST");
  });

  it("treats malformed stamps as missing", () => {
    const stamps: Record<string, string> = {
      MAINTENANCE_MONTHLY_LAST: "garbage",
      MAINTENANCE_QUARTERLY_LAST: "2026-03-01",
      MAINTENANCE_ANNUAL_LAST: "2025-08-01",
    };
    const result = scanMaintenance(k => stamps[k], now);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("MAINTENANCE_MONTHLY_LAST");
    expect(result[0].age).toBeNull();
  });
});

describe("formatMaintenanceWarning", () => {
  it("formats a missing-stamp warning", () => {
    const msg = formatMaintenanceWarning({
      key: "MAINTENANCE_MONTHLY_LAST",
      label: "monthly health check",
      command: "/anglesite:check",
      age: null,
      graceDays: 35,
    });
    expect(msg).toContain("no record");
    expect(msg).toContain("/anglesite:check");
  });

  it("formats an overdue warning with age and command", () => {
    const msg = formatMaintenanceWarning({
      key: "MAINTENANCE_QUARTERLY_LAST",
      label: "quarterly update",
      command: "/anglesite:update",
      age: 120,
      graceDays: 100,
    });
    expect(msg).toContain("120 days");
    expect(msg).toContain("/anglesite:update");
  });
});
