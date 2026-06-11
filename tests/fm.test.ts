import { describe, it, expect } from "vitest";
import {
  normalizeAltOutput,
  catalogKeyFor,
  needsAltDraft,
  mergeAltEntry,
  shouldRunAltPass,
  readCatalog,
  writeCatalog,
  parseClassification,
  type AltCatalog,
  type SubmissionClassification,
} from "../template/scripts/fm.js";
import { isFmAvailable, generateAltText, defaultRunner, type CommandRunner } from "../template/scripts/fm.js";
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
  it("normalizes backslashes to forward slashes", () => {
    expect(catalogKeyFor("/site/public", "/site/public/images\\blog\\x.webp")).toBe(
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
  it("returns {} when JSON is valid but not an object", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-cat-"));
    const p = join(dir, "image-alt.json");
    writeFileSync(p, "[1,2,3]");
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

describe("isFmAvailable", () => {
  it("is true when `fm available` reports the system model", async () => {
    const run: CommandRunner = async () => ({ stdout: "System model available", exitCode: 0 });
    expect(await isFmAvailable(run)).toBe(true);
  });
  it("is false when the binary is missing (exitCode -1, empty stdout)", async () => {
    const run: CommandRunner = async () => ({ stdout: "", exitCode: -1 });
    expect(await isFmAvailable(run)).toBe(false);
  });
  it("is false when stdout lacks the availability phrase", async () => {
    const run: CommandRunner = async () => ({ stdout: "something else", exitCode: 0 });
    expect(await isFmAvailable(run)).toBe(false);
  });
  it("is false when the runner throws", async () => {
    const run: CommandRunner = async () => { throw new Error("boom"); };
    expect(await isFmAvailable(run)).toBe(false);
  });
});

describe("generateAltText", () => {
  it("returns normalized alt on success", async () => {
    const run: CommandRunner = async () => ({ stdout: "  A red barn\n", exitCode: 0 });
    expect(await generateAltText("/x.webp", run)).toBe("A red barn");
  });
  it("returns null on non-zero exit", async () => {
    const run: CommandRunner = async () => ({ stdout: "A red barn", exitCode: 1 });
    expect(await generateAltText("/x.webp", run)).toBeNull();
  });
  it("returns null when output is empty", async () => {
    const run: CommandRunner = async () => ({ stdout: "   ", exitCode: 0 });
    expect(await generateAltText("/x.webp", run)).toBeNull();
  });
  it("returns null when the runner throws", async () => {
    const run: CommandRunner = async () => { throw new Error("boom"); };
    expect(await generateAltText("/x.webp", run)).toBeNull();
  });
});

describe("defaultRunner (real execFile)", () => {
  it("returns exitCode 0 and captured stdout on success", async () => {
    const r = await defaultRunner(process.execPath, ["-e", "process.stdout.write('hi')"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hi");
  });

  it("returns the numeric exit code on non-zero exit", async () => {
    const r = await defaultRunner(process.execPath, ["-e", "process.exit(3)"]);
    expect(r.exitCode).toBe(3);
  });

  it("returns exitCode -1 when the binary is missing (ENOENT)", async () => {
    const r = await defaultRunner("anglesite-no-such-binary-xyz", []);
    expect(r.exitCode).toBe(-1);
    expect(r.stdout).toBe("");
  });

  it("preserves stdout printed before a non-zero exit", async () => {
    const r = await defaultRunner(process.execPath, [
      "-e",
      "process.stdout.write('partial'); process.exit(2)",
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain("partial");
  });

  it("passes opts.input to the child's stdin", async () => {
    const r = await defaultRunner(
      process.execPath,
      ["-e", "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d.toUpperCase()))"],
      { input: "hello" },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("HELLO");
  });
});

describe("parseClassification", () => {
  it("parses a valid object", () => {
    const r = parseClassification('{"isSpam": true, "category": "lead", "reason": "wants a quote"}');
    expect(r).toEqual({ isSpam: true, category: "lead", reason: "wants a quote" });
  });
  it("is order-independent", () => {
    const r = parseClassification('{"reason": "x", "category": "support", "isSpam": false}');
    expect(r).toEqual({ isSpam: false, category: "support", reason: "x" });
  });
  it("falls back to 'other' for an unknown category", () => {
    expect(parseClassification('{"isSpam": false, "category": "marketing", "reason": "ad"}')!.category).toBe("other");
  });
  it("coerces non-boolean isSpam", () => {
    expect(parseClassification('{"isSpam": "yes", "category": "other", "reason": ""}')!.isSpam).toBe(true);
    expect(parseClassification('{"isSpam": "no", "category": "other", "reason": ""}')!.isSpam).toBe(false);
  });
  it("defaults a missing reason to empty string", () => {
    expect(parseClassification('{"isSpam": false, "category": "question"}')!.reason).toBe("");
  });
  it("strips ANSI and whitespace before parsing", () => {
    expect(parseClassification('\x1b[32m {"isSpam": false, "category": "lead", "reason": "x"} \x1b[0m')!.category).toBe("lead");
  });
  it("returns null for malformed JSON", () => {
    expect(parseClassification("{ not json")).toBeNull();
  });
  it("returns null for a JSON array", () => {
    expect(parseClassification("[1,2,3]")).toBeNull();
  });
  it("coerces case-insensitively for isSpam", () => {
    expect(parseClassification('{"isSpam": "Yes", "category": "other", "reason": ""}')!.isSpam).toBe(true);
    expect(parseClassification('{"isSpam": "TRUE", "category": "other", "reason": ""}')!.isSpam).toBe(true);
    expect(parseClassification('{"isSpam": "true", "category": "other", "reason": ""}')!.isSpam).toBe(true);
  });
  it("normalizes category casing", () => {
    expect(parseClassification('{"isSpam": false, "category": "Lead", "reason": ""}')!.category).toBe("lead");
    expect(parseClassification('{"isSpam": false, "category": "SUPPORT", "reason": ""}')!.category).toBe("support");
  });
});
