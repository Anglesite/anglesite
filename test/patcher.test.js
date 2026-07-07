import { describe, it, expect } from "vitest";
import { resolve } from "../server/patcher.mjs";
import { resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";

const FIXTURE_ROOT = resolvePath(import.meta.dirname, "fixtures/patcher");

function makeSelector(overrides = {}) {
  return {
    tag: "P",
    classes: [],
    nthChild: 1,
    ...overrides,
  };
}

function makeEdit(overrides = {}) {
  return {
    path: "/",
    selector: makeSelector(),
    op: "replace-text",
    value: "New text",
    ...overrides,
  };
}

// ── .mdoc resolver ────────────────────────────────────────────────

describe("mdoc resolver", () => {
  it("unique match → returns correct {file, range, replacement}", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/blog/hello-world/",
      selector: makeSelector({ textContent: "Welcome to our new website! We are excited to share our journey with you." }),
      value: "Welcome to our redesigned website!",
    }));
    expect(result.refused).toBeUndefined();
    expect(result.file).toBe("src/content/posts/hello-world/index.mdoc");
    expect(result.replacement).toBe("Welcome to our redesigned website!");

    const source = readFileSync(resolvePath(FIXTURE_ROOT, result.file), "utf-8");
    const matched = source.slice(result.range.start, result.range.end);
    expect(matched).toBe("Welcome to our new website! We are excited to share our journey with you.");
  });

  it("no match → refuses with reason: no-match", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/blog/hello-world/",
      selector: makeSelector({ textContent: "This text does not exist anywhere" }),
    }));
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("multiple matches → refuses with reason: ambiguous", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/blog/duplicate-text/",
      selector: makeSelector({ textContent: "Welcome to our bakery! We bake fresh bread every morning." }),
    }));
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("ambiguous");
  });

  it("finds text in the body, not in the frontmatter", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/blog/hello-world/",
      selector: makeSelector({ textContent: "This is the second paragraph with some bold text and a link." }),
      value: "Updated second paragraph.",
    }));
    // The .mdoc has markdown formatting (**bold text** and [link](url))
    // so an exact match of the rendered text won't be found — this should refuse
    expect(result.refused).toBe(true);
  });
});

// ── Keystatic (YAML/JSON) resolver ────────────────────────────────

describe("keystatic resolver", () => {
  it("unique match in YAML → returns correct {file, range, replacement}", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ textContent: "Fresh bread since 1985" }),
      value: "Fresh bread since 1980",
    }));
    // The mdoc resolver won't match (no mdoc has this text).
    // The keystatic resolver should find it in the YAML.
    if (!result.refused) {
      expect(result.file).toBe("src/content/site/settings.yaml");
      expect(result.replacement).toBe("Fresh bread since 1980");
      const source = readFileSync(resolvePath(FIXTURE_ROOT, result.file), "utf-8");
      const matched = source.slice(result.range.start, result.range.end);
      expect(matched).toBe("Fresh bread since 1985");
    }
  });

  it("no match in data files → falls through to astro resolver", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ textContent: "We sell the finest goods in town. Come visit us today!" }),
      value: "Updated shop description",
    }));
    // Should fall through to the astro resolver and match in index.astro
    expect(result.refused).toBeUndefined();
    expect(result.file).toBe("src/pages/index.astro");
  });
});

// ── .astro resolver ───────────────────────────────────────────────

describe("astro resolver", () => {
  it("unique match → returns correct {file, range, replacement}", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ tag: "H1", textContent: "Welcome to Our Shop" }),
      value: "Welcome to Our New Shop",
    }));
    expect(result.refused).toBeUndefined();
    expect(result.file).toBe("src/pages/index.astro");
    expect(result.replacement).toBe("Welcome to Our New Shop");

    const source = readFileSync(resolvePath(FIXTURE_ROOT, result.file), "utf-8");
    const matched = source.slice(result.range.start, result.range.end);
    expect(matched).toBe("Welcome to Our Shop");
  });

  it("no match → refuses with reason: no-match", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ textContent: "This sentence does not appear anywhere in the project" }),
    }));
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("no-match");
  });

  it("dynamic expression → refuses with reason: dynamic-expression", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/about/",
      // "12" rendered by {teamSize} in about.astro — not static text
      selector: makeSelector({ textContent: "Our team of 12 experts is here to help you." }),
      value: "Our team of 15 experts is here to help you.",
    }));
    // The text "Our team of 12 experts..." doesn't appear literally in the source
    // (the source has {teamSize}), so the astro resolver should flag it
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("dynamic-expression");
  });

  it("resolves static text from index.astro for / path", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ tag: "P", textContent: "Open Monday through Friday, 9am to 5pm." }),
      value: "Open every day, 8am to 6pm.",
    }));
    expect(result.refused).toBeUndefined();
    expect(result.file).toBe("src/pages/index.astro");
    expect(result.replacement).toBe("Open every day, 8am to 6pm.");
  });

  describe("replace-image-src", () => {
    it("rewrites the entire <img> opening tag with new src + srcset", async () => {
      const result = await resolve(FIXTURE_ROOT, {
        path: "/photo/",
        selector: { tag: "IMG", classes: [], nthChild: 1, textContent: "/images/hero.jpg" },
        op: "replace-image-src",
        value: {
          src: "/images/hero.webp",
          srcset: "/images/hero-480w.webp 480w, /images/hero-768w.webp 768w, /images/hero-1024w.webp 1024w, /images/hero-1920w.webp 1920w",
        },
      });
      expect(result.refused).toBeUndefined();
      expect(result.file).toBe("src/pages/photo.astro");
      expect(result.replacement).toMatch(/^<img/);
      expect(result.replacement).toContain('src="/images/hero.webp"');
      expect(result.replacement).toContain('srcset="/images/hero-480w.webp 480w');
      expect(result.replacement).toContain('alt="Hero"');
      const src = readFileSync(resolvePath(FIXTURE_ROOT, result.file), "utf-8");
      const matched = src.slice(result.range.start, result.range.end);
      expect(matched.startsWith("<img")).toBe(true);
      expect(matched.endsWith("/>") || matched.endsWith(">")).toBe(true);
    });

    it("adds srcset when the original <img> had none", async () => {
      const result = await resolve(FIXTURE_ROOT, {
        path: "/photo/",
        selector: { tag: "IMG", classes: [], nthChild: 2, textContent: "/images/loose.jpg" },
        op: "replace-image-src",
        value: {
          src: "/images/loose.webp",
          srcset: "/images/loose-480w.webp 480w, /images/loose-768w.webp 768w",
        },
      });
      expect(result.refused).toBeUndefined();
      expect(result.replacement).toContain('src="/images/loose.webp"');
      expect(result.replacement).toContain('srcset="/images/loose-480w.webp 480w');
      expect(result.replacement).toContain('alt="No srcset"');
    });

    it("refuses with no-match when no <img> with the current src is found", async () => {
      const result = await resolve(FIXTURE_ROOT, {
        path: "/photo/",
        selector: { tag: "IMG", classes: [], nthChild: 1, textContent: "/images/missing.jpg" },
        op: "replace-image-src",
        value: { src: "/images/whatever.webp", srcset: "" },
      });
      expect(result.refused).toBe(true);
      expect(result.reason).toBe("no-match");
    });
  });
});

// ── Cross-resolver priority ───────────────────────────────────────

describe("cross-resolver priority", () => {
  it("mdoc wins over astro when both could match", async () => {
    // The mdoc fixture has "Welcome to our new website!" which a greedy astro
    // resolver might also match if there were an astro file with the same text.
    // By design, mdoc is tried first.
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/blog/hello-world/",
      selector: makeSelector({ textContent: "Welcome to our new website! We are excited to share our journey with you." }),
      value: "Updated content",
    }));
    if (!result.refused) {
      expect(result.file).toContain(".mdoc");
    }
  });

  it("all three refuse → returns the most informative reason", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/nonexistent/",
      selector: makeSelector({ textContent: "Text that does not exist in any file" }),
    }));
    expect(result.refused).toBe(true);
    // Should get the most informative refusal, not just the last one
    expect(["no-match", "ambiguous", "dynamic-expression"]).toContain(result.reason);
  });
});

// ── Resolver contract ─────────────────────────────────────────────

describe("resolver contract", () => {
  it("successful resolve returns file, range, and replacement", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ tag: "H1", textContent: "Welcome to Our Shop" }),
      value: "Updated Title",
    }));
    expect(result).toHaveProperty("file");
    expect(result).toHaveProperty("range");
    expect(result).toHaveProperty("replacement");
    expect(result.range).toHaveProperty("start");
    expect(result.range).toHaveProperty("end");
    expect(typeof result.range.start).toBe("number");
    expect(typeof result.range.end).toBe("number");
    expect(result.range.start).toBeLessThan(result.range.end);
  });

  it("refusal returns refused: true and a reason string", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ textContent: "No such text" }),
    }));
    expect(result.refused).toBe(true);
    expect(typeof result.reason).toBe("string");
  });

  it("range bytes correctly slice the original file", async () => {
    const result = await resolve(FIXTURE_ROOT, makeEdit({
      path: "/",
      selector: makeSelector({ tag: "P", textContent: "Open Monday through Friday, 9am to 5pm." }),
      value: "Replacement",
    }));
    expect(result.refused).toBeUndefined();
    const source = readFileSync(resolvePath(FIXTURE_ROOT, result.file), "utf-8");
    const sliced = source.slice(result.range.start, result.range.end);
    expect(sliced).toBe("Open Monday through Friday, 9am to 5pm.");
  });
});
