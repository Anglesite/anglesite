import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getImageFiles,
  shouldOptimize,
  formatReport,
  type OptimizeResult,
} from "../template/scripts/optimize-images.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// getImageFiles
// ---------------------------------------------------------------------------

describe("getImageFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-img-test-"));
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds jpg, jpeg, png files", () => {
    writeFileSync(join(tmpDir, "photo.jpg"), "");
    writeFileSync(join(tmpDir, "banner.jpeg"), "");
    writeFileSync(join(tmpDir, "logo.png"), "");
    const files = getImageFiles(tmpDir);
    expect(files.length).toBe(3);
  });

  it("finds heif and heic files", () => {
    writeFileSync(join(tmpDir, "iphone-photo.heic"), "");
    writeFileSync(join(tmpDir, "another.heif"), "");
    const files = getImageFiles(tmpDir);
    expect(files.length).toBe(2);
  });

  it("finds gif and tiff files", () => {
    writeFileSync(join(tmpDir, "anim.gif"), "");
    writeFileSync(join(tmpDir, "scan.tiff"), "");
    const files = getImageFiles(tmpDir);
    expect(files.length).toBe(2);
  });

  it("finds files in subdirectories", () => {
    writeFileSync(join(tmpDir, "sub", "nested.jpg"), "");
    const files = getImageFiles(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain("sub");
  });

  it("ignores non-image files", () => {
    writeFileSync(join(tmpDir, "readme.md"), "");
    writeFileSync(join(tmpDir, "style.css"), "");
    writeFileSync(join(tmpDir, "data.json"), "");
    const files = getImageFiles(tmpDir);
    expect(files.length).toBe(0);
  });

  it("is case-insensitive for extensions", () => {
    writeFileSync(join(tmpDir, "photo.JPG"), "");
    writeFileSync(join(tmpDir, "banner.PNG"), "");
    writeFileSync(join(tmpDir, "iphone.HEIC"), "");
    const files = getImageFiles(tmpDir);
    expect(files.length).toBe(3);
  });

  it("returns empty for non-existent directory", () => {
    const files = getImageFiles(join(tmpDir, "nope"));
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shouldOptimize
// ---------------------------------------------------------------------------

describe("shouldOptimize", () => {
  it("returns true for jpg", () => {
    expect(shouldOptimize("public/images/photo.jpg")).toBe(true);
  });

  it("returns true for png", () => {
    expect(shouldOptimize("public/images/logo.png")).toBe(true);
  });

  it("returns true for heic", () => {
    expect(shouldOptimize("public/images/iphone.heic")).toBe(true);
  });

  it("returns true for heif", () => {
    expect(shouldOptimize("public/images/camera.heif")).toBe(true);
  });

  it("returns false for already-optimized webp", () => {
    expect(shouldOptimize("public/images/photo.webp")).toBe(false);
  });

  it("returns false for svg", () => {
    expect(shouldOptimize("public/favicon.svg")).toBe(false);
  });

  it("returns false for avif", () => {
    expect(shouldOptimize("public/images/photo.avif")).toBe(false);
  });

  it("returns false for favicon png", () => {
    expect(shouldOptimize("public/apple-touch-icon.png")).toBe(false);
  });

  it("returns false for og-image", () => {
    expect(shouldOptimize("public/og-image.png")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe("formatReport", () => {
  it("summarizes optimization results", () => {
    const results: OptimizeResult[] = [
      { file: "photo.jpg", originalBytes: 5_000_000, optimizedBytes: 500_000, variants: 4 },
      { file: "banner.png", originalBytes: 3_000_000, optimizedBytes: 300_000, variants: 4 },
    ];
    const report = formatReport(results);
    expect(report).toContain("2 image");
    expect(report).toMatch(/\d+(\.\d+)?\s*MB/);
  });

  it("shows percentage savings", () => {
    const results: OptimizeResult[] = [
      { file: "photo.jpg", originalBytes: 10_000_000, optimizedBytes: 1_500_000, variants: 4 },
    ];
    const report = formatReport(results);
    expect(report).toContain("85%");
  });

  it("handles no images", () => {
    const report = formatReport([]);
    expect(report.toLowerCase()).toContain("no image");
  });

  it("handles zero original bytes gracefully", () => {
    const results: OptimizeResult[] = [
      { file: "empty.jpg", originalBytes: 0, optimizedBytes: 0, variants: 0 },
    ];
    const report = formatReport(results);
    expect(report).not.toContain("NaN");
    expect(report).not.toContain("Infinity");
  });

  it("formats bytes as KB for small files", () => {
    const results: OptimizeResult[] = [
      { file: "tiny.jpg", originalBytes: 50_000, optimizedBytes: 10_000, variants: 4 },
    ];
    const report = formatReport(results);
    expect(report).toMatch(/KB/);
  });
});
