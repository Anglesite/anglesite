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
} from "../template/scripts/pre-deploy-check.js";

// ---------------------------------------------------------------------------
// Shell script safety
// ---------------------------------------------------------------------------

describe("pre-deploy-check.sh safety", () => {
  it("does not use eval for script grep", () => {
    const src = readFileSync(
      resolve(__dirname, "../scripts/pre-deploy-check.sh"),
      "utf-8",
    );
    expect(src).not.toContain("eval ");
  });
});

// ---------------------------------------------------------------------------
// scanEmails
// ---------------------------------------------------------------------------

describe("scanEmails", () => {
  it("finds real emails", () => {
    const result = scanEmails("Contact us at user@example.com for info.", []);
    expect(result).toEqual(["user@example.com"]);
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
