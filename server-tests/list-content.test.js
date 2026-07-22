import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listContent } from "../server/list-content.mjs";

let root;

function write(rel, content) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "list-content-"));
});
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

describe("listContent — pages", () => {
  it("derives routes from src/pages, including index → parent", () => {
    write("src/pages/index.astro", `<BaseLayout title="Home" description="x">hi</BaseLayout>`);
    write("src/pages/about.astro", `<BaseLayout title="About Us" description="x" />`);
    write("src/pages/blog/index.astro", `<h1>Blog</h1>`);
    write("src/pages/blog/archive.astro", `<h1>Archive</h1>`);

    const { pages } = listContent(root);
    const byRoute = Object.fromEntries(pages.map((p) => [p.route, p]));

    expect(Object.keys(byRoute).sort()).toEqual(["/", "/about", "/blog", "/blog/archive"]);
    expect(byRoute["/about"].filePath).toBe("src/pages/about.astro");
    expect(typeof byRoute["/about"].lastModified).toBe("string");
    expect(() => new Date(byRoute["/about"].lastModified).toISOString()).not.toThrow();
  });

  it("extracts a best-effort title from BaseLayout, else null", () => {
    write("src/pages/about.astro", `<BaseLayout title="About Us" description="x" />`);
    write("src/pages/raw.astro", `<h1>No layout title here</h1>`);

    const { pages } = listContent(root);
    const byRoute = Object.fromEntries(pages.map((p) => [p.route, p]));
    expect(byRoute["/about"].title).toBe("About Us");
    expect(byRoute["/raw"].title).toBeNull();
  });

  it("skips dynamic routes and non-page endpoint files", () => {
    write("src/pages/blog/[slug].astro", `dynamic`);
    write("src/pages/rss.xml.ts", `export const GET = () => {}`);
    write("src/pages/real.astro", `<BaseLayout title="Real" description="x" />`);

    const { pages } = listContent(root);
    expect(pages.map((p) => p.route)).toEqual(["/real"]);
  });
});

describe("listContent — posts", () => {
  it("reads article-like collections with frontmatter fields", () => {
    write(
      "src/content/posts/hello-world.md",
      `---\ntitle: Hello World\ndescription: A greeting\npublishDate: 2026-06-01\ndraft: false\ntags: [intro, news]\n---\nBody`,
    );
    write(
      "src/content/posts/wip.md",
      `---\ntitle: Work in Progress\ndescription: d\npublishDate: 2026-06-10\ndraft: true\ntags: []\n---\nBody`,
    );

    const { posts } = listContent(root);
    const bySlug = Object.fromEntries(posts.map((p) => [p.slug, p]));

    expect(bySlug["hello-world"].collection).toBe("posts");
    expect(bySlug["hello-world"].title).toBe("Hello World");
    expect(bySlug["hello-world"].draft).toBe(false);
    expect(bySlug["hello-world"].tags).toEqual(["intro", "news"]);
    expect(bySlug["hello-world"].publishDate).toMatch(/^2026-06-01/);
    expect(bySlug["hello-world"].filePath).toBe("src/content/posts/hello-world.md");
    expect(bySlug["wip"].draft).toBe(true);
    expect(bySlug["wip"].tags).toEqual([]);
  });

  it("uses an explicit frontmatter slug when present, else the filename", () => {
    write(
      "src/content/notes/2026-06-05-quick.md",
      `---\nslug: quick-note\npublishDate: 2026-06-05\ndraft: false\n---\njust a note`,
    );
    const { posts } = listContent(root);
    expect(posts).toHaveLength(1);
    expect(posts[0].slug).toBe("quick-note");
    expect(posts[0].collection).toBe("notes");
    // notes can be titleless — fall back to the slug so the graph's non-optional title is satisfied
    expect(posts[0].title).toBe("quick-note");
  });

  it("ignores non-article collections (gallery, team, …)", () => {
    write("src/content/gallery/photo.md", `---\nimage: /x.jpg\nalt: a\n---`);
    write("src/content/team/jane.md", `---\nname: Jane\n---`);
    write("src/content/posts/real.md", `---\ntitle: Real\ndescription: d\npublishDate: 2026-06-01\n---\nx`);

    const { posts } = listContent(root);
    expect(posts.map((p) => p.collection)).toEqual(["posts"]);
  });

  it("defaults draft to false and tags to [] when absent", () => {
    write("src/content/posts/min.md", `---\ntitle: Minimal\ndescription: d\npublishDate: 2026-06-01\n---\nx`);
    const { posts } = listContent(root);
    expect(posts[0].draft).toBe(false);
    expect(posts[0].tags).toEqual([]);
    expect(posts[0].publishDate).toMatch(/^2026-06-01/);
  });
});

describe("listContent — images", () => {
  it("scans public/images recursively with size and relative path", () => {
    write("public/images/hero.jpg", "fakejpgbytes");
    write("public/images/blog/cover.webp", "fakewebp");
    write("public/images/notes.txt", "not an image");

    const { images } = listContent(root);
    const byPath = Object.fromEntries(images.map((i) => [i.relativePath, i]));

    expect(Object.keys(byPath).sort()).toEqual(["public/images/blog/cover.webp", "public/images/hero.jpg"]);
    expect(byPath["public/images/hero.jpg"].fileName).toBe("hero.jpg");
    expect(byPath["public/images/hero.jpg"].byteSize).toBe("fakejpgbytes".length);
    expect(byPath["public/images/hero.jpg"].usedOnPages).toEqual([]);
    expect(typeof byPath["public/images/hero.jpg"].lastModified).toBe("string");
  });
});

describe("listContent — empty / missing dirs", () => {
  it("returns empty arrays for a site with no content dirs", () => {
    const result = listContent(root);
    expect(result).toEqual({ pages: [], posts: [], images: [] });
  });
});

describe("listContent — pagination and filtering (#392)", () => {
  beforeEach(() => {
    write("src/pages/about.astro", `<BaseLayout title="About" description="x" />`);
    write("src/pages/contact.astro", `<BaseLayout title="Contact" description="x" />`);
    write(
      "src/content/posts/a.md",
      `---\ntitle: A\ndescription: d\npublishDate: 2026-06-01\n---\nbody`,
    );
    write(
      "src/content/posts/b.md",
      `---\ntitle: B\ndescription: d\npublishDate: 2026-06-02\n---\nbody`,
    );
    write("public/images/hero.jpg", "fakejpgbytes");
  });

  it("with no options, behaves exactly as before (all buckets, unfiltered)", () => {
    const result = listContent(root);
    expect(result.pages).toHaveLength(2);
    expect(result.posts).toHaveLength(2);
    expect(result.images).toHaveLength(1);
  });

  it("type filters to a single bucket, leaving the others empty", () => {
    const result = listContent(root, { type: "posts" });
    expect(result.posts).toHaveLength(2);
    expect(result.pages).toEqual([]);
    expect(result.images).toEqual([]);
  });

  it("limit caps entries per bucket", () => {
    const result = listContent(root, { limit: 1 });
    expect(result.pages).toHaveLength(1);
    expect(result.posts).toHaveLength(1);
  });

  it("offset skips entries before applying limit", () => {
    const all = listContent(root, { type: "posts" });
    const paged = listContent(root, { type: "posts", offset: 1 });
    expect(paged.posts).toEqual(all.posts.slice(1));
  });

  it("offset past the end returns an empty bucket", () => {
    const result = listContent(root, { type: "posts", offset: 100 });
    expect(result.posts).toEqual([]);
  });

  it("fields projects each entry down to the requested keys", () => {
    const result = listContent(root, { type: "posts", fields: ["title", "slug"] });
    for (const post of result.posts) {
      expect(Object.keys(post).sort()).toEqual(["slug", "title"]);
    }
  });

  it("fields ignores unknown key names", () => {
    const result = listContent(root, { type: "posts", fields: ["title", "nonexistent"] });
    expect(Object.keys(result.posts[0])).toEqual(["title"]);
  });
});
