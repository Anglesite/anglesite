import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  htmlPathToUrlPath,
  isNoindex,
  extractTitle,
  extractDescription,
  hasJsonLd,
  exitCodeFor,
  resolveDistDir,
  runAudit,
  type SeoAuditReport,
} from "../template/scripts/seo-audit.js";

describe("htmlPathToUrlPath", () => {
  it("maps dist/index.html to /", () => {
    expect(htmlPathToUrlPath("dist/index.html", "dist")).toBe("/");
  });

  it("maps dist/blog/index.html to /blog/", () => {
    expect(htmlPathToUrlPath("dist/blog/index.html", "dist")).toBe("/blog/");
  });

  it("maps dist/blog/post/index.html to /blog/post/", () => {
    expect(htmlPathToUrlPath("dist/blog/post/index.html", "dist")).toBe("/blog/post/");
  });

  it("maps dist/about.html to /about", () => {
    expect(htmlPathToUrlPath("dist/about.html", "dist")).toBe("/about");
  });
});

describe("isNoindex", () => {
  it("returns true for noindex meta", () => {
    expect(
      isNoindex(`<html><head><meta name="robots" content="noindex,follow"></head></html>`),
    ).toBe(true);
  });

  it("handles content-then-name attribute order", () => {
    expect(
      isNoindex(`<html><head><meta content="noindex" name="robots"></head></html>`),
    ).toBe(true);
  });

  it("returns false when robots meta is index", () => {
    expect(
      isNoindex(`<html><head><meta name="robots" content="index,follow"></head></html>`),
    ).toBe(false);
  });

  it("returns false when robots meta is missing", () => {
    expect(isNoindex(`<html><head><title>Hi</title></head></html>`)).toBe(false);
  });
});

describe("extractTitle and extractDescription", () => {
  it("extracts title content", () => {
    expect(extractTitle(`<title>  Hello  </title>`)).toBe("Hello");
  });

  it("returns empty string when title is missing", () => {
    expect(extractTitle(`<head></head>`)).toBe("");
  });

  it("extracts description content", () => {
    expect(
      extractDescription(`<meta name="description" content="A description">`),
    ).toBe("A description");
  });
});

describe("hasJsonLd", () => {
  it("detects JSON-LD script tag", () => {
    expect(
      hasJsonLd(`<script type="application/ld+json">{"@type":"WebPage"}</script>`),
    ).toBe(true);
  });

  it("returns false when no JSON-LD is present", () => {
    expect(hasJsonLd(`<script>console.log("hi")</script>`)).toBe(false);
  });
});

describe("resolveDistDir", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns dist/client when it exists (Workers Static Assets adapter)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "seo-audit-"));
    mkdirSync(join(tmpDir, "client"), { recursive: true });
    expect(resolveDistDir(tmpDir)).toBe(join(tmpDir, "client"));
  });

  it("returns the base dir when no client subdirectory exists", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "seo-audit-"));
    expect(resolveDistDir(tmpDir)).toBe(tmpDir);
  });
});

describe("runAudit with a client subdirectory", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds sitemap.xml and robots.txt under dist/client, not dist/", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "seo-audit-"));
    const clientDir = join(tmpDir, "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(
      join(clientDir, "index.html"),
      "<html><head><title>Home</title><meta name=\"description\" content=\"Home page\"></head></html>",
    );
    writeFileSync(join(clientDir, "sitemap-index.xml"), "<urlset></urlset>");
    writeFileSync(join(clientDir, "robots.txt"), "User-agent: *\nAllow: /\n");

    const report = runAudit({ distDir: tmpDir, siteUrl: "https://example.com" });

    expect(report.issues.some((i) => i.code === "missing-sitemap")).toBe(false);
    expect(report.issues.some((i) => i.code === "missing-robots")).toBe(false);
    expect(report.pagesAudited).toBe(1);
  });

  it("computes page paths relative to dist/client, without a leading client/ segment", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "seo-audit-"));
    const aboutDir = join(tmpDir, "client", "about");
    mkdirSync(aboutDir, { recursive: true });
    // No <title> — triggers a missing-title issue whose `page` field is the
    // computed urlPath, so a `client/` prefix leaking through would show up here.
    writeFileSync(join(aboutDir, "index.html"), "<html><head></head></html>");

    const report = runAudit({ distDir: tmpDir });
    const missingTitle = report.issues.find((i) => i.code === "missing-title");

    expect(missingTitle?.page).toBe("/about/");
  });

  it("reports the resolved client dir path, not the base dir, when files are missing", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "seo-audit-"));
    mkdirSync(join(tmpDir, "client"), { recursive: true });
    writeFileSync(join(tmpDir, "client", "index.html"), "<html><head></head></html>");

    const report = runAudit({ distDir: tmpDir });
    const sitemapIssue = report.issues.find((i) => i.code === "missing-sitemap");
    const robotsIssue = report.issues.find((i) => i.code === "missing-robots");

    expect(sitemapIssue?.message).toContain(join(tmpDir, "client"));
    expect(robotsIssue?.message).toContain(join(tmpDir, "client"));
  });
});

describe("exitCodeFor", () => {
  const base: SeoAuditReport = {
    issues: [],
    totals: { critical: 0, warning: 0, niceToHave: 0 },
    pagesAudited: 0,
    pagesSkipped: 0,
  };

  it("returns 0 when there are no critical issues", () => {
    expect(exitCodeFor({ ...base, totals: { critical: 0, warning: 5, niceToHave: 2 } }, false)).toBe(0);
  });

  it("returns 1 when there is at least one critical issue", () => {
    expect(exitCodeFor({ ...base, totals: { critical: 1, warning: 0, niceToHave: 0 } }, false)).toBe(1);
  });

  it("returns 0 in warn-only mode regardless of critical count", () => {
    expect(exitCodeFor({ ...base, totals: { critical: 9, warning: 0, niceToHave: 0 } }, true)).toBe(0);
  });
});
