import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  collectionsForSite,
  parseSiteConfig,
  pruneCollections,
} from "../scripts/prune-collections.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, "..", "template");

describe("collectionsForSite", () => {
  it("always includes posts", () => {
    for (const type of ["blog", "personal", "portfolio", "business", "organization"]) {
      expect(collectionsForSite(type)).toContain("posts");
    }
  });

  it("blog gets only posts", () => {
    expect(collectionsForSite("blog")).toEqual(["posts"]);
  });

  it("personal gets only posts", () => {
    expect(collectionsForSite("personal")).toEqual(["posts"]);
  });

  it("portfolio gets posts and gallery", () => {
    const result = collectionsForSite("portfolio");
    expect(result).toContain("posts");
    expect(result).toContain("gallery");
    expect(result).toHaveLength(2);
  });

  it("business gets core business collections", () => {
    const result = collectionsForSite("business");
    expect(result).toEqual(
      expect.arrayContaining(["posts", "services", "team", "testimonials", "faq", "events"]),
    );
    expect(result).not.toContain("menus");
    expect(result).not.toContain("products");
    expect(result).not.toContain("experiments");
  });

  it("organization gets the same as business", () => {
    expect(collectionsForSite("organization")).toEqual(collectionsForSite("business"));
  });

  it("restaurant business type adds menu collections", () => {
    const result = collectionsForSite("business", ["restaurant"]);
    expect(result).toContain("menus");
    expect(result).toContain("menuSections");
    expect(result).toContain("menuItems");
  });

  it("food-truck business type adds menu collections", () => {
    const result = collectionsForSite("business", ["food-truck"]);
    expect(result).toContain("menus");
    expect(result).toContain("menuSections");
    expect(result).toContain("menuItems");
  });

  it("retail business type adds products", () => {
    const result = collectionsForSite("business", ["retail"]);
    expect(result).toContain("products");
    expect(result).not.toContain("menus");
  });

  it("web-artist adds experiments", () => {
    const result = collectionsForSite("portfolio", ["web-artist"]);
    expect(result).toContain("experiments");
    expect(result).toContain("gallery");
  });

  it("multi-type business merges collections", () => {
    const result = collectionsForSite("business", ["restaurant", "retail"]);
    expect(result).toContain("menus");
    expect(result).toContain("menuSections");
    expect(result).toContain("menuItems");
    expect(result).toContain("products");
  });

  it("unknown site type still gets base", () => {
    expect(collectionsForSite("unknown")).toEqual(["posts"]);
  });

  it("unknown business type does not add extra collections", () => {
    const result = collectionsForSite("business", ["tattoo"]);
    expect(result).not.toContain("menus");
    expect(result).not.toContain("products");
  });

  it("returns sorted, deduplicated list", () => {
    const result = collectionsForSite("business", ["restaurant"]);
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("parseSiteConfig", () => {
  it("parses KEY=VALUE lines", () => {
    const config = parseSiteConfig("SITE_TYPE=business\nBUSINESS_TYPE=restaurant\n");
    expect(config).toEqual({ SITE_TYPE: "business", BUSINESS_TYPE: "restaurant" });
  });

  it("skips comments and blanks", () => {
    const config = parseSiteConfig("# comment\n\nSITE_TYPE=blog\n");
    expect(config).toEqual({ SITE_TYPE: "blog" });
  });

  it("handles values with = signs", () => {
    const config = parseSiteConfig("GOOGLE_REVIEW_URL=https://example.com?q=test\n");
    expect(config.GOOGLE_REVIEW_URL).toBe("https://example.com?q=test");
  });
});

describe("pruneCollections", () => {
  let tmpDir;

  function scaffold(siteConfig, collections) {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-prune-test-"));
    writeFileSync(join(tmpDir, ".site-config"), siteConfig);

    // Create content directories
    for (const name of collections) {
      const dir = join(tmpDir, "src", "content", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".gitkeep"), "");
    }

    // Create menu pages
    const menuDir = join(tmpDir, "src", "pages", "menu");
    mkdirSync(menuDir, { recursive: true });
    writeFileSync(join(tmpDir, "src", "pages", "menu.astro"), "");
    writeFileSync(join(menuDir, "[slug].astro"), "");
    writeFileSync(join(menuDir, "kiosk.astro"), "");

    // Create testimonials page
    writeFileSync(join(tmpDir, "src", "pages", "testimonials.astro"), "");

    // Create lab page
    const labDir = join(tmpDir, "src", "pages", "lab");
    mkdirSync(labDir, { recursive: true });
    writeFileSync(join(labDir, "index.astro"), "");

    // Create anglesite.config.json
    writeFileSync(
      join(tmpDir, "anglesite.config.json"),
      JSON.stringify({
        keystatic: {
          collections: [...collections],
          singletons: [],
        },
      }),
    );
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  const ALL = [
    "posts", "services", "team", "testimonials", "gallery", "events",
    "menus", "menuSections", "menuItems", "faq", "products", "experiments",
  ];

  it("portfolio site keeps only posts and gallery", () => {
    scaffold("SITE_TYPE=portfolio\n", ALL);
    const result = pruneCollections(tmpDir);

    expect(result.kept).toEqual(["gallery", "posts"]);
    expect(existsSync(join(tmpDir, "src", "content", "posts"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "content", "gallery"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "content", "menus"))).toBe(false);
    expect(existsSync(join(tmpDir, "src", "content", "services"))).toBe(false);
  });

  it("blog site keeps only posts", () => {
    scaffold("SITE_TYPE=blog\n", ALL);
    const result = pruneCollections(tmpDir);

    expect(result.kept).toEqual(["posts"]);
    expect(result.removed).toHaveLength(11);
  });

  it("restaurant business keeps menu + business collections", () => {
    scaffold("SITE_TYPE=business\nBUSINESS_TYPE=restaurant\n", ALL);
    const result = pruneCollections(tmpDir);

    expect(result.kept).toContain("menus");
    expect(result.kept).toContain("menuSections");
    expect(result.kept).toContain("menuItems");
    expect(result.kept).toContain("services");
    expect(result.kept).not.toContain("gallery");
    expect(result.kept).not.toContain("products");
    expect(result.kept).not.toContain("experiments");
  });

  it("removes menu pages when menus are pruned", () => {
    scaffold("SITE_TYPE=portfolio\n", ALL);
    pruneCollections(tmpDir);

    expect(existsSync(join(tmpDir, "src", "pages", "menu.astro"))).toBe(false);
    expect(existsSync(join(tmpDir, "src", "pages", "menu"))).toBe(false);
  });

  it("removes testimonials page when testimonials are pruned", () => {
    scaffold("SITE_TYPE=blog\n", ALL);
    pruneCollections(tmpDir);

    expect(existsSync(join(tmpDir, "src", "pages", "testimonials.astro"))).toBe(false);
  });

  it("removes lab page when experiments are pruned", () => {
    scaffold("SITE_TYPE=blog\n", ALL);
    pruneCollections(tmpDir);

    expect(existsSync(join(tmpDir, "src", "pages", "lab"))).toBe(false);
  });

  it("keeps menu pages for restaurant", () => {
    scaffold("SITE_TYPE=business\nBUSINESS_TYPE=restaurant\n", ALL);
    pruneCollections(tmpDir);

    expect(existsSync(join(tmpDir, "src", "pages", "menu.astro"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "pages", "menu", "[slug].astro"))).toBe(true);
  });

  it("updates anglesite.config.json", () => {
    scaffold("SITE_TYPE=portfolio\n", ALL);
    pruneCollections(tmpDir);

    const manifest = JSON.parse(
      readFileSync(join(tmpDir, "anglesite.config.json"), "utf-8"),
    );
    expect(manifest.keystatic.collections.sort()).toEqual(["gallery", "posts"]);
  });

  it("throws without .site-config", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-prune-test-"));
    expect(() => pruneCollections(tmpDir)).toThrow(".site-config");
  });

  it("throws without SITE_TYPE", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-prune-test-"));
    writeFileSync(join(tmpDir, ".site-config"), "OWNER_NAME=Test\n");
    expect(() => pruneCollections(tmpDir)).toThrow("SITE_TYPE");
  });

  it("handles already-missing directories gracefully", () => {
    scaffold("SITE_TYPE=blog\n", ["posts"]);
    // Most directories don't exist — should not throw
    const result = pruneCollections(tmpDir);
    expect(result.kept).toEqual(["posts"]);
  });

  it("multi-type business merges correctly", () => {
    scaffold("SITE_TYPE=business\nBUSINESS_TYPE=restaurant,retail\n", ALL);
    const result = pruneCollections(tmpDir);

    expect(result.kept).toContain("menus");
    expect(result.kept).toContain("products");
  });

  it("creates needed directories when none exist", () => {
    // Simulate a scaffold with no content directories (no .gitkeep files)
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-prune-test-"));
    writeFileSync(join(tmpDir, ".site-config"), "SITE_TYPE=portfolio\n");
    mkdirSync(join(tmpDir, "src", "content"), { recursive: true });
    writeFileSync(
      join(tmpDir, "anglesite.config.json"),
      JSON.stringify({ keystatic: { collections: [], singletons: [] } }),
    );

    const result = pruneCollections(tmpDir);

    expect(result.created.sort()).toEqual(["gallery", "posts"]);
    expect(existsSync(join(tmpDir, "src", "content", "posts"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "content", "gallery"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "content", "menus"))).toBe(false);
  });

  it("does not list already-existing dirs in created", () => {
    scaffold("SITE_TYPE=portfolio\n", ALL);
    const result = pruneCollections(tmpDir);

    // All dirs already existed from scaffold, so nothing was created
    expect(result.created).toEqual([]);
  });

  it("creates missing dirs and removes unneeded in one pass", () => {
    // Start with only unneeded dirs — like a misconfigured scaffold
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-prune-test-"));
    writeFileSync(join(tmpDir, ".site-config"), "SITE_TYPE=blog\n");
    mkdirSync(join(tmpDir, "src", "content", "menus"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "content", "products"), { recursive: true });
    writeFileSync(
      join(tmpDir, "anglesite.config.json"),
      JSON.stringify({
        keystatic: { collections: ["menus", "products"], singletons: [] },
      }),
    );

    const result = pruneCollections(tmpDir);

    expect(result.created).toEqual(["posts"]);
    expect(result.removed.sort()).toEqual(["menus", "products"]);
    expect(existsSync(join(tmpDir, "src", "content", "posts"))).toBe(true);
    expect(existsSync(join(tmpDir, "src", "content", "menus"))).toBe(false);
  });
});
