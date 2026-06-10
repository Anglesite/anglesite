import { describe, it, expect } from "vitest";
import {
  normalizeAltOutput,
  catalogKeyFor,
  needsAltDraft,
  mergeAltEntry,
  shouldRunAltPass,
  readCatalog,
  writeCatalog,
  type AltCatalog,
} from "../template/scripts/fm.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("normalizeAltOutput", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeAltOutput("  A dog\n on  grass \n")).toBe("A dog on grass");
  });

  it("strips ANSI escape codes", () => {
    expect(normalizeAltOutput("\x1b[32mA red barn\x1b[0m")).toBe("A red barn");
  });

  it("strips surrounding quotes", () => {
    expect(normalizeAltOutput('"A red barn"')).toBe("A red barn");
  });

  it("drops an 'image of' / 'photo of' prefix", () => {
    expect(normalizeAltOutput("Photo of a red barn")).toBe("a red barn");
    expect(normalizeAltOutput("An image of a red barn")).toBe("a red barn");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeAltOutput("   ")).toBe("");
  });
});

describe("catalogKeyFor", () => {
  it("produces a public-relative key with leading slash", () => {
    expect(catalogKeyFor("/site/public", "/site/public/images/blog/x.webp")).toBe(
      "/images/blog/x.webp",
    );
  });
});

describe("needsAltDraft", () => {
  const base: AltCatalog = {
    "/images/a.webp": { alt: "a", model: "m", generatedAt: "2026-06-10", status: "draft" },
    "/images/b.webp": { alt: "b", model: "m", generatedAt: "2026-06-10", status: "reviewed" },
  };
  it("is true when the key is missing", () => {
    expect(needsAltDraft(base, "/images/missing.webp")).toBe(true);
  });
  it("is true when the existing entry is a draft", () => {
    expect(needsAltDraft(base, "/images/a.webp")).toBe(true);
  });
  it("is false when the existing entry is reviewed", () => {
    expect(needsAltDraft(base, "/images/b.webp")).toBe(false);
  });
});

describe("mergeAltEntry", () => {
  it("writes a new entry when the key is missing", () => {
    const cat: AltCatalog = {};
    mergeAltEntry(cat, "/images/a.webp", { alt: "a", model: "m", generatedAt: "d", status: "draft" });
    expect(cat["/images/a.webp"].alt).toBe("a");
  });
  it("overwrites an existing draft", () => {
    const cat: AltCatalog = { "/images/a.webp": { alt: "old", model: "m", generatedAt: "d", status: "draft" } };
    mergeAltEntry(cat, "/images/a.webp", { alt: "new", model: "m", generatedAt: "d", status: "draft" });
    expect(cat["/images/a.webp"].alt).toBe("new");
  });
  it("never overwrites a reviewed entry", () => {
    const cat: AltCatalog = { "/images/a.webp": { alt: "kept", model: "m", generatedAt: "d", status: "reviewed" } };
    mergeAltEntry(cat, "/images/a.webp", { alt: "new", model: "m", generatedAt: "d", status: "draft" });
    expect(cat["/images/a.webp"].alt).toBe("kept");
    expect(cat["/images/a.webp"].status).toBe("reviewed");
  });
});

describe("shouldRunAltPass", () => {
  it("is false when --no-alt was passed", () => {
    expect(shouldRunAltPass({ noAltFlag: true })).toBe(false);
  });
  it("is false when ALT_TEXT_AI=off (any case)", () => {
    expect(shouldRunAltPass({ noAltFlag: false, altTextAiConfig: "off" })).toBe(false);
    expect(shouldRunAltPass({ noAltFlag: false, altTextAiConfig: "OFF" })).toBe(false);
  });
  it("is true by default", () => {
    expect(shouldRunAltPass({ noAltFlag: false })).toBe(true);
    expect(shouldRunAltPass({ noAltFlag: false, altTextAiConfig: "on" })).toBe(true);
  });
});

describe("readCatalog / writeCatalog", () => {
  it("returns {} when the file is missing", () => {
    expect(readCatalog(join(tmpdir(), "nope-" + Math.random() + ".json"))).toEqual({});
  });
  it("returns {} for malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cat-"));
    const p = join(dir, "image-alt.json");
    writeFileSync(p, "{ not json");
    expect(readCatalog(p)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
  it("round-trips and sorts keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cat-"));
    const p = join(dir, "image-alt.json");
    const cat: AltCatalog = {
      "/images/z.webp": { alt: "z", model: "m", generatedAt: "d", status: "draft" },
      "/images/a.webp": { alt: "a", model: "m", generatedAt: "d", status: "draft" },
    };
    writeCatalog(p, cat);
    const text = readFileSync(p, "utf-8");
    expect(text.indexOf("/images/a.webp")).toBeLessThan(text.indexOf("/images/z.webp"));
    expect(readCatalog(p)).toEqual(cat);
    rmSync(dir, { recursive: true, force: true });
  });
});
