// Design axis inference from extracted Canva tokens.
//
// Bridges Canva's extracted color roles and font families into Anglesite's
// five design axes (temperature, weight, register, time, voice). These axes
// seed design.json and drive CSS custom property generation via design.ts.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { mapToSystemStack } from "./canva-fonts.mjs";
import { saturation } from "../import/wix/color-utils.mjs";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a hex color to its HSL hue (0–360).
 * Returns null if hex is invalid.
 *
 * @param {string} hex - e.g. "#e06030"
 * @returns {number | null}
 */
function hue(hex) {
  if (!hex || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0; // achromatic

  let h;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }

  h = h * 60;
  if (h < 0) h += 360;
  return h;
}

/**
 * Clamp a value to [0, 1].
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Axis inference rules
// ---------------------------------------------------------------------------

/**
 * Infer temperature (cool=0, warm=1) from primary color hue.
 *
 * Warm hues (0–60 or 300–360): 0.6–0.9
 * Cool hues (150–270):          0.1–0.4
 * Transition zones:             0.5
 * No primary:                   0.5
 *
 * @param {string|null} primary
 * @returns {number}
 */
function inferTemperature(primary) {
  if (!primary) return 0.5;

  const h = hue(primary);
  if (h === null) return 0.5;

  // Warm zone: reds, oranges, yellows (0–60) and magentas/pinks (300–360)
  if (h >= 0 && h <= 60) {
    // Scale 0.6–0.9 linearly within the warm zone
    // h=0 (red) → 0.9, h=30 (orange) → 0.75, h=60 (yellow) → 0.6
    return clamp01(0.9 - (h / 60) * 0.3);
  }
  if (h >= 300 && h <= 360) {
    // Magentas/pinks: mirror of warm side
    // h=300 (magenta) → 0.6, h=360 (red) → 0.9
    return clamp01(0.6 + ((h - 300) / 60) * 0.3);
  }

  // Cool zone: greens through blues (150–270)
  if (h >= 150 && h <= 270) {
    // h=150 (cyan-green) → 0.4, h=210 (blue) → 0.25, h=270 (violet-blue) → 0.1
    return clamp01(0.4 - ((h - 150) / 120) * 0.3);
  }

  // Transition zones: 60–150 (yellow-green to cyan) and 270–300 (violet to magenta)
  return 0.5;
}

/**
 * Infer weight (airy=0, dense=1).
 *
 * No reliable signal from tokens alone — always returns the neutral default.
 *
 * @returns {number}
 */
function inferWeight() {
  return 0.45;
}

/**
 * Infer register (playful=0, authoritative=1) from the first font category.
 *
 * serif or slab-serif → 0.7
 * otherwise           → 0.4
 * no fonts            → 0.5
 *
 * @param {string[]} fonts
 * @returns {number}
 */
function inferRegister(fonts) {
  if (!fonts || fonts.length === 0) return 0.5;

  const { category } = mapToSystemStack(fonts[0]);
  if (category === "serif" || category === "slab-serif") {
    return 0.7;
  }
  return 0.4;
}

/**
 * Time score for a font category.
 *
 * @param {string} category
 * @returns {number}
 */
function timeCategoryScore(category) {
  const MAP = {
    "serif": 0.2,
    "slab-serif": 0.35,
    "default-sans": 0.5,
    "humanist-sans": 0.65,
    "geometric-sans": 0.8,
    "monospace": 0.5,
  };
  return MAP[category] ?? 0.5;
}

/**
 * Infer time (classic=0, contemporary=1) by averaging font category scores.
 *
 * serif         → 0.2
 * slab-serif    → 0.35
 * default-sans  → 0.5
 * humanist-sans → 0.65
 * geometric-sans→ 0.8
 * monospace     → 0.5
 *
 * No fonts → 0.5
 *
 * @param {string[]} fonts
 * @returns {number}
 */
function inferTime(fonts) {
  if (!fonts || fonts.length === 0) return 0.5;

  const scores = fonts.map((f) => {
    const { category } = mapToSystemStack(f);
    return timeCategoryScore(category);
  });

  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return clamp01(avg);
}

/**
 * Infer voice (subtle=0, bold=1) from average saturation of primary + accent.
 *
 * average saturation × 1.2, clamped to [0, 1].
 * No saturated colors → 0.5
 *
 * @param {string|null} primary
 * @param {string|null} accent
 * @returns {number}
 */
function inferVoice(primary, accent) {
  const colors = [primary, accent].filter(Boolean);
  if (colors.length === 0) return 0.5;

  const saturations = colors.map((c) => saturation(c));
  const avgSat = saturations.reduce((sum, s) => sum + s, 0) / saturations.length;

  // All grays (saturation ≈ 0) → neutral default
  if (avgSat === 0) return 0.5;

  return clamp01(avgSat * 1.2);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ColorRoles
 * @property {string|null} primary
 * @property {string|null} accent
 * @property {string|null} background
 * @property {string|null} text
 */

/**
 * @typedef {Object} InferAxesInput
 * @property {ColorRoles} colorRoles
 * @property {string[]} fonts
 */

/**
 * @typedef {Object} DesignAxes
 * @property {number} temperature  cool(0) ↔ warm(1)
 * @property {number} weight       airy(0) ↔ dense(1)
 * @property {number} register     playful(0) ↔ authoritative(1)
 * @property {number} time         classic(0) ↔ contemporary(1)
 * @property {number} voice        subtle(0) ↔ bold(1)
 */

/**
 * Infer Anglesite's five design axes from extracted Canva tokens.
 *
 * @param {InferAxesInput} input
 * @returns {DesignAxes}
 */
export function inferAxes({ colorRoles, fonts }) {
  const { primary, accent } = colorRoles ?? {};

  return {
    temperature: inferTemperature(primary ?? null),
    weight: inferWeight(),
    register: inferRegister(fonts ?? []),
    time: inferTime(fonts ?? []),
    voice: inferVoice(primary ?? null, accent ?? null),
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main() {
  const [file] = process.argv.slice(2);

  if (!file) {
    console.error("Usage: node infer-axes.mjs <extraction.json>");
    console.error("  extraction.json is the saved output of canva-playwright.mjs");
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(readFileSync(file, "utf8"));
  const tokens = data.tokens ?? data;
  const colorRoles = tokens.colors ?? {};
  const fonts = tokens.fonts ?? [];

  console.log(JSON.stringify(inferAxes({ colorRoles, fonts }), null, 2));
}

// Only run CLI when executed directly (rename-proof, unlike an endsWith check)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
