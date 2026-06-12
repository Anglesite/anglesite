import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listContent } from "../server/list-content.mjs";
import { buildServer } from "../server/index-tools.mjs";

// `buildServer` transitively imports `optimize-images.mjs` → `sharp` (a native
// addon not resolvable in the test sandbox). The tool under test never touches
// it; stub the module so the import chain loads. (vitest hoists vi.mock.)
vi.mock("sharp", () => ({ default: () => ({}) }));

let root;

/** Write a file at a projectRoot-relative path, creating parent dirs. */
function write(rel, contents = "") {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "list-content-"));
});
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("listContent — pages", () => {
  it("discovers pages under src/pages and derives Astro routes", () => {
    write("src/pages/index.astro", "<h1>Home</h1>");
    write("src/pages/about.astro", "---\ntitle: About Us\n---\n<h1>About</h1>");
    write("src/pages/blog/index.astro", "<h1>Blog</h1>");

    const { pages } = listContent(root);
    const byRoute = Object.fromEntries(pages.map((p) => [p.route, p]));

    expect(Object.keys(byRoute).sort()).toEqual(["/", "/about", "/blog"]);
    expect(byRoute["/about"].title).toBe("About Us");
    expect(byRoute["/about"].filePath).toBe("src/pages/about.astro");
    expect(byRoute["/"].lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("skips dynamic-route pages whose params can't be enumerated", () => {
    write("src/pages/index.astro", "<h1>Home</h1>");
    write("src/pages/blog/[slug].astro", "<h1>Post</h1>");
    write("src/pages/[...catchall].astro", "<h1>404</h1>");

    const { pages } = listContent(root);
    expect(pages.map((p) => p.route)).toEqual(["/"]);
  });
});

describe("listContent — posts", () => {
  it("discovers posts from content collections with frontmatter fields", () => {
    write(
      "src/content/posts/hello-world.md",
      "---\ntitle: Hello World\npublishDate: 2026-06-12\ntags:\n  - smoke\n  - siri\ndraft: false\n---\nbody",
    );
    write(
      "src/content/posts/wip.mdoc",
      "---\ntitle: WIP\ndraft: true\n---\nbody",
    );

    const { posts } = listContent(root);
    const bySlug = Object.fromEntries(posts.map((p) => [p.slug, p]));

    expect(Object.keys(bySlug).sort()).toEqual(["hello-world", "wip"]);

    const hw = bySlug["hello-world"];
    expect(hw.collection).toBe("posts");
    expect(hw.title).toBe("Hello World");
    expect(hw.draft).toBe(false);
    expect(hw.tags).toEqual(["smoke", "siri"]);
    // publishDate must be normalized to a FULL ISO-8601 datetime — the app's
    // ISO8601DateFormatter rejects date-only "2026-06-12".
    expect(hw.publishDate).toBe("2026-06-12T00:00:00.000Z");
    expect(hw.filePath).toBe("src/content/posts/hello-world.md");
    expect(hw.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // Defaults: draft true when set, tags default to [], publishDate omitted.
    expect(bySlug["wip"].draft).toBe(true);
    expect(bySlug["wip"].tags).toEqual([]);
    expect(bySlug["wip"].publishDate).toBeUndefined();
  });
});

describe("listContent — images", () => {
  it("discovers images from public/ and src/assets with metadata", () => {
    write("public/images/hero.svg", "<svg></svg>");
    write("src/assets/logo.png", "PNGDATA");
    write("public/notes.txt", "not an image");

    const { images } = listContent(root);
    const byPath = Object.fromEntries(images.map((i) => [i.relativePath, i]));

    expect(Object.keys(byPath).sort()).toEqual([
      "public/images/hero.svg",
      "src/assets/logo.png",
    ]);

    const hero = byPath["public/images/hero.svg"];
    expect(hero.fileName).toBe("hero.svg");
    expect(hero.relativePath.startsWith("/")).toBe(false);
    expect(hero.byteSize).toBe(11); // "<svg></svg>".length
    expect(hero.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Array.isArray(hero.usedOnPages)).toBe(true);
  });

  it("populates usedOnPages (best-effort) from page references", () => {
    write("public/images/hero.svg", "<svg></svg>");
    write("src/pages/index.astro", '<img src="/images/hero.svg">');
    write("src/pages/about.astro", "<h1>About</h1>");

    const { images } = listContent(root);
    const hero = images.find((i) => i.fileName === "hero.svg");
    expect(hero.usedOnPages).toEqual(["/"]);
  });
});

describe("list_content MCP tool", () => {
  it("registers list_content and returns the discovered listing", async () => {
    write("src/pages/index.astro", "<h1>Home</h1>");
    write("src/content/posts/hello.md", "---\ntitle: Hello\n---\nbody");
    write("public/images/hero.svg", "<svg></svg>");

    const server = buildServer(root);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("list_content");

    const res = await client.callTool({ name: "list_content", arguments: {} });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.pages.map((p) => p.route)).toEqual(["/"]);
    expect(payload.posts.map((p) => p.slug)).toEqual(["hello"]);
    expect(payload.images.map((i) => i.fileName)).toEqual(["hero.svg"]);

    await client.close();
  });
});
