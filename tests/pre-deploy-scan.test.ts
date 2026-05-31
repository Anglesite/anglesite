import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { runScan, type ScanReport } from "../template/scripts/pre-deploy-check.js";

// `runScan` is the JSON-mode entry point for the Anglesite-app's
// pre-deploy check. The shell hook (scripts/pre-deploy-check.sh) and the
// per-site CLI mode (`tsx scripts/pre-deploy-check.ts`) are unchanged; this
// new function exposes the same scans as a structured report so the macOS
// app can render failures in a sheet with no override.

describe("runScan", () => {
  let site: string;

  beforeEach(() => {
    site = mkdtempSync(join(tmpdir(), "anglesite-prescan-"));
  });

  afterEach(() => {
    rmSync(site, { recursive: true, force: true });
  });

  function writeFile(rel: string, contents: string) {
    const full = join(site, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }

  it("returns ok=true with no failures for a clean dist/", () => {
    writeFile("dist/index.html", "<!doctype html><html><body><h1>Hello</h1></body></html>");

    const report: ScanReport = runScan({ siteDir: site });

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("flags a PII email in dist/ HTML as ok=false with a pii-email failure", () => {
    writeFile(
      "dist/index.html",
      "<!doctype html><p>Contact us at jane@yourbusiness.com</p>",
    );

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].category).toBe("pii-email");
    expect(report.failures[0].file).toBe("dist/index.html");
    expect(report.failures[0].detail).toContain("jane@yourbusiness.com");
    expect(report.failures[0].remediation).toMatch(/PII_EMAIL_ALLOW|mailto/);
  });

  it("respects PII_EMAIL_ALLOW from .site-config", () => {
    writeFile(
      "dist/index.html",
      "<!doctype html><p>Reach out to hello@mysite.com today.</p>",
    );
    writeFile(".site-config", "PII_EMAIL_ALLOW=hello@mysite.com\n");

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("flags a PII phone number in dist/ HTML as a pii-phone failure", () => {
    writeFile(
      "dist/contact.html",
      "<!doctype html><p>Call us at (555) 123-4567 today.</p>",
    );

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].category).toBe("pii-phone");
    expect(report.failures[0].file).toBe("dist/contact.html");
    expect(report.failures[0].detail).toContain("(555) 123-4567");
  });

  it("flags an exposed Airtable PAT in src/ as an exposed-token failure", () => {
    const pat = "pat" + "A".repeat(14) + "." + "B".repeat(64);
    writeFile("dist/index.html", "<!doctype html><p>hi</p>");
    writeFile("src/leaked.ts", `export const TOKEN = "${pat}";`);

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(false);
    expect(report.failures.some(f => f.category === "exposed-token")).toBe(true);
    const tokenFailure = report.failures.find(f => f.category === "exposed-token")!;
    expect(tokenFailure.file).toBe("src/leaked.ts");
    expect(tokenFailure.remediation).toMatch(/rotate/i);
  });

  it("flags an unauthorized third-party script as a third-party-script failure", () => {
    writeFile(
      "dist/index.html",
      '<!doctype html><script src="https://evil.example.com/x.js"></script>',
    );

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(false);
    expect(report.failures.some(f => f.category === "third-party-script")).toBe(true);
    expect(report.failures.find(f => f.category === "third-party-script")!.detail).toContain(
      "evil.example.com",
    );
  });

  it("flags Keystatic admin routes leaking into dist/ as a keystatic-route failure", () => {
    writeFile("dist/index.html", "<!doctype html><p>hi</p>");
    writeFile("dist/keystatic/index.html", "<!doctype html><p>admin</p>");

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(false);
    const ks = report.failures.find(f => f.category === "keystatic-route");
    expect(ks).toBeDefined();
    expect(ks!.file).toContain("keystatic");
  });

  it("throws a descriptive error when dist/ is missing (build hasn't run)", () => {
    // No dist/ written
    expect(() => runScan({ siteDir: site })).toThrow(/dist\/ not found/);
  });

  it("emits a missing-og-image warning when no page declares og:image", () => {
    writeFile("dist/index.html", "<!doctype html><html><head></head><body><h1>Hi</h1></body></html>");

    const report = runScan({ siteDir: site });

    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.category === "missing-og-image")).toBe(true);
  });

  it("does not warn about og:image when at least one page declares it", () => {
    writeFile(
      "dist/index.html",
      '<!doctype html><html><head><meta property="og:image" content="/og.png"></head><body><h1>Hi</h1></body></html>',
    );

    const report = runScan({ siteDir: site });

    expect(report.warnings.some(w => w.category === "missing-og-image")).toBe(false);
  });

  it("emits a maintenance-overdue warning when no maintenance has been logged", () => {
    writeFile(
      "dist/index.html",
      '<!doctype html><html><head><meta property="og:image" content="/og.png"></head><body><h1>Hi</h1></body></html>',
    );

    const report = runScan({ siteDir: site });

    expect(report.warnings.some(w => w.category === "maintenance-overdue")).toBe(true);
  });

  it("does not warn about maintenance when the log stamps are current", () => {
    const today = new Date().toISOString().slice(0, 10);
    writeFile(
      "dist/index.html",
      '<!doctype html><html><head><meta property="og:image" content="/og.png"></head><body><h1>Hi</h1></body></html>',
    );
    writeFile(
      ".site-config",
      `MAINTENANCE_MONTHLY_LAST=${today}\nMAINTENANCE_QUARTERLY_LAST=${today}\nMAINTENANCE_ANNUAL_LAST=${today}\n`,
    );

    const report = runScan({ siteDir: site });

    expect(report.warnings.some(w => w.category === "maintenance-overdue")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI shim — `tsx scripts/pre-deploy-check.ts --json` for the macOS app.
// ---------------------------------------------------------------------------

describe("pre-deploy-check.ts --json CLI", () => {
  let site: string;

  beforeEach(() => {
    site = mkdtempSync(join(tmpdir(), "anglesite-prescan-cli-"));
  });

  afterEach(() => {
    rmSync(site, { recursive: true, force: true });
  });

  function writeFile(rel: string, contents: string) {
    const full = join(site, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }

  const scriptPath = resolve(__dirname, "../template/scripts/pre-deploy-check.ts");

  it("emits a ScanReport JSON document on stdout and exits 0 when ok", () => {
    writeFile("dist/index.html", "<!doctype html><h1>Hello</h1>");

    const result = spawnSync("npx", ["tsx", scriptPath, "--json"], {
      cwd: site,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("emits ok=false JSON and exits 1 when a failure is found", () => {
    writeFile(
      "dist/index.html",
      "<!doctype html><p>Contact jane@yourbusiness.com</p>",
    );

    const result = spawnSync("npx", ["tsx", scriptPath, "--json"], {
      cwd: site,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f: { category: string }) => f.category === "pii-email")).toBe(true);
  });
});
