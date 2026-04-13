import { describe, it, expect } from "vitest";
import { parseStatus, commitMessage, userSummary } from "../template/scripts/backup-summary.js";

// ---------------------------------------------------------------------------
// parseStatus — categorizes git status --porcelain lines
// ---------------------------------------------------------------------------

describe("parseStatus", () => {
  it("detects new blog posts", () => {
    const lines = [
      "?? src/content/posts/my-first-post.mdx",
      "?? src/content/posts/summer-update.mdx",
    ];
    const result = parseStatus(lines);
    expect(result.added.posts).toBe(2);
  });

  it("detects modified pages", () => {
    const lines = [" M src/pages/about.astro", " M src/pages/contact.astro"];
    const result = parseStatus(lines);
    expect(result.modified.pages).toEqual(["about", "contact"]);
  });

  it("detects new pages", () => {
    const lines = ["?? src/pages/services.astro"];
    const result = parseStatus(lines);
    expect(result.added.pages).toEqual(["services"]);
  });

  it("detects modified styles", () => {
    const lines = [" M src/styles/global.css"];
    const result = parseStatus(lines);
    expect(result.modified.styles).toBe(true);
  });

  it("detects modified layout", () => {
    const lines = [" M src/layouts/BaseLayout.astro"];
    const result = parseStatus(lines);
    expect(result.modified.layout).toBe(true);
  });

  it("detects deleted files", () => {
    const lines = [" D src/pages/old-page.astro"];
    const result = parseStatus(lines);
    expect(result.deleted).toEqual(["old-page.astro"]);
  });

  it("detects content collection changes", () => {
    const lines = [
      "?? src/content/services/haircut.mdx",
      "?? src/content/team/jane.mdx",
      " M src/content/faq/hours.mdx",
    ];
    const result = parseStatus(lines);
    expect(result.added.collections.services).toBe(1);
    expect(result.added.collections.team).toBe(1);
    expect(result.modified.collections.faq).toBe(1);
  });

  it("tracks config changes", () => {
    const lines = [" M .site-config", " M astro.config.ts"];
    const result = parseStatus(lines);
    expect(result.modified.config).toBe(true);
  });

  it("counts other files", () => {
    const lines = [" M public/robots.txt", "?? public/favicon.svg"];
    const result = parseStatus(lines);
    expect(result.other).toBe(2);
  });

  it("returns empty result for no changes", () => {
    const result = parseStatus([]);
    expect(result.added.posts).toBe(0);
    expect(result.added.pages).toEqual([]);
    expect(result.modified.pages).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.other).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// commitMessage — generates a descriptive git commit message
// ---------------------------------------------------------------------------

describe("commitMessage", () => {
  it("describes new blog posts", () => {
    const lines = [
      "?? src/content/posts/hello-world.mdx",
      "?? src/content/posts/second-post.mdx",
    ];
    const msg = commitMessage(parseStatus(lines));
    expect(msg).toContain("2 blog post");
  });

  it("describes modified pages", () => {
    const lines = [" M src/pages/about.astro"];
    const msg = commitMessage(parseStatus(lines));
    expect(msg.toLowerCase()).toContain("about");
  });

  it("describes mixed changes", () => {
    const lines = [
      "?? src/content/posts/new-post.mdx",
      " M src/pages/about.astro",
      " M src/styles/global.css",
    ];
    const msg = commitMessage(parseStatus(lines));
    expect(msg.length).toBeGreaterThan(5);
  });

  it("falls back for only other files", () => {
    const lines = [" M public/robots.txt"];
    const msg = commitMessage(parseStatus(lines));
    expect(msg.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// userSummary — plain-language summary for the owner
// ---------------------------------------------------------------------------

describe("userSummary", () => {
  it("describes new posts in plain language", () => {
    const lines = ["?? src/content/posts/my-post.mdx"];
    const summary = userSummary(parseStatus(lines));
    expect(summary.toLowerCase()).toContain("blog post");
  });

  it("mentions page updates", () => {
    const lines = [" M src/pages/about.astro"];
    const summary = userSummary(parseStatus(lines));
    expect(summary.toLowerCase()).toContain("about");
  });

  it("mentions style changes", () => {
    const lines = [" M src/styles/global.css"];
    const summary = userSummary(parseStatus(lines));
    expect(summary.toLowerCase()).toContain("style");
  });

  it("mentions deleted files", () => {
    const lines = [" D src/pages/old.astro"];
    const summary = userSummary(parseStatus(lines));
    expect(summary.toLowerCase()).toContain("removed");
  });

  it("returns a message for no changes", () => {
    const summary = userSummary(parseStatus([]));
    expect(summary.toLowerCase()).toContain("no changes");
  });

  it("mentions collection items", () => {
    const lines = [
      "?? src/content/services/haircut.mdx",
      "?? src/content/services/color.mdx",
    ];
    const summary = userSummary(parseStatus(lines));
    expect(summary.toLowerCase()).toContain("service");
  });
});
