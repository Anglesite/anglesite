// Run: npx tsx --test scripts/themes.test.ts
//
// Guards the themes.json → THEMES re-export (themes.ts). The app side has its own
// drift guard (AnglesiteCoreTests/ThemeCatalogTests decodes the same JSON); this is
// the template-side counterpart so a themes.json edit that breaks the JS shape is
// caught here rather than relying on astro check's structural typing alone.
import test from "node:test";
import assert from "node:assert/strict";
import { THEMES, THEME_RECORDS } from "./themes";
import themesData from "./themes.json";

const EXPECTED_IDS = [
  "classic",
  "elegant",
  "warm",
  "bold",
  "community",
  "studio",
  "coastal",
  "minimal",
];

const REQUIRED_VARS = ["color-primary", "color-accent", "font-heading", "font-body"];

test("THEMES exposes the 8 built-in themes under their expected ids", () => {
  assert.deepEqual(Object.keys(THEMES), EXPECTED_IDS);
});

test("themes.json ids are unique (a duplicate would silently collide in Object.fromEntries)", () => {
  const ids = themesData.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in themes.json: ${ids.join(", ")}`);
  // And the derived record kept every entry — nothing was swallowed by a key collision.
  assert.equal(Object.keys(THEMES).length, themesData.length);
});

test("every theme is complete: displayName, description, bestFor, and required vars", () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.ok(theme.displayName.length > 0, `${id}: empty displayName`);
    assert.ok(theme.description.length > 0, `${id}: empty description`);
    assert.ok(theme.bestFor.length > 0, `${id}: empty bestFor`);
    for (const tag of theme.bestFor) {
      assert.ok(tag.length > 0, `${id}: empty bestFor entry`);
    }
    for (const key of REQUIRED_VARS) {
      const value = theme.vars[key];
      assert.ok(value !== undefined && value.length > 0, `${id}: missing or empty --${key}`);
    }
  }
});

const ALLOWED_CATEGORIES = ["business", "personal", "blog", "portfolio", "organization"];

test("pack entries are complete: category, thumbnail, and credit are all present", () => {
  for (const theme of THEME_RECORDS) {
    if (theme.category !== undefined) {
      assert.ok(ALLOWED_CATEGORIES.includes(theme.category),
        `${theme.id}: unknown category "${theme.category}"`);
    }
    if (theme.pack !== undefined) {
      assert.ok(theme.category, `${theme.id}: pack entry missing category`);
      assert.ok(theme.thumbnail, `${theme.id}: pack entry missing thumbnail`);
      assert.ok(theme.credit?.name && theme.credit?.url && theme.credit?.license,
        `${theme.id}: pack entry missing credit name/url/license`);
    }
  }
});
