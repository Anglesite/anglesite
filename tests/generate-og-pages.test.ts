import { describe, it, expect, vi } from "vitest";

vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("satori", () => ({ default: vi.fn() }));
vi.mock("@resvg/resvg-js", () => ({
  Resvg: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockReturnValue({ asPng: () => new Uint8Array() }),
  })),
}));

import {
  slugToOgPath,
  needsOgImage,
  parsePageFrontmatter,
} from "../template/scripts/generate-og-pages.js";

// ---------------------------------------------------------------------------
// slugToOgPath — map a page slug to its OG image output path
// ---------------------------------------------------------------------------

describe("slugToOgPath", () => {
  it("maps root index to og-image.png", () => {
    expect(slugToOgPath("")).toBe("images/og/index.png");
  });

  it("maps a simple slug", () => {
    expect(slugToOgPath("about")).toBe("images/og/about.png");
  });

  it("maps a nested slug", () => {
    expect(slugToOgPath("blog/my-first-post")).toBe(
      "images/og/blog/my-first-post.png",
    );
  });

  it("strips leading slashes", () => {
    expect(slugToOgPath("/services")).toBe("images/og/services.png");
  });

  it("strips trailing slashes", () => {
    expect(slugToOgPath("services/")).toBe("images/og/services.png");
  });
});

// ---------------------------------------------------------------------------
// needsOgImage — decide whether a page needs a generated OG image
// ---------------------------------------------------------------------------

describe("needsOgImage", () => {
  it("returns true when no image is set", () => {
    expect(needsOgImage({ title: "About", slug: "about" })).toBe(true);
  });

  it("returns false when a custom image is set", () => {
    expect(
      needsOgImage({
        title: "Post",
        slug: "blog/post",
        image: "/images/blog/photo.webp",
      }),
    ).toBe(false);
  });

  it("returns true when image is empty string", () => {
    expect(needsOgImage({ title: "Post", slug: "blog/post", image: "" })).toBe(
      true,
    );
  });

  it("returns false for draft pages", () => {
    expect(
      needsOgImage({ title: "Draft", slug: "blog/draft", draft: true }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parsePageFrontmatter — extract title and image from Astro/MDX frontmatter
// ---------------------------------------------------------------------------

describe("parsePageFrontmatter", () => {
  it("extracts title from YAML frontmatter", () => {
    const content = `---
title: About Us
description: Learn about our company
---

# About Us`;
    expect(parsePageFrontmatter(content)).toEqual(
      expect.objectContaining({ title: "About Us" }),
    );
  });

  it("extracts image when present", () => {
    const content = `---
title: My Post
image: /images/blog/hero.webp
---`;
    expect(parsePageFrontmatter(content)).toEqual(
      expect.objectContaining({ image: "/images/blog/hero.webp" }),
    );
  });

  it("returns undefined image when not present", () => {
    const content = `---
title: Plain Page
---`;
    expect(parsePageFrontmatter(content)?.image).toBeUndefined();
  });

  it("returns undefined for content without frontmatter", () => {
    expect(parsePageFrontmatter("# Just a heading")).toBeUndefined();
  });

  it("handles draft field", () => {
    const content = `---
title: Draft Post
draft: true
---`;
    expect(parsePageFrontmatter(content)?.draft).toBe(true);
  });
});
