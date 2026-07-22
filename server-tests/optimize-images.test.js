import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { optimizeImage } from "../server/optimize-images.mjs";

let dir;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "anglesite-optimize-"));
  await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .withMetadata({ exif: { IFD0: { Make: "Anglesite Test" } } })
    .jpeg()
    .toFile(join(dir, "photo.jpg"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("optimizeImage", () => {
  it("emits a WebP primary at the largest width and width-suffixed variants", async () => {
    const result = await optimizeImage(join(dir, "photo.jpg"), {
      outputDir: dir,
      widths: [480, 768, 1024, 1920],
    });

    expect(result.primary).toBe("photo.webp");
    expect(result.variants).toHaveLength(4);
    expect(result.variants.map((v) => v.width)).toEqual([480, 768, 1024, 1920]);
    expect(result.variants.map((v) => v.file)).toEqual([
      "photo-480w.webp",
      "photo-768w.webp",
      "photo-1024w.webp",
      "photo-1920w.webp",
    ]);

    for (const v of result.variants) {
      expect(existsSync(join(dir, v.file))).toBe(true);
    }
    expect(existsSync(join(dir, result.primary))).toBe(true);
  });

  it("strips EXIF metadata from the output", async () => {
    const result = await optimizeImage(join(dir, "photo.jpg"), {
      outputDir: dir,
      widths: [480],
    });
    const meta = await sharp(join(dir, result.primary)).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("preserves the original under originals/ before overwriting", async () => {
    const result = await optimizeImage(join(dir, "photo.jpg"), {
      outputDir: dir,
      widths: [480],
      preserveOriginalsDir: join(dir, "originals"),
    });
    expect(existsSync(join(dir, "originals", "photo.jpg"))).toBe(true);
  });

  it("does not upscale: if input is narrower than a requested width, that variant is skipped", async () => {
    await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .jpeg()
      .toFile(join(dir, "small.jpg"));

    const result = await optimizeImage(join(dir, "small.jpg"), {
      outputDir: dir,
      widths: [480, 768, 1024, 1920],
    });
    expect(result.variants.map((v) => v.width)).toEqual([480]);
  });
});
