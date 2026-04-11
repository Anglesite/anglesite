/**
 * Remove content collections that aren't relevant to the site type.
 *
 * Reads SITE_TYPE and BUSINESS_TYPE from .site-config, then deletes
 * content directories, associated pages, and updates anglesite.config.json.
 *
 * Usage: node scripts/prune-collections.mjs [project-dir]
 *        Defaults to current working directory.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Collection mapping
// ---------------------------------------------------------------------------

/** Every site gets these collections regardless of type. */
const BASE_COLLECTIONS = ["posts"];

/** Additional collections by SITE_TYPE. */
const BY_SITE_TYPE = {
  blog: [],
  personal: [],
  portfolio: ["gallery"],
  business: ["services", "team", "testimonials", "faq", "events"],
  organization: ["services", "team", "testimonials", "faq", "events"],
};

/** Additional collections by BUSINESS_TYPE (additive, checked per type). */
const BY_BUSINESS_TYPE = {
  // Food service → menu system
  restaurant: ["menus", "menuSections", "menuItems"],
  "food-truck": ["menus", "menuSections", "menuItems"],
  brewery: ["menus", "menuSections", "menuItems"],
  grocery: ["menus", "menuSections", "menuItems"],
  // Retail → products
  retail: ["products"],
  farm: ["products"],
  // Creative coding → experiments
  "web-artist": ["experiments"],
};

/** All collections the template defines. */
const ALL_COLLECTIONS = [
  "posts",
  "services",
  "team",
  "testimonials",
  "gallery",
  "events",
  "menus",
  "menuSections",
  "menuItems",
  "faq",
  "products",
  "experiments",
];

/**
 * Pages tied to specific collections — removed when the collection is pruned.
 * Paths are relative to the project root.
 */
const COLLECTION_PAGES = {
  menus: [
    "src/pages/menu.astro",
    "src/pages/menu/[slug].astro",
    "src/pages/menu/kiosk.astro",
  ],
  testimonials: ["src/pages/testimonials.astro"],
  experiments: ["src/pages/lab/index.astro"],
};

// ---------------------------------------------------------------------------
// Exported helpers (for testing)
// ---------------------------------------------------------------------------

/**
 * Return the set of collections needed for a given site type and business types.
 * @param {string} siteType - One of: blog, personal, portfolio, business, organization
 * @param {string[]} businessTypes - Comma-separated business types (primary first)
 * @returns {string[]} Sorted, deduplicated list of collection names
 */
export function collectionsForSite(siteType, businessTypes = []) {
  const set = new Set(BASE_COLLECTIONS);

  for (const c of BY_SITE_TYPE[siteType] ?? []) {
    set.add(c);
  }

  for (const bt of businessTypes) {
    for (const c of BY_BUSINESS_TYPE[bt] ?? []) {
      set.add(c);
    }
  }

  return [...set].sort();
}

/**
 * Parse .site-config (KEY=VALUE lines) into an object.
 * @param {string} text - File contents
 * @returns {Record<string, string>}
 */
export function parseSiteConfig(text) {
  const config = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    config[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return config;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Prune unused collections from a scaffolded project.
 * @param {string} projectDir - Absolute path to the project directory
 * @returns {{ kept: string[], removed: string[], removedPages: string[] }}
 */
export function pruneCollections(projectDir) {
  const configPath = join(projectDir, ".site-config");
  if (!existsSync(configPath)) {
    throw new Error(`No .site-config found in ${projectDir}`);
  }

  const config = parseSiteConfig(readFileSync(configPath, "utf-8"));
  const siteType = config.SITE_TYPE;
  if (!siteType) {
    throw new Error("SITE_TYPE not set in .site-config");
  }

  const businessTypes = config.BUSINESS_TYPE
    ? config.BUSINESS_TYPE.split(",").map((s) => s.trim())
    : [];

  const needed = new Set(collectionsForSite(siteType, businessTypes));
  const toRemove = ALL_COLLECTIONS.filter((c) => !needed.has(c));

  const removed = [];
  const removedPages = [];

  for (const name of toRemove) {
    // Remove content directory
    const dir = join(projectDir, "src", "content", name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    }

    // Remove associated pages
    for (const page of COLLECTION_PAGES[name] ?? []) {
      const pagePath = join(projectDir, page);
      if (existsSync(pagePath)) {
        rmSync(pagePath);
        removedPages.push(page);
      }
    }
  }

  // Clean up empty page directories (e.g. src/pages/menu/, src/pages/lab/)
  for (const subdir of ["src/pages/menu", "src/pages/lab"]) {
    const full = join(projectDir, subdir);
    if (existsSync(full)) {
      const entries = readdirSync(full);
      if (entries.length === 0) {
        rmSync(full, { recursive: true });
      }
    }
  }

  // Update anglesite.config.json
  const manifestPath = join(projectDir, "anglesite.config.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.keystatic.collections = manifest.keystatic.collections.filter(
      (c) => needed.has(c),
    );
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  return { kept: [...needed].sort(), removed, removedPages };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  const projectDir = process.argv[2] || process.cwd();
  try {
    const result = pruneCollections(projectDir);
    if (result.removed.length === 0) {
      console.log("No collections to prune.");
    } else {
      console.log(`Pruned ${result.removed.length} collection(s): ${result.removed.join(", ")}`);
      if (result.removedPages.length > 0) {
        console.log(`Removed ${result.removedPages.length} page(s): ${result.removedPages.join(", ")}`);
      }
      console.log(`Kept: ${result.kept.join(", ")}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
