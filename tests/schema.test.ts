import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { extractKeystatic, generateManifest } from "../template/scripts/schema.js";

// ---------------------------------------------------------------------------
// extractKeystatic — parse keystatic config source to extract schema
// ---------------------------------------------------------------------------

describe("extractKeystatic", () => {
  it("extracts collection names from a standard keystatic config", () => {
    const source = `
import { config, fields, collection } from "@keystatic/core";
export default config({
  storage: { kind: "local" },
  collections: {
    posts: collection({ label: "Blog Posts", slugField: "title", path: "src/content/posts/*", schema: {} }),
    team: collection({ label: "Team", slugField: "name", path: "src/content/team/*", schema: {} }),
  },
});`;
    const result = extractKeystatic(source);
    expect(result.collections).toEqual(["posts", "team"]);
  });

  it("extracts singleton names when present", () => {
    const source = `
import { config, fields, collection, singleton } from "@keystatic/core";
export default config({
  storage: { kind: "local" },
  collections: {
    posts: collection({ label: "Blog Posts", slugField: "title", path: "src/content/posts/*", schema: {} }),
  },
  singletons: {
    homepage: singleton({ label: "Homepage", schema: {} }),
    navigation: singleton({ label: "Navigation", schema: {} }),
    "business-info": singleton({ label: "Business Info", schema: {} }),
  },
});`;
    const result = extractKeystatic(source);
    expect(result.collections).toEqual(["posts"]);
    expect(result.singletons).toEqual(["homepage", "navigation", "business-info"]);
  });

  it("returns empty arrays when no collections or singletons", () => {
    const source = `
import { config } from "@keystatic/core";
export default config({ storage: { kind: "local" } });`;
    const result = extractKeystatic(source);
    expect(result.collections).toEqual([]);
    expect(result.singletons).toEqual([]);
  });

  it("extracts all seven default Anglesite collections", () => {
    const source = `
import { config, fields, collection } from "@keystatic/core";
export default config({
  storage: { kind: "local" },
  collections: {
    posts: collection({ label: "Blog Posts", slugField: "title", path: "src/content/posts/*", schema: {} }),
    services: collection({ label: "Services", slugField: "name", path: "src/content/services/*", schema: {} }),
    team: collection({ label: "Team", slugField: "name", path: "src/content/team/*", schema: {} }),
    testimonials: collection({ label: "Testimonials", slugField: "author", path: "src/content/testimonials/*", schema: {} }),
    gallery: collection({ label: "Gallery", slugField: "alt", path: "src/content/gallery/*", schema: {} }),
    events: collection({ label: "Events", slugField: "title", path: "src/content/events/*", schema: {} }),
    faq: collection({ label: "FAQ", slugField: "question", path: "src/content/faq/*", schema: {} }),
  },
});`;
    const result = extractKeystatic(source);
    expect(result.collections).toEqual([
      "posts",
      "services",
      "team",
      "testimonials",
      "gallery",
      "events",
      "faq",
    ]);
  });

  it("handles hyphenated keys in quotes", () => {
    const source = `
export default config({
  collections: {
    "case-studies": collection({ label: "Case Studies", schema: {} }),
  },
  singletons: {
    "business-info": singleton({ label: "Business Info", schema: {} }),
  },
});`;
    const result = extractKeystatic(source);
    expect(result.collections).toEqual(["case-studies"]);
    expect(result.singletons).toEqual(["business-info"]);
  });

  it("returns empty singletons when only collections exist", () => {
    const source = `
export default config({
  collections: {
    posts: collection({ label: "Posts", schema: {} }),
  },
});`;
    const result = extractKeystatic(source);
    expect(result.singletons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateManifest — read keystatic config, write anglesite.config.json
// ---------------------------------------------------------------------------

describe("generateManifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-schema-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes anglesite.config.json from keystatic.config.ts", () => {
    writeFileSync(
      join(tmpDir, "keystatic.config.ts"),
      `import { config, collection } from "@keystatic/core";
export default config({
  collections: {
    posts: collection({ label: "Posts", slugField: "title", schema: {} }),
    team: collection({ label: "Team", slugField: "name", schema: {} }),
  },
});`,
    );

    generateManifest(tmpDir);

    const manifest = JSON.parse(
      readFileSync(join(tmpDir, "anglesite.config.json"), "utf-8"),
    );
    expect(manifest.keystatic.collections).toEqual(["posts", "team"]);
    expect(manifest.keystatic.singletons).toEqual([]);
  });

  it("includes singletons in the manifest", () => {
    writeFileSync(
      join(tmpDir, "keystatic.config.ts"),
      `import { config, collection, singleton } from "@keystatic/core";
export default config({
  collections: {
    posts: collection({ label: "Posts", slugField: "title", schema: {} }),
  },
  singletons: {
    homepage: singleton({ label: "Homepage", schema: {} }),
  },
});`,
    );

    generateManifest(tmpDir);

    const manifest = JSON.parse(
      readFileSync(join(tmpDir, "anglesite.config.json"), "utf-8"),
    );
    expect(manifest.keystatic.collections).toEqual(["posts"]);
    expect(manifest.keystatic.singletons).toEqual(["homepage"]);
  });

  it("writes empty schema when keystatic.config.ts is missing", () => {
    generateManifest(tmpDir);

    const manifest = JSON.parse(
      readFileSync(join(tmpDir, "anglesite.config.json"), "utf-8"),
    );
    expect(manifest.keystatic.collections).toEqual([]);
    expect(manifest.keystatic.singletons).toEqual([]);
  });

  it("produces valid JSON with consistent formatting", () => {
    writeFileSync(
      join(tmpDir, "keystatic.config.ts"),
      `export default config({ collections: { faq: collection({ label: "FAQ", schema: {} }) } });`,
    );

    generateManifest(tmpDir);

    const raw = readFileSync(join(tmpDir, "anglesite.config.json"), "utf-8");
    // Should be pretty-printed with 2-space indent and trailing newline
    expect(raw).toBe(JSON.stringify({ keystatic: { collections: ["faq"], singletons: [] } }, null, 2) + "\n");
  });
});

// ---------------------------------------------------------------------------
// Template consistency — anglesite.config.json matches keystatic.config.ts
// ---------------------------------------------------------------------------

describe("template manifest consistency", () => {
  it("anglesite.config.json matches keystatic.config.ts collections", () => {
    const templateDir = resolve(__dirname, "..", "template");
    const keystatic = readFileSync(join(templateDir, "keystatic.config.ts"), "utf-8");
    const manifest = JSON.parse(
      readFileSync(join(templateDir, "anglesite.config.json"), "utf-8"),
    );

    const extracted = extractKeystatic(keystatic);
    expect(manifest.keystatic.collections).toEqual(extracted.collections);
    expect(manifest.keystatic.singletons).toEqual(extracted.singletons);
  });
});
