import { describe, it, expect } from "vitest";
import {
  formatInstagram,
  formatFacebook,
  formatGoogleBusiness,
  formatNextdoor,
  formatShortPost,
  formatAll,
  type PostInput,
} from "../template/scripts/syndication-formats.js";

const samplePost: PostInput = {
  title: "Spring Menu Update",
  description: "We've added five new seasonal dishes featuring local ingredients.",
  url: "https://example.com/blog/spring-menu-update",
  tags: ["seasonal", "local food", "new menu"],
};

const longPost: PostInput = {
  title: "A".repeat(100),
  description: "B".repeat(2000),
  url: "https://example.com/blog/long-post",
  tags: Array.from({ length: 30 }, (_, i) => `tag${i}`),
};

// ---------------------------------------------------------------------------
// formatInstagram
// ---------------------------------------------------------------------------

describe("formatInstagram", () => {
  it("includes the post title", () => {
    const result = formatInstagram(samplePost);
    expect(result).toContain("Spring Menu Update");
  });

  it("generates hashtags from tags", () => {
    const result = formatInstagram(samplePost);
    expect(result).toContain("#seasonal");
    expect(result).toContain("#localfood");
    expect(result).toContain("#newmenu");
  });

  it("does not include a URL (Instagram captions don't support links)", () => {
    const result = formatInstagram(samplePost);
    expect(result).not.toContain("https://");
  });

  it("stays under 2200 characters", () => {
    const result = formatInstagram(longPost);
    expect(result.length).toBeLessThanOrEqual(2200);
  });

  it("returns non-empty output", () => {
    expect(formatInstagram(samplePost).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatFacebook
// ---------------------------------------------------------------------------

describe("formatFacebook", () => {
  it("includes the post URL", () => {
    const result = formatFacebook(samplePost);
    expect(result).toContain(samplePost.url);
  });

  it("includes the post title", () => {
    const result = formatFacebook(samplePost);
    expect(result).toContain("Spring Menu Update");
  });

  it("stays under 500 characters for best engagement", () => {
    const result = formatFacebook(samplePost);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it("returns non-empty output", () => {
    expect(formatFacebook(samplePost).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatGoogleBusiness
// ---------------------------------------------------------------------------

describe("formatGoogleBusiness", () => {
  it("includes the post URL", () => {
    const result = formatGoogleBusiness(samplePost);
    expect(result).toContain(samplePost.url);
  });

  it("stays under 1500 characters", () => {
    const result = formatGoogleBusiness(longPost);
    expect(result.length).toBeLessThanOrEqual(1500);
  });

  it("returns non-empty output", () => {
    expect(formatGoogleBusiness(samplePost).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatNextdoor
// ---------------------------------------------------------------------------

describe("formatNextdoor", () => {
  it("includes the post URL", () => {
    const result = formatNextdoor(samplePost);
    expect(result).toContain(samplePost.url);
  });

  it("includes the post title", () => {
    const result = formatNextdoor(samplePost);
    expect(result).toContain("Spring Menu Update");
  });

  it("returns non-empty output", () => {
    expect(formatNextdoor(samplePost).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatShortPost (X / Bluesky)
// ---------------------------------------------------------------------------

describe("formatShortPost", () => {
  it("includes the post URL", () => {
    const result = formatShortPost(samplePost, 280);
    expect(result).toContain(samplePost.url);
  });

  it("stays under the specified character limit", () => {
    const result = formatShortPost(samplePost, 280);
    expect(result.length).toBeLessThanOrEqual(280);
  });

  it("works with Bluesky 300 char limit", () => {
    const result = formatShortPost(samplePost, 300);
    expect(result.length).toBeLessThanOrEqual(300);
  });

  it("truncates long titles to fit", () => {
    const result = formatShortPost(longPost, 280);
    expect(result.length).toBeLessThanOrEqual(280);
  });

  it("returns non-empty output", () => {
    expect(formatShortPost(samplePost, 280).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatAll
// ---------------------------------------------------------------------------

describe("formatAll", () => {
  it("returns all platform formats", () => {
    const result = formatAll(samplePost);
    expect(result.instagram).toBeDefined();
    expect(result.facebook).toBeDefined();
    expect(result.googleBusiness).toBeDefined();
    expect(result.nextdoor).toBeDefined();
    expect(result.x).toBeDefined();
    expect(result.bluesky).toBeDefined();
  });

  it("all formats are non-empty strings", () => {
    const result = formatAll(samplePost);
    for (const [, value] of Object.entries(result)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
