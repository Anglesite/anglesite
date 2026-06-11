import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAltCandidate, getAltCandidateFiles } from "../template/scripts/draft-alt.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("isAltCandidate", () => {
  it("accepts raster and webp/avif", () => {
    expect(isAltCandidate("/x/photo.jpg")).toBe(true);
    expect(isAltCandidate("/x/photo.PNG")).toBe(true);
    expect(isAltCandidate("/x/photo.webp")).toBe(true);
    expect(isAltCandidate("/x/photo.avif")).toBe(true);
    expect(isAltCandidate("/x/photo.heic")).toBe(true);
  });
  it("rejects svg and generated filenames", () => {
    expect(isAltCandidate("/x/logo.svg")).toBe(false);
    expect(isAltCandidate("/x/favicon.svg")).toBe(false);
    expect(isAltCandidate("/x/og-image.png")).toBe(false);
    expect(isAltCandidate("/x/apple-touch-icon.png")).toBe(false);
  });
  it("rejects non-images", () => {
    expect(isAltCandidate("/x/readme.md")).toBe(false);
  });
});

describe("getAltCandidateFiles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "alt-cand-"));
    mkdirSync(join(dir, "sub"), { recursive: true });
    mkdirSync(join(dir, "originals"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("includes webp and recurses subdirs, excludes svg/generated/originals", () => {
    writeFileSync(join(dir, "a.webp"), "");
    writeFileSync(join(dir, "b.png"), "");
    writeFileSync(join(dir, "logo.svg"), "");
    writeFileSync(join(dir, "og-image.png"), "");
    writeFileSync(join(dir, "sub", "c.jpg"), "");
    writeFileSync(join(dir, "originals", "d.jpg"), "");
    const files = getAltCandidateFiles(dir).map((f) => f.replace(dir + "/", "")).sort();
    expect(files).toEqual(["a.webp", "b.png", "sub/c.jpg"]);
  });
  it("returns [] for a missing directory", () => {
    expect(getAltCandidateFiles(join(dir, "nope"))).toEqual([]);
  });
});
