import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

const scriptsDir = resolve(import.meta.dirname!, "..", "scripts", "import");
const wixDir = resolve(scriptsDir, "wix");

// ---------------------------------------------------------------------------
// Regression test for #170: import scripts must use .mjs so Node treats them
// as ESM even without a package.json "type": "module" in ancestor directories.
// The plugin's pack-plugin.sh does not include the root package.json, so
// distributed .js files would be treated as CommonJS and fail on `import`.
// ---------------------------------------------------------------------------

describe("import scripts use .mjs extension", () => {
  it("wix/ directory contains only .mjs scripts", () => {
    const files = readdirSync(wixDir).filter((f) => /\.[cm]?js$/.test(f));
    const nonMjs = files.filter((f) => extname(f) !== ".mjs");
    expect(nonMjs).toEqual([]);
  });

  it("menu-extract uses .mjs extension", () => {
    expect(existsSync(resolve(scriptsDir, "menu-extract.mjs"))).toBe(true);
    expect(existsSync(resolve(scriptsDir, "menu-extract.js"))).toBe(false);
  });

  it("wix-playwright.mjs imports color-utils.mjs (not .js)", () => {
    const src = readFileSync(resolve(wixDir, "wix-playwright.mjs"), "utf-8");
    expect(src).toContain("from './color-utils.mjs'");
    expect(src).not.toContain("from './color-utils.js'");
  });
});
