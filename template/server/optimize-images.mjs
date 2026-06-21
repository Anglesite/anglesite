import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

/**
 * Lazily resolve `sharp`. It's an optional native dependency: importing it at
 * module top level would crash the whole MCP server at boot when it's absent
 * (stale/partial node_modules), because this module sits on the apply_edit boot
 * path. Loading it on first use keeps the server alive and fails only the
 * image-optimization tool — at call time, with an actionable message (#361).
 *
 * Caches the import Promise (not the resolved value) so concurrent callers
 * share one load, and resets on failure so a retry can succeed after a later
 * `npm install` without restarting the server. The original failure is kept on
 * `.cause` — a load can fail for reasons other than absence (ABI mismatch,
 * wrong Node version, corrupted install), and discarding it would be misleading.
 *
 * @returns {Promise<import("sharp").default>}
 */
let _sharpPromise;
function loadSharp() {
  if (!_sharpPromise) {
    _sharpPromise = import("sharp")
      .then((m) => m.default)
      .catch((cause) => {
        _sharpPromise = undefined;
        throw new Error(
          "image optimization requires the 'sharp' package — run `npm install` (or `npm install sharp`)",
          { cause },
        );
      });
  }
  return _sharpPromise;
}

/**
 * Optimize a single image: write a primary WebP plus responsive variants,
 * stripping EXIF metadata. Idempotent on re-run.
 *
 * @param {string} inputFile - absolute path to a source image (.jpg/.png/.heic/etc)
 * @param {{
 *   outputDir: string,
 *   widths?: number[],
 *   preserveOriginalsDir?: string,
 * }} options
 * @returns {Promise<{
 *   primary: string,
 *   variants: Array<{ width: number, file: string, bytes: number }>,
 * }>}
 */
export async function optimizeImage(inputFile, options) {
  const sharp = await loadSharp();
  const widths = options.widths ?? [480, 768, 1024, 1920];
  const outputDir = options.outputDir;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const stem = basename(inputFile, extname(inputFile));

  if (options.preserveOriginalsDir) {
    if (!existsSync(options.preserveOriginalsDir)) {
      mkdirSync(options.preserveOriginalsDir, { recursive: true });
    }
    copyFileSync(inputFile, join(options.preserveOriginalsDir, basename(inputFile)));
  }

  const meta = await sharp(inputFile).metadata();
  const inputWidth = meta.width ?? 0;
  const usableWidths = widths.filter((w) => w <= inputWidth).sort((a, b) => a - b);
  if (usableWidths.length === 0) {
    usableWidths.push(Math.min(widths[0] ?? inputWidth, inputWidth));
  }

  const variants = [];
  for (const width of usableWidths) {
    const file = `${stem}-${width}w.webp`;
    const out = join(outputDir, file);
    const info = await sharp(inputFile)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(out);
    variants.push({ width, file, bytes: info.size });
  }

  const primaryWidth = usableWidths[usableWidths.length - 1];
  const primary = `${stem}.webp`;
  await sharp(inputFile)
    .rotate()
    .resize({ width: primaryWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(join(outputDir, primary));

  return { primary, variants };
}
