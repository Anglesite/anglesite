// Port-contract lint for theme packs (packs/<id>/), per
// docs/superpowers/specs/2026-07-31-curated-theme-ports-design.md §2.
//
// CLI: npx tsx scripts/check-pack.ts   (exit 1 on any violation; no packs = pass)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_RECORDS, type ThemeRecord } from "./themes";

/** The 12 base custom properties every pack's global.css must declare in :root. */
export const REQUIRED_ROOT_VARS = [
  "--color-primary", "--color-accent", "--color-background", "--color-surface",
  "--color-text", "--color-text-muted", "--font-heading", "--font-body",
  "--spacing-unit", "--radius-sm", "--radius-md", "--radius-lg",
] as const;

/** Marker anchors required per file, when the pack overrides that file. */
const REQUIRED_MARKERS: Record<string, string[]> = {
  "src/layouts/BaseLayout.astro": [
    "// anglesite:imports", "<!-- anglesite:head-end -->",
    "<!-- anglesite:nav -->", "<!-- anglesite:body-end -->",
  ],
  "src/pages/index.astro": ["// anglesite:imports", "<!-- anglesite:hero-cta -->"],
  "src/layouts/BlogPost.astro": ["// anglesite:imports"],
};

/** HomepageWriter's exact sentinels (Sources/AnglesiteCore/HomepageWriter.swift). */
const HOMEPAGE_SENTINELS = [
  'title="Welcome — Your New Anglesite Business Website"',
  'description="Your business website is ready to set up in Anglesite."',
  "<h1>Welcome</h1>",
  "<p>This site is ready to customize in Anglesite. Open the app to edit your pages, add content, and publish when you're ready.</p>",
];

/** Dirs that must stay flat (component-canvas resolver assumption). */
const FLAT_DIRS = ["src/components", "src/layouts"];

/** Validate one pack directory against the port contract. Empty array = compliant. */
export function validatePack(packDir: string, entry: ThemeRecord | undefined): string[] {
  const errors: string[] = [];

  if (!entry) {
    errors.push(`no catalog entry in themes.json has pack="${join(packDir).split("/").pop()}"`);
  } else {
    if (!entry.category) errors.push(`${entry.id}: catalog entry missing category`);
    if (!entry.thumbnail) errors.push(`${entry.id}: catalog entry missing thumbnail`);
    if (!entry.credit?.name || !entry.credit?.url || !entry.credit?.license) {
      errors.push(`${entry.id}: catalog entry missing credit name/url/license`);
    }
  }

  if (!existsSync(join(packDir, "LICENSE"))) errors.push("missing LICENSE");
  if (!existsSync(join(packDir, "thumbnail.png"))) errors.push("missing thumbnail.png");

  for (const [file, markers] of Object.entries(REQUIRED_MARKERS)) {
    const path = join(packDir, file);
    if (!existsSync(path)) continue; // not overridden — base chassis file survives
    const text = readFileSync(path, "utf8");
    for (const marker of markers) {
      if (!text.includes(marker)) errors.push(`${file}: missing marker ${marker}`);
    }
  }

  const indexPath = join(packDir, "src/pages/index.astro");
  if (existsSync(indexPath)) {
    const text = readFileSync(indexPath, "utf8");
    for (const sentinel of HOMEPAGE_SENTINELS) {
      if (!text.includes(sentinel)) {
        errors.push(`src/pages/index.astro: missing HomepageWriter sentinel ${sentinel}`);
      }
    }
  }

  for (const dir of FLAT_DIRS) {
    const path = join(packDir, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path)) {
      if (statSync(join(path, name)).isDirectory()) {
        errors.push(`${dir}/${name}: subdirectories not allowed (component-canvas resolver assumes flat dirs)`);
      }
    }
  }

  const cssPath = join(packDir, "src/styles/global.css");
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, "utf8");
    for (const name of REQUIRED_ROOT_VARS) {
      if (!css.includes(`${name}:`)) errors.push(`src/styles/global.css: missing ${name}`);
    }
  }

  return errors;
}

// CLI entry: validate every pack in the template's packs/ directory.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const packsRoot = join(templateRoot, "packs");
  if (!existsSync(packsRoot)) {
    console.log("check-pack: no packs/ directory — nothing to check.");
    process.exit(0);
  }
  const packs = readdirSync(packsRoot).filter((name) =>
    statSync(join(packsRoot, name)).isDirectory());
  let failed = false;
  for (const pack of packs) {
    const entry = THEME_RECORDS.find((theme) => theme.pack === pack);
    const errors = validatePack(join(packsRoot, pack), entry);
    if (errors.length > 0) {
      failed = true;
      console.error(`✗ ${pack}`);
      for (const error of errors) console.error(`    ${error}`);
    } else {
      console.log(`✓ ${pack}`);
    }
  }
  // Reverse check: catalog entries pointing at packs that don't exist.
  for (const theme of THEME_RECORDS) {
    if (theme.pack && !packs.includes(theme.pack)) {
      failed = true;
      console.error(`✗ ${theme.id}: catalog pack "${theme.pack}" has no packs/${theme.pack}/ directory`);
    }
  }
  process.exit(failed ? 1 : 0);
}
