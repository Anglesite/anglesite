import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractLinks,
  isInternalLink,
  isExternalLink,
  normalizeInternalHref,
  resolveInternalLink,
  parseRedirects,
  findRedirectChains,
  findOrphanedPages,
  extractSitemapUrls,
  parseAllowlist,
  isAllowlisted,
  checkLinks,
  formatReport,
} from "../template/scripts/link-check.js";

// ---------------------------------------------------------------------------
// extractLinks
// ---------------------------------------------------------------------------

describe("extractLinks", () => {
  it("extracts href values from anchor tags", () => {
    const html = '<a href="/about">About</a><a href="/contact">Contact</a>';
    expect(extractLinks(html)).toEqual(["/about", "/contact"]);
  });

  it("handles single and double quotes", () => {
    const html = `<a href="/one">1</a><a href='/two'>2</a>`;
    expect(extractLinks(html)).toEqual(["/one", "/two"]);
  });

  it("extracts href from link tags", () => {
    const html = '<link href="/styles.css" rel="stylesheet">';
    expect(extractLinks(html)).toEqual(["/styles.css"]);
  });

  it("returns empty array for no links", () => {
    expect(extractLinks("<p>No links here</p>")).toEqual([]);
  });

  it("skips empty href values", () => {
    const html = '<a href="">empty</a><a href="/real">real</a>';
    expect(extractLinks(html)).toEqual(["/real"]);
  });
});

// ---------------------------------------------------------------------------
// isInternalLink / isExternalLink
// ---------------------------------------------------------------------------

describe("isInternalLink", () => {
  it("returns true for absolute paths", () => {
    expect(isInternalLink("/about")).toBe(true);
  });

  it("returns true for relative paths", () => {
    expect(isInternalLink("../contact")).toBe(true);
  });

  it("returns false for http URLs", () => {
    expect(isInternalLink("http://example.com")).toBe(false);
  });

  it("returns false for https URLs", () => {
    expect(isInternalLink("https://example.com")).toBe(false);
  });

  it("returns false for protocol-relative URLs", () => {
    expect(isInternalLink("//example.com/path")).toBe(false);
  });

  it("returns false for mailto links", () => {
    expect(isInternalLink("mailto:info@example.com")).toBe(false);
  });

  it("returns false for tel links", () => {
    expect(isInternalLink("tel:+15551234567")).toBe(false);
  });

  it("returns false for fragment-only links", () => {
    expect(isInternalLink("#section")).toBe(false);
  });

  it("returns false for javascript: links", () => {
    expect(isInternalLink("javascript:void(0)")).toBe(false);
  });

  it("returns false for data: URIs", () => {
    expect(isInternalLink("data:text/html,<h1>hi</h1>")).toBe(false);
  });
});

describe("isExternalLink", () => {
  it("returns true for http URLs", () => {
    expect(isExternalLink("http://example.com")).toBe(true);
  });

  it("returns true for https URLs", () => {
    expect(isExternalLink("https://example.com")).toBe(true);
  });

  it("returns true for protocol-relative URLs", () => {
    expect(isExternalLink("//cdn.example.com/script.js")).toBe(true);
  });

  it("returns false for absolute paths", () => {
    expect(isExternalLink("/about")).toBe(false);
  });

  it("returns false for relative paths", () => {
    expect(isExternalLink("../page")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeInternalHref
// ---------------------------------------------------------------------------

describe("normalizeInternalHref", () => {
  it("returns absolute paths unchanged", () => {
    expect(normalizeInternalHref("/about", "/tmp/dist/index.html", "/tmp/dist")).toBe("/about");
  });

  it("strips hash fragments", () => {
    expect(normalizeInternalHref("/about#section", "/tmp/dist/index.html", "/tmp/dist")).toBe("/about");
  });

  it("strips query parameters", () => {
    expect(normalizeInternalHref("/search?q=test", "/tmp/dist/index.html", "/tmp/dist")).toBe("/search");
  });

  it("returns empty string for fragment-only href after stripping", () => {
    expect(normalizeInternalHref("#top", "/tmp/dist/index.html", "/tmp/dist")).toBe("");
  });

  it("resolves relative paths against the source directory", () => {
    const result = normalizeInternalHref("../about", "/tmp/dist/blog/post.html", "/tmp/dist");
    expect(result).toBe("/about");
  });
});

// ---------------------------------------------------------------------------
// resolveInternalLink
// ---------------------------------------------------------------------------

describe("resolveInternalLink", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-linkcheck-"));
    mkdirSync(join(tmpDir, "about"), { recursive: true });
    writeFileSync(join(tmpDir, "index.html"), "<html></html>");
    writeFileSync(join(tmpDir, "about", "index.html"), "<html></html>");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves root index", () => {
    expect(resolveInternalLink("/", tmpDir)).toBe(true);
  });

  it("resolves directory with index.html", () => {
    expect(resolveInternalLink("/about", tmpDir)).toBe(true);
  });

  it("resolves directory with trailing slash", () => {
    expect(resolveInternalLink("/about/", tmpDir)).toBe(true);
  });

  it("returns false for non-existent path", () => {
    expect(resolveInternalLink("/nonexistent", tmpDir)).toBe(false);
  });

  it("returns true for empty normalized href", () => {
    expect(resolveInternalLink("", tmpDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseRedirects
// ---------------------------------------------------------------------------

describe("parseRedirects", () => {
  it("parses source destination pairs", () => {
    const result = parseRedirects("/old /new 301");
    expect(result).toEqual([{ source: "/old", destination: "/new", status: 301 }]);
  });

  it("defaults to 301 status", () => {
    const result = parseRedirects("/old /new");
    expect(result).toEqual([{ source: "/old", destination: "/new", status: 301 }]);
  });

  it("skips comments and blank lines", () => {
    const content = "# comment\n\n/old /new 302\n";
    const result = parseRedirects(content);
    expect(result).toEqual([{ source: "/old", destination: "/new", status: 302 }]);
  });

  it("handles multiple redirects", () => {
    const content = "/a /b 301\n/c /d 302";
    const result = parseRedirects(content);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findRedirectChains
// ---------------------------------------------------------------------------

describe("findRedirectChains", () => {
  it("detects a 2-hop chain (3 entries)", () => {
    const redirects = [
      { source: "/a", destination: "/b", status: 301 },
      { source: "/b", destination: "/c", status: 301 },
      { source: "/c", destination: "/d", status: 301 },
    ];
    const issues = findRedirectChains(redirects);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe("redirect-chain");
  });

  it("does not flag single-hop redirects", () => {
    const redirects = [
      { source: "/old", destination: "/new", status: 301 },
    ];
    const issues = findRedirectChains(redirects);
    expect(issues).toEqual([]);
  });

  it("does not flag two independent redirects", () => {
    const redirects = [
      { source: "/a", destination: "/x", status: 301 },
      { source: "/b", destination: "/y", status: 301 },
    ];
    const issues = findRedirectChains(redirects);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findOrphanedPages
// ---------------------------------------------------------------------------

describe("findOrphanedPages", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-orphan-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects orphaned pages with no inbound links", () => {
    const pages = [
      join(tmpDir, "index.html"),
      join(tmpDir, "about/index.html"),
      join(tmpDir, "orphan/index.html"),
    ];
    const inbound = new Map<string, Set<string>>();
    inbound.set("/about/", new Set(["/"]) );

    const issues = findOrphanedPages(tmpDir, pages, inbound, []);
    expect(issues.some((i) => i.source.includes("orphan"))).toBe(true);
  });

  it("skips the homepage", () => {
    const pages = [join(tmpDir, "index.html")];
    const issues = findOrphanedPages(tmpDir, pages, new Map(), []);
    expect(issues).toEqual([]);
  });

  it("skips 404 pages", () => {
    const pages = [join(tmpDir, "index.html"), join(tmpDir, "404.html")];
    const issues = findOrphanedPages(tmpDir, pages, new Map(), []);
    expect(issues).toEqual([]);
  });

  it("does not flag pages with inbound links", () => {
    const pages = [
      join(tmpDir, "index.html"),
      join(tmpDir, "about/index.html"),
    ];
    const inbound = new Map<string, Set<string>>();
    inbound.set("/about/", new Set(["/"]));

    const issues = findOrphanedPages(tmpDir, pages, inbound, []);
    expect(issues).toEqual([]);
  });

  it("does not flag pages in the sitemap", () => {
    const pages = [
      join(tmpDir, "index.html"),
      join(tmpDir, "hidden/index.html"),
    ];
    const issues = findOrphanedPages(tmpDir, pages, new Map(), ["/hidden/"]);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractSitemapUrls
// ---------------------------------------------------------------------------

describe("extractSitemapUrls", () => {
  it("extracts paths from sitemap XML", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/about</loc></url>
        <url><loc>https://example.com/blog/</loc></url>
      </urlset>`;
    const result = extractSitemapUrls(xml);
    expect(result).toEqual(["/about", "/blog/"]);
  });

  it("returns empty array for empty XML", () => {
    expect(extractSitemapUrls("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

describe("parseAllowlist", () => {
  it("splits comma-separated values", () => {
    expect(parseAllowlist("example.com,test.org")).toEqual(["example.com", "test.org"]);
  });

  it("trims whitespace", () => {
    expect(parseAllowlist(" example.com , test.org ")).toEqual(["example.com", "test.org"]);
  });

  it("returns empty array for undefined", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAllowlist("")).toEqual([]);
  });
});

describe("isAllowlisted", () => {
  it("matches substring patterns", () => {
    expect(isAllowlisted("https://example.com/page", ["example.com"])).toBe(true);
  });

  it("returns false for non-matching patterns", () => {
    expect(isAllowlisted("https://other.com/page", ["example.com"])).toBe(false);
  });

  it("supports wildcard patterns", () => {
    expect(isAllowlisted("https://cdn.example.com/script.js", ["https://cdn.example.com/*"])).toBe(true);
  });

  it("wildcard does not match without prefix", () => {
    expect(isAllowlisted("https://other.com/page", ["https://example.com/*"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkLinks (integration)
// ---------------------------------------------------------------------------

describe("checkLinks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-checklinks-"));
    mkdirSync(join(tmpDir, "about"), { recursive: true });
    mkdirSync(join(tmpDir, "blog"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds broken internal links", async () => {
    writeFileSync(
      join(tmpDir, "index.html"),
      '<html><body><a href="/about">About</a><a href="/nonexistent">Broken</a></body></html>',
    );
    writeFileSync(join(tmpDir, "about", "index.html"), "<html><body>About page</body></html>");

    const result = await checkLinks(tmpDir);
    expect(result.stats.brokenInternal).toBe(1);
    expect(result.issues[0].target).toBe("/nonexistent");
  });

  it("reports no issues for valid internal links", async () => {
    writeFileSync(
      join(tmpDir, "index.html"),
      '<html><body><a href="/about">About</a><a href="/blog">Blog</a></body></html>',
    );
    writeFileSync(join(tmpDir, "about", "index.html"), '<html><body><a href="/">Home</a></body></html>');
    writeFileSync(join(tmpDir, "blog", "index.html"), '<html><body><a href="/">Home</a></body></html>');

    const result = await checkLinks(tmpDir);
    expect(result.stats.brokenInternal).toBe(0);
  });

  it("detects orphaned pages", async () => {
    writeFileSync(
      join(tmpDir, "index.html"),
      '<html><body><a href="/about">About</a></body></html>',
    );
    writeFileSync(join(tmpDir, "about", "index.html"), '<html><body><a href="/">Home</a></body></html>');
    writeFileSync(join(tmpDir, "blog", "index.html"), "<html><body>Orphan</body></html>");

    const result = await checkLinks(tmpDir);
    expect(result.stats.orphanedPages).toBe(1);
    expect(result.issues.some((i) => i.type === "orphaned-page" && i.source.includes("blog"))).toBe(true);
  });

  it("respects allowlist for internal links", async () => {
    writeFileSync(
      join(tmpDir, "index.html"),
      '<html><body><a href="/nonexistent">Broken</a></body></html>',
    );

    const result = await checkLinks(tmpDir, { allowlist: ["/nonexistent"] });
    expect(result.stats.brokenInternal).toBe(0);
  });

  it("counts pages scanned correctly", async () => {
    writeFileSync(join(tmpDir, "index.html"), "<html></html>");
    writeFileSync(join(tmpDir, "about", "index.html"), "<html></html>");
    writeFileSync(join(tmpDir, "blog", "index.html"), "<html></html>");

    const result = await checkLinks(tmpDir);
    expect(result.stats.pagesScanned).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe("formatReport", () => {
  it("shows no-issues message when clean", () => {
    const report = formatReport({
      issues: [],
      stats: {
        pagesScanned: 5,
        internalLinksChecked: 10,
        externalLinksChecked: 0,
        brokenInternal: 0,
        brokenExternal: 0,
        orphanedPages: 0,
        redirectChains: 0,
      },
    });
    expect(report).toContain("No issues found");
    expect(report).toContain("5 pages scanned");
  });

  it("groups warnings and info separately", () => {
    const report = formatReport({
      issues: [
        {
          type: "broken-internal",
          severity: "warn",
          source: "/index.html",
          target: "/broken",
          detail: "Not found",
        },
        {
          type: "orphaned-page",
          severity: "info",
          source: "/orphan/index.html",
          target: "",
          detail: "No inbound link",
        },
      ],
      stats: {
        pagesScanned: 3,
        internalLinksChecked: 5,
        externalLinksChecked: 0,
        brokenInternal: 1,
        brokenExternal: 0,
        orphanedPages: 1,
        redirectChains: 0,
      },
    });
    expect(report).toContain("Warnings (1)");
    expect(report).toContain("Info (1)");
  });
});
