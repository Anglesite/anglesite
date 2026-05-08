import { describe, it, expect } from "vitest";
import {
  htmlPathToUrlPath,
  isNoindex,
  extractTitle,
  extractDescription,
  hasJsonLd,
  exitCodeFor,
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
