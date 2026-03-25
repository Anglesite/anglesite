import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanEmails,
  scanPhones,
  scanTokens,
  scanScripts,
  walkHtml,
  walkAll,
} from "../template/scripts/pre-deploy-check.js";

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
    expect(scanPhones("Call us at (555) 123-4567")).toBe(true);
  });

  it("detects 555.123.4567", () => {
    expect(scanPhones("Phone: 555.123.4567")).toBe(true);
  });

  it("detects 555-123-4567", () => {
    expect(scanPhones("Phone: 555-123-4567")).toBe(true);
  });

  it("returns false for content without phone numbers", () => {
    expect(scanPhones("No phone numbers here.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanTokens
// ---------------------------------------------------------------------------

describe("scanTokens", () => {
  it("detects pat prefix tokens (14+ alphanumeric chars)", () => {
    expect(scanTokens("token: patAbcDefGhiJklMn")).toBe(true);
  });

  it("detects sk- prefix tokens (20+ alphanumeric chars)", () => {
    expect(scanTokens("key: sk-AbcDefGhiJklMnOpQrStUv")).toBe(true);
  });

  it("returns false for short pat string", () => {
    expect(scanTokens("pat123")).toBe(false);
  });

  it("returns false for short sk- string", () => {
    expect(scanTokens("sk-abc")).toBe(false);
  });

  it("returns false for normal content", () => {
    expect(scanTokens("Just some regular text about patterns.")).toBe(false);
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
