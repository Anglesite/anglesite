// Color analysis utilities for Wix style extraction.
//
// These pure functions convert, classify, and rank colors sampled from
// a rendered Wix page via getComputedStyle(). They power the design-token
// extraction in wix-playwright.js.

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert RGB to hex. Accepts either (r, g, b) numbers or an "rgb(r, g, b)" string.
 */
export function rgbToHex(rOrStr, g, b) {
  let r;
  if (typeof rOrStr === 'string') {
    const m = rOrStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!m) return rOrStr;
    r = Number(m[1]);
    g = Number(m[2]);
    b = Number(m[3]);
  } else {
    r = rOrStr;
  }
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Perceptual metrics
// ---------------------------------------------------------------------------

/** Relative luminance per WCAG 2.1 (0 = black, 1 = white). */
export function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** HSL saturation (0–1). */
export function saturation(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5
    ? (max - min) / (2 - max - min)
    : (max - min) / (max + min);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** True if a color is perceptually gray (saturation < 0.15). */
export function isGray(hex) {
  return saturation(hex) < 0.15;
}

/** True if a color is a browser default (not a brand color). */
export function isBrowserDefault(hex) {
  const defaults = new Set([
    '#0000ee', // default link blue
    '#551a8b', // default visited purple
    '#000000', // pure black
    '#ffffff', // pure white
  ]);
  return defaults.has(hex.toLowerCase());
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Return the top N colors by frequency, excluding browser defaults.
 */
export function topColors(samples, n) {
  const counts = new Map();
  for (const c of samples) {
    const hex = c.toLowerCase();
    if (isBrowserDefault(hex)) continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([hex]) => hex);
}

// ---------------------------------------------------------------------------
// Token classification
// ---------------------------------------------------------------------------

/**
 * Classify raw color and font samples into Anglesite design tokens.
 *
 * @param {Object} colorSamples - { bg: string[], text: string[], heading: string[] }
 * @param {Object} fontSamples  - { heading: string[], body: string[] }
 * @returns {Object} Token map: { '--color-bg': '#f3f3f3', '--font-heading': '"Open Sans"', ... }
 */
export function classifyTokens(colorSamples, fontSamples) {
  const tokens = {
    '--color-bg': null,
    '--color-text': null,
    '--color-primary': null,
    '--color-accent': null,
    '--color-muted': null,
    '--font-heading': null,
    '--font-body': null,
  };

  // Background: most frequent bg sample
  const bgTop = topColors(colorSamples.bg, 1);
  tokens['--color-bg'] = bgTop[0] || null;

  // Text: most frequent gray from text samples
  const textGrays = colorSamples.text.filter((c) => isGray(c) && !isBrowserDefault(c));
  const textTop = topColors(textGrays, 1);
  tokens['--color-text'] = textTop[0] || null;

  // Heading text: most frequent gray from heading samples (fallback to text)
  const headingGrays = colorSamples.heading.filter((c) => isGray(c) && !isBrowserDefault(c));
  if (headingGrays.length === 0 && textTop[0]) {
    // heading color defaults to text color
  }

  // Brand colors: saturated colors from text samples
  const allTextColors = [...colorSamples.text, ...colorSamples.heading];
  const brandColors = allTextColors.filter((c) => !isGray(c) && !isBrowserDefault(c));
  const brandTop = topColors(brandColors, 2);
  tokens['--color-primary'] = brandTop[0] || null;
  tokens['--color-accent'] = brandTop[1] || null;

  // Muted: second-most-frequent gray (after text color), or first gray that differs
  const allGrays = [...colorSamples.text, ...colorSamples.heading]
    .filter((c) => isGray(c) && !isBrowserDefault(c));
  const grayTop = topColors(allGrays, 2);
  tokens['--color-muted'] = grayTop.find((c) => c !== tokens['--color-text']) || null;

  // Fonts
  const quoteFont = (name) => {
    if (!name) return null;
    return name.includes(' ') ? `"${name}"` : name;
  };

  const headingFontTop = topColors(fontSamples.heading.map((f) => f.toLowerCase()), 1);
  const bodyFontTop = topColors(fontSamples.body.map((f) => f.toLowerCase()), 1);

  // Font names need original casing — find the first match
  if (headingFontTop[0]) {
    const original = fontSamples.heading.find((f) => f.toLowerCase() === headingFontTop[0]);
    tokens['--font-heading'] = quoteFont(original || headingFontTop[0]);
  }
  if (bodyFontTop[0]) {
    const original = fontSamples.body.find((f) => f.toLowerCase() === bodyFontTop[0]);
    tokens['--font-body'] = quoteFont(original || bodyFontTop[0]);
  }

  return tokens;
}
