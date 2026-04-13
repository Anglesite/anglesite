/**
 * WCAG 2.2 contrast-ratio utilities.
 *
 * Pure functions — no I/O, no dependencies.
 * Used by the design-interview, check, and deploy skills to validate
 * that color palettes meet accessibility requirements.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse a hex color string to RGB. Returns null for invalid input. */
export function hexToRgb(hex: string): Rgb | null {
  let h = hex.replace(/^#/, "");

  // Expand 3-digit shorthand: "f00" → "ff0000"
  if (/^[0-9a-f]{3}$/i.test(h)) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  if (!/^[0-9a-f]{6}$/i.test(h)) return null;

  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Relative luminance per WCAG 2.2 §1.4.3.
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function relativeLuminance(rgb: Rgb): number {
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Contrast ratio between two hex colors (always ≥ 1). */
export function contrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return NaN;

  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Does the pair meet WCAG AA for normal text (4.5:1)? */
export function meetsWcagAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

/** Does the pair meet WCAG AA for large text (3:1)? */
export function meetsWcagAALarge(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 3;
}

function rgbToHex(rgb: Rgb): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Suggest a readable foreground color by darkening or lightening
 * until WCAG AA (4.5:1) is met against the given background.
 * Returns the original hex if it already passes.
 */
export function suggestReadable(fg: string, bg: string): string {
  if (meetsWcagAA(fg, bg)) return fg;

  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return fg;

  const bgLum = relativeLuminance(bgRgb);
  // Darken if background is light, lighten if background is dark
  const shouldDarken = bgLum > 0.5;

  let best = { ...fgRgb };
  for (let step = 1; step <= 255; step++) {
    const delta = shouldDarken ? -step : step;
    const candidate: Rgb = {
      r: Math.max(0, Math.min(255, fgRgb.r + delta)),
      g: Math.max(0, Math.min(255, fgRgb.g + delta)),
      b: Math.max(0, Math.min(255, fgRgb.b + delta)),
    };
    const hex = rgbToHex(candidate);
    if (meetsWcagAA(hex, rgbToHex(bgRgb))) {
      best = candidate;
      break;
    }
  }

  return rgbToHex(best);
}
