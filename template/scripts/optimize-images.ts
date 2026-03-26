/**
 * Image optimization pipeline.
 *
 * Processes images in public/images/:
 * - Resizes to max width (default 1920px)
 * - Converts to WebP
 * - Generates responsive srcset variants (480, 768, 1024, 1920)
 * - Strips EXIF metadata (privacy: removes GPS, camera info)
 * - Preserves originals in public/images/originals/
 *
 * Supports: jpg, jpeg, png, gif, tiff, heif, heic
 * Skips: svg, webp, avif, favicon files, og-image
 *
 * Run: npm run ai-optimize
 */

import { readdirSync, existsSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { join, extname, basename, relative } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimizeResult {
  file: string;
  originalBytes: number;
  optimizedBytes: number;
  variants: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".tiff", ".tif", ".heif", ".heic",
]);

const SKIP_EXTENSIONS = new Set([".svg", ".webp", ".avif"]);

const SKIP_FILENAMES = new Set([
  "apple-touch-icon.png",
  "og-image.png",
  "favicon.svg",
]);

export const DEFAULT_WIDTHS = [480, 768, 1024, 1920];
export const DEFAULT_MAX_WIDTH = 1920;

// ---------------------------------------------------------------------------
// Pure logic functions (tested without sharp)
// ---------------------------------------------------------------------------

/**
 * Recursively find image files in a directory.
 */
export function getImageFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getImageFiles(full));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

/**
 * Determine whether an image file should be optimized.
 * Skips SVGs, already-optimized formats, and generated files.
 */
export function shouldOptimize(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);

  if (SKIP_EXTENSIONS.has(ext)) return false;
  if (SKIP_FILENAMES.has(name)) return false;
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Format optimization results as a plain-language report.
 */
export function formatReport(results: OptimizeResult[]): string {
  if (results.length === 0) {
    return "No images to optimize.";
  }

  const totalOriginal = results.reduce((sum, r) => sum + r.originalBytes, 0);
  const totalOptimized = results.reduce((sum, r) => sum + r.optimizedBytes, 0);
  const totalVariants = results.reduce((sum, r) => sum + r.variants, 0);

  const savings =
    totalOriginal > 0
      ? Math.round(((totalOriginal - totalOptimized) / totalOriginal) * 100)
      : 0;

  const count = results.length;
  const label = `${count} image${count !== 1 ? "s" : ""}`;

  return (
    `Optimized ${label}: ${formatBytes(totalOriginal)} → ${formatBytes(totalOptimized)} ` +
    `(${savings}% smaller). Generated ${totalVariants} responsive variants.`
  );
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Sharp pipeline (only runs when executed directly)
// ---------------------------------------------------------------------------

async function optimizeImage(
  inputPath: string,
  outputDir: string,
  widths: number[] = DEFAULT_WIDTHS,
): Promise<OptimizeResult> {
  // Dynamic import so tests don't require sharp
  const sharp = (await import("sharp")).default;

  const originalBytes = statSync(inputPath).size;
  const name = basename(inputPath, extname(inputPath));

  // Preserve original
  const originalsDir = join(outputDir, "originals");
  mkdirSync(originalsDir, { recursive: true });
  copyFileSync(inputPath, join(originalsDir, basename(inputPath)));

  let totalOptimizedBytes = 0;
  let variantCount = 0;

  const image = sharp(inputPath).rotate(); // auto-rotate from EXIF, then strip

  const metadata = await image.metadata();
  const originalWidth = metadata.width || DEFAULT_MAX_WIDTH;

  for (const width of widths) {
    if (width > originalWidth) continue;

    const outputPath = join(outputDir, `${name}-${width}w.webp`);
    const result = await sharp(inputPath)
      .rotate()
      .resize(width, undefined, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(outputPath);

    totalOptimizedBytes += result.size;
    variantCount++;
  }

  // Generate default WebP (at original size or max width)
  const defaultWidth = Math.min(originalWidth, DEFAULT_MAX_WIDTH);
  const defaultPath = join(outputDir, `${name}.webp`);
  const defaultResult = await sharp(inputPath)
    .rotate()
    .resize(defaultWidth, undefined, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(defaultPath);

  totalOptimizedBytes += defaultResult.size;
  variantCount++;

  return {
    file: basename(inputPath),
    originalBytes,
    optimizedBytes: totalOptimizedBytes,
    variants: variantCount,
  };
}

async function main() {
  const imagesDir = "public/images";

  if (!existsSync(imagesDir)) {
    console.log("No public/images/ directory found.");
    return;
  }

  const files = getImageFiles(imagesDir).filter(shouldOptimize);

  if (files.length === 0) {
    console.log("No images to optimize.");
    return;
  }

  console.log(`Found ${files.length} image${files.length !== 1 ? "s" : ""} to optimize...`);

  const results: OptimizeResult[] = [];
  for (const file of files) {
    try {
      const result = await optimizeImage(file, imagesDir);
      results.push(result);
      console.log(`  ✓ ${result.file}`);
    } catch (err: any) {
      console.error(`  ✗ ${basename(file)}: ${err.message}`);
    }
  }

  console.log(`\n${formatReport(results)}`);
}

if (process.argv[1]?.endsWith("optimize-images.ts")) {
  main().catch((err) => {
    console.error("Image optimization failed:", err.message);
    process.exit(1);
  });
}
