/**
 * CLI wrapper around server/optimize-images.mjs. Walks public/images/,
 * preserves originals in public/images/originals/, and emits responsive
 * WebP variants. Run via `npm run ai-optimize`.
 *
 * The actual sharp pipeline lives in the plugin's server/optimize-images.mjs
 * so the apply-edit dispatcher can reuse it for drop-on-<img> optimization.
 */

import { readdirSync, existsSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { readConfig } from "./config.js";
import {
  isFmAvailable,
  generateAltText,
  catalogKeyFor,
  readCatalog,
  writeCatalog,
  needsAltDraft,
  mergeAltEntry,
  shouldRunAltPass,
  FM_MODEL_ID,
  type AltCatalog,
} from "./fm.js";

// ---------------------------------------------------------------------------
// Types (kept here so template-side tests can import them)
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

// ---------------------------------------------------------------------------
// Pure helpers (tested without sharp)
// ---------------------------------------------------------------------------

export function shouldOptimize(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return false;
  if (SKIP_EXTENSIONS.has(ext)) return false;
  const name = basename(filePath);
  if (SKIP_FILENAMES.has(name)) return false;
  return true;
}

export function getImageFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "originals") continue;
      out.push(...getImageFiles(full));
    } else if (entry.isFile() && shouldOptimize(full)) {
      out.push(full);
    }
  }
  return out;
}

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// CLI entry point — dynamic import deferred so helpers can be imported
// without triggering the sharp pipeline load.
// ---------------------------------------------------------------------------

function shouldRunAltPassLocal(noAltFlag: boolean): boolean {
  return shouldRunAltPass({ noAltFlag, altTextAiConfig: readConfig("ALT_TEXT_AI") });
}

async function main() {
  // Resolve the sharp pipeline relative to this script rather than via a bare
  // package specifier. A scaffolded site IS the plugin package (its name is set
  // in template/package.json), so the package is not present in its own
  // node_modules/ and a bare import would fail with ERR_MODULE_NOT_FOUND
  // (issue #320). The optimize core is scaffolded alongside this script at
  // ../server/.
  const optimizeModule = new URL("../server/optimize-images.mjs", import.meta.url).href;
  const { optimizeImage } = await import(optimizeModule);

  const cwd = process.cwd();
  const imagesDir = join(cwd, "public/images");
  if (!existsSync(imagesDir)) {
    console.log("No public/images/ — nothing to optimize.");
    return;
  }
  const files = getImageFiles(imagesDir);
  if (files.length === 0) {
    console.log("All images already optimized.");
    return;
  }
  console.log(`Optimizing ${files.length} image(s)…`);
  const noAltFlag = process.argv.includes("--no-alt");
  const altEnabled = shouldRunAltPassLocal(noAltFlag);
  const publicDir = join(cwd, "public");
  const catalogPath = join(cwd, "image-alt.json");
  let catalog: AltCatalog = {};
  let fmReady = false;
  if (altEnabled) {
    fmReady = await isFmAvailable();
    if (fmReady) catalog = readCatalog(catalogPath);
  }
  let altDrafted = 0;
  for (const file of files) {
    const result = await optimizeImage(file, {
      outputDir: dirname(file),
      preserveOriginalsDir: join(imagesDir, "originals"),
    });
    console.log(`  ${file.replace(cwd + "/", "")} → ${result.primary} (+${result.variants.length} variants)`);

    // Draft alt sequentially: `fm` drives a single on-device model, so
    // concurrent calls would contend on the same hardware, not speed up.
    if (fmReady) {
      const primaryAbs = join(dirname(file), result.primary);
      const key = catalogKeyFor(publicDir, primaryAbs);
      if (needsAltDraft(catalog, key)) {
        const alt = await generateAltText(primaryAbs);
        if (alt) {
          mergeAltEntry(catalog, key, {
            alt,
            model: FM_MODEL_ID,
            generatedAt: new Date().toISOString().slice(0, 10),
            status: "draft",
          });
          altDrafted++;
          console.log(`    alt draft: ${alt}`);
        }
      }
    }
  }

  if (fmReady && altDrafted > 0) {
    writeCatalog(catalogPath, catalog);
    console.log(
      `Drafted alt text for ${altDrafted} image(s) → image-alt.json (review before publishing).`,
    );
  }
  console.log("Done.");
}

if (process.argv[1]?.endsWith("optimize-images.ts")) {
  await main();
}
