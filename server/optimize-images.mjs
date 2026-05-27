import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import sharp from "sharp";

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
    await sharp(inputFile)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(out);
    const stats = await sharp(out).metadata();
    variants.push({ width, file, bytes: stats.size ?? 0 });
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
