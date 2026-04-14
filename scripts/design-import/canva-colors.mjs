// Color extraction utilities for Canva design import.
//
// Canva published sites apply colors as inline rgb()/rgba() on style attributes
// rather than CSS custom properties. These functions parse, rank, and classify
// those colors into Anglesite design token roles.

import {
  rgbToHex,
  luminance,
  isGray,
  isBrowserDefault,
} from '../import/wix/color-utils.mjs';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse rgb() and rgba() values from an array of inline style strings.
 *
 * - Handles `rgb(R, G, B)` and `rgba(R, G, B, A)`.
 * - For rgba(), ignores colors with opacity < 0.5 (nearly transparent).
 * - Returns deduplicated lowercase hex strings.
 *
 * @param {string[]} styles - Array of inline CSS style attribute values.
 * @returns {string[]} Deduplicated hex color strings (e.g. ["#ff0000", "#0080ff"]).
 */
export function parseInlineColors(styles) {
  const seen = new Set();

  // Match both rgb(...) and rgba(...) patterns with optional whitespace.
  const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g;

  for (const style of styles) {
    let match;
    RGB_RE.lastIndex = 0;
    while ((match = RGB_RE.exec(style)) !== null) {
      const r = Number(match[1]);
      const g = Number(match[2]);
      const b = Number(match[3]);
      const alpha = match[4] !== undefined ? Number(match[4]) : 1;

      // Skip colors that are effectively transparent (opacity < 0.5).
      if (alpha < 0.5) continue;

      const hex = rgbToHex(r, g, b);
      seen.add(hex.toLowerCase());
    }
  }

  return [...seen];
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Count occurrences of each hex color and return sorted by frequency descending.
 *
 * @param {string[]} hexList - Array of hex color strings (may contain duplicates).
 * @returns {{ hex: string, count: number }[]} Colors ranked by frequency descending.
 */
export function rankColors(hexList) {
  if (hexList.length === 0) return [];

  const counts = new Map();
  for (const hex of hexList) {
    const key = hex.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex, count]) => ({ hex, count }));
}

// ---------------------------------------------------------------------------
// Role inference
// ---------------------------------------------------------------------------

/**
 * Infer CSS custom property roles from a ranked color list.
 *
 * Roles:
 * - background: highest-luminance non-browser-default color
 * - text: darkest gray (low luminance, low saturation)
 * - primary: most frequent saturated non-gray color
 * - accent: second most frequent saturated non-gray color
 *
 * Returns null for any role that cannot be determined from the input.
 *
 * @param {{ hex: string, count: number }[]} rankedColors - Output of rankColors().
 * @returns {{ background: string|null, text: string|null, primary: string|null, accent: string|null }}
 */
export function inferColorRoles(rankedColors) {
  const roles = {
    background: null,
    text: null,
    primary: null,
    accent: null,
  };

  if (rankedColors.length === 0) return roles;

  // Non-browser-default colors for general use.
  const nonDefault = rankedColors.filter((c) => !isBrowserDefault(c.hex));

  // Background: highest-luminance non-browser-default color.
  if (nonDefault.length > 0) {
    const sorted = [...nonDefault].sort(
      (a, b) => luminance(b.hex) - luminance(a.hex),
    );
    roles.background = sorted[0].hex;
  }

  // Partition into grays and saturated colors (browser defaults already excluded).
  const grays = nonDefault.filter((c) => isGray(c.hex));
  const saturated = nonDefault.filter((c) => !isGray(c.hex));

  // Text: darkest gray (lowest luminance among grays).
  if (grays.length > 0) {
    const darkest = [...grays].sort(
      (a, b) => luminance(a.hex) - luminance(b.hex),
    );
    roles.text = darkest[0].hex;
  }

  // Primary: most frequent saturated color (already ranked by frequency).
  if (saturated.length > 0) {
    roles.primary = saturated[0].hex;
  }

  // Accent: second most frequent saturated color.
  if (saturated.length > 1) {
    roles.accent = saturated[1].hex;
  }

  return roles;
}
