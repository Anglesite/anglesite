/**
 * Standalone on-device alt-text pass. Walks public/images/ — INCLUDING already
 * optimized .webp — and drafts alt text into image-alt.json for any image
 * lacking a catalog entry. Complements `ai-optimize` (which only drafts for
 * freshly-optimized source images), and serves imported images + backfill.
 * Run via `npm run ai-alt`. Authoring-time only; falls back silently when `fm`
 * is unavailable. See docs/decisions/0021-on-device-ai-accelerator.md.
 *
 * @module
 */

import { existsSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { readConfig } from "./config.js";
import {
  isFmAvailable,
  readCatalog,
  writeCatalog,
  shouldRunAltPass,
  draftAltForImage,
  catalogKeyFor,
  type AltCatalog,
} from "./fm.js";

const ALT_CANDIDATE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".tiff", ".tif", ".heif", ".heic", ".webp", ".avif",
]);
const SKIP_FILENAMES = new Set([
  "apple-touch-icon.png",
  "og-image.png",
  "favicon.svg",
]);

export function isAltCandidate(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!ALT_CANDIDATE_EXTENSIONS.has(ext)) return false;
  if (SKIP_FILENAMES.has(basename(filePath))) return false;
  return true;
}

/**
 * Images with no catalog entry yet. `ai-alt` is a backfill pass: it never
 * re-drafts an image that already has an entry (draft or reviewed), so
 * re-running it is idempotent and won't re-hammer the on-device model.
 */
export function uncataloguedImages(
  files: string[],
  publicDir: string,
  catalog: AltCatalog,
): string[] {
  return files.filter((f) => !catalog[catalogKeyFor(publicDir, f)]);
}

export function getAltCandidateFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "originals") continue;
      out.push(...getAltCandidateFiles(full));
    } else if (entry.isFile() && isAltCandidate(full)) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const publicDir = join(cwd, "public");
  const imagesDir = join(publicDir, "images");
  if (!existsSync(imagesDir)) {
    console.log("No public/images/ — nothing to draft alt for.");
    return;
  }
  const noAltFlag = process.argv.includes("--no-alt");
  if (!shouldRunAltPass({ noAltFlag, altTextAiConfig: readConfig("ALT_TEXT_AI") })) {
    console.log("Alt-text drafting is disabled (ALT_TEXT_AI=off or --no-alt).");
    return;
  }
  if (!(await isFmAvailable())) {
    console.log("On-device alt drafting unavailable (fm not present). Skipping.");
    return;
  }
  const catalogPath = join(cwd, "image-alt.json");
  const catalog = readCatalog(catalogPath);
  const files = uncataloguedImages(getAltCandidateFiles(imagesDir), publicDir, catalog);
  let drafted = 0;
  for (const file of files) {
    const alt = await draftAltForImage(catalog, publicDir, file);
    if (alt) {
      drafted++;
      console.log(`  ${file.replace(cwd + "/", "")}: ${alt}`);
    }
  }
  if (drafted > 0) {
    writeCatalog(catalogPath, catalog);
    console.log(
      `Drafted alt text for ${drafted} image(s) → image-alt.json (review before publishing).`,
    );
  } else {
    console.log("No new images needed alt text.");
  }
}

if (process.argv[1]?.endsWith("draft-alt.ts")) {
  await main();
}
