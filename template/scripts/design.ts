/**
 * Axis-based design system generator.
 *
 * Derives a complete design system (colors, typography, spacing, shape)
 * from five design axes (0–1 floats) and an optional brand color anchor.
 *
 * Used by the design-interview skill and the start skill.
 */

import { hexToRgb, meetsWcagAA, suggestReadable } from "./contrast.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Five design axes, each a float 0–1. */
export interface DesignAxes {
  /** Cool (0) ↔ Warm (1) */
  temperature: number;
  /** Airy (0) ↔ Dense (1) */
  weight: number;
  /** Playful (0) ↔ Authoritative (1) */
  register: number;
  /** Classic (0) ↔ Contemporary (1) */
  time: number;
  /** Subtle (0) ↔ Bold (1) */
  voice: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Returns true if all five axes are numbers in [0, 1]. */
export function validateAxes(axes: DesignAxes): boolean {
  const keys: (keyof DesignAxes)[] = [
    "temperature",
    "weight",
    "register",
    "time",
    "voice",
  ];
  return keys.every((k) => {
    const v = axes[k];
    return typeof v === "number" && !Number.isNaN(v) && v >= 0 && v <= 1;
  });
}

// ---------------------------------------------------------------------------
// Business type → default axes
// ---------------------------------------------------------------------------

const BUSINESS_AXES: Record<string, DesignAxes> = {
  // Warm & approachable
  restaurant:   { temperature: 0.75, weight: 0.45, register: 0.3,  time: 0.4,  voice: 0.5  },
  bakery:       { temperature: 0.8,  weight: 0.35, register: 0.25, time: 0.3,  voice: 0.45 },
  brewery:      { temperature: 0.7,  weight: 0.55, register: 0.35, time: 0.45, voice: 0.55 },
  hospitality:  { temperature: 0.7,  weight: 0.4,  register: 0.4,  time: 0.35, voice: 0.4  },
  campground:   { temperature: 0.65, weight: 0.4,  register: 0.3,  time: 0.3,  voice: 0.45 },

  // Cool & authoritative
  accounting:   { temperature: 0.2,  weight: 0.4,  register: 0.8,  time: 0.3,  voice: 0.3  },
  insurance:    { temperature: 0.25, weight: 0.45, register: 0.75, time: 0.35, voice: 0.3  },
  "credit-union": { temperature: 0.3, weight: 0.4, register: 0.7,  time: 0.4,  voice: 0.35 },
  "real-estate": { temperature: 0.35, weight: 0.45, register: 0.65, time: 0.5, voice: 0.45 },

  // Clean & fresh
  healthcare:   { temperature: 0.35, weight: 0.3,  register: 0.6,  time: 0.6,  voice: 0.3  },
  pharmacy:     { temperature: 0.3,  weight: 0.35, register: 0.65, time: 0.55, voice: 0.25 },
  cleaning:     { temperature: 0.35, weight: 0.3,  register: 0.5,  time: 0.6,  voice: 0.35 },
  grocery:      { temperature: 0.45, weight: 0.4,  register: 0.4,  time: 0.5,  voice: 0.4  },

  // Bold & energetic
  fitness:      { temperature: 0.45, weight: 0.7,  register: 0.55, time: 0.7,  voice: 0.8  },
  trades:       { temperature: 0.4,  weight: 0.65, register: 0.6,  time: 0.5,  voice: 0.7  },
  "auto-dealer": { temperature: 0.35, weight: 0.7, register: 0.6,  time: 0.6,  voice: 0.75 },
  "car-wash":   { temperature: 0.4,  weight: 0.6,  register: 0.5,  time: 0.6,  voice: 0.65 },
  plumber:      { temperature: 0.4,  weight: 0.6,  register: 0.55, time: 0.5,  voice: 0.6  },
  electrician:  { temperature: 0.35, weight: 0.6,  register: 0.55, time: 0.55, voice: 0.6  },

  // Earthy & natural
  farm:         { temperature: 0.6,  weight: 0.45, register: 0.4,  time: 0.2,  voice: 0.4  },
  florist:      { temperature: 0.6,  weight: 0.3,  register: 0.3,  time: 0.35, voice: 0.45 },
  hardware:     { temperature: 0.5,  weight: 0.55, register: 0.5,  time: 0.3,  voice: 0.5  },
  veterinarian: { temperature: 0.55, weight: 0.4,  register: 0.45, time: 0.4,  voice: 0.4  },

  // Playful & expressive
  childcare:    { temperature: 0.7,  weight: 0.3,  register: 0.15, time: 0.6,  voice: 0.7  },
  "pet-services": { temperature: 0.65, weight: 0.35, register: 0.2, time: 0.55, voice: 0.65 },
  "dance-studio": { temperature: 0.6, weight: 0.3, register: 0.2,  time: 0.65, voice: 0.7  },
  "youth-org":  { temperature: 0.6,  weight: 0.35, register: 0.25, time: 0.6,  voice: 0.6  },
  entertainment: { temperature: 0.55, weight: 0.4, register: 0.2,  time: 0.65, voice: 0.75 },

  // Elegant & refined
  salon:        { temperature: 0.4,  weight: 0.3,  register: 0.65, time: 0.7,  voice: 0.5  },
  photography:  { temperature: 0.35, weight: 0.25, register: 0.6,  time: 0.7,  voice: 0.55 },
  jewelry:      { temperature: 0.3,  weight: 0.25, register: 0.7,  time: 0.6,  voice: 0.45 },
  "community-theater": { temperature: 0.45, weight: 0.35, register: 0.55, time: 0.5, voice: 0.55 },
  hotel:        { temperature: 0.4,  weight: 0.35, register: 0.7,  time: 0.55, voice: 0.4  },

  // Community & inclusive
  nonprofit:    { temperature: 0.55, weight: 0.4,  register: 0.4,  time: 0.5,  voice: 0.45 },
  "house-of-worship": { temperature: 0.6, weight: 0.4, register: 0.45, time: 0.3, voice: 0.4 },
  "social-services": { temperature: 0.55, weight: 0.4, register: 0.45, time: 0.5, voice: 0.4 },
  "food-bank":  { temperature: 0.6,  weight: 0.4,  register: 0.35, time: 0.45, voice: 0.45 },
  "animal-shelter": { temperature: 0.6, weight: 0.35, register: 0.3, time: 0.5, voice: 0.5 },
};

const DEFAULT_AXES: DesignAxes = {
  temperature: 0.5,
  weight: 0.4,
  register: 0.5,
  time: 0.5,
  voice: 0.4,
};

/** Get default axis positions for a business type. */
export function axesFromBusinessType(businessType: string): DesignAxes {
  if (!businessType) return { ...DEFAULT_AXES };
  const type = businessType.toLowerCase().split(",")[0].trim();
  const match = BUSINESS_AXES[type];
  return match ? { ...match } : { ...DEFAULT_AXES };
}

// ---------------------------------------------------------------------------
// Color palette generation
// ---------------------------------------------------------------------------

export interface Palette {
  brand: string;
  accent: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
}

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to hex. */
function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Convert hex to HSL. Returns [h, s, l] where h is 0-360, s and l are 0-1. */
function hexToHsl(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [0, 0, 0.5];
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/**
 * Map the temperature axis (0=cool, 1=warm) to a base hue.
 * Cool → blue/teal (200-210), Warm → orange/terracotta (15-35).
 * Middle → green/teal transitional hues.
 */
function temperatureToHue(t: number): number {
  // Piecewise: 0→210 (blue), 0.5→160 (teal), 1→25 (warm orange)
  if (t <= 0.5) return 210 - t * 100; // 210→160
  return 160 - (t - 0.5) * 270; // 160→25
}

/**
 * Deterministic palette generation from design axes.
 * If brandColor is provided, it becomes the brand color and the rest is derived.
 */
export function generatePalette(axes: DesignAxes, brandColor?: string): Palette {
  const isDarkMode = axes.weight > 0.75 && axes.voice > 0.7;

  let brandH: number, brandS: number, brandL: number;

  if (brandColor && hexToRgb(brandColor)) {
    [brandH, brandS, brandL] = hexToHsl(brandColor);
  } else {
    brandH = temperatureToHue(axes.temperature);
    // Saturation: playful/bold = higher, authoritative/subtle = lower
    brandS = 0.45 + (1 - axes.register) * 0.2 + axes.voice * 0.15;
    brandS = Math.min(0.85, Math.max(0.35, brandS));
    // Lightness: moderate, slightly darker for authoritative
    brandL = 0.42 - axes.register * 0.08;
  }

  const brand = brandColor && hexToRgb(brandColor)
    ? brandColor
    : hslToHex(brandH, brandS, brandL);

  // Accent: complementary or analogous based on voice
  const accentOffset = axes.voice > 0.5 ? 180 : 40; // complementary for bold, analogous for subtle
  const accentH = (brandH + accentOffset) % 360;
  const accentS = Math.min(0.8, brandS + 0.05);
  const accentL = 0.45 + axes.voice * 0.1;
  const accent = hslToHex(accentH, accentS, accentL);

  let bg: string, surface: string, text: string, muted: string, border: string;

  if (isDarkMode) {
    // Dark mode for bold/dense designs
    bg = hslToHex(brandH, 0.15, 0.08 + axes.temperature * 0.04);
    surface = hslToHex(brandH, 0.12, 0.12 + axes.temperature * 0.04);
    text = hslToHex(brandH, 0.05, 0.92);
    muted = hslToHex(brandH, 0.08, 0.6);
    border = hslToHex(brandH, 0.1, 0.2);
  } else {
    // Light mode
    // Surface warmth follows temperature axis
    const surfaceH = brandH;
    const surfaceS = 0.05 + axes.temperature * 0.1;
    bg = hslToHex(surfaceH, surfaceS, 0.99 - axes.temperature * 0.02);
    surface = hslToHex(surfaceH, surfaceS + 0.02, 0.96 - axes.temperature * 0.02);
    text = hslToHex(brandH, 0.1 + axes.temperature * 0.05, 0.1 + axes.weight * 0.03);
    muted = hslToHex(brandH, 0.05, 0.42 + axes.weight * 0.05);
    border = hslToHex(surfaceH, surfaceS + 0.03, 0.88 - axes.weight * 0.05);
  }

  // Ensure WCAG AA compliance for text on bg
  text = suggestReadable(text, bg);
  muted = suggestReadable(muted, bg);

  return { brand, accent, bg, surface, text, muted, border };
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export interface Typography {
  display: string;
  body: string;
  pairing: string;
}

/**
 * Curated font pairings mapped to axis regions.
 * Each pairing is a [display, body, name] tuple.
 * System font stacks only — no external CDN loading.
 */
const FONT_PAIRINGS: Array<{
  display: string;
  body: string;
  pairing: string;
  /** Score function: higher = better match for these axes */
  score: (axes: DesignAxes) => number;
}> = [
  {
    display: 'Georgia, "Times New Roman", Times, serif',
    body: "system-ui, -apple-system, sans-serif",
    pairing: "classic-serif+modern-sans",
    score: (a) => (1 - a.time) * 2 + a.register * 1.5 + (1 - a.voice) * 0.5,
  },
  {
    display: "system-ui, -apple-system, sans-serif",
    body: "system-ui, -apple-system, sans-serif",
    pairing: "modern-sans+modern-sans",
    score: (a) => a.time * 1.5 + (1 - a.register) * 1 + a.voice * 0.5,
  },
  {
    display: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    body: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    pairing: "humanist-sans+humanist-sans",
    score: (a) => a.temperature * 1.5 + (1 - a.register) * 1 + (1 - a.voice) * 0.5,
  },
  {
    display: 'Georgia, "Times New Roman", Times, serif',
    body: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    pairing: "classic-serif+humanist-sans",
    score: (a) => (1 - a.time) * 1.5 + a.register * 1 + a.temperature * 0.8,
  },
  {
    display: "system-ui, -apple-system, sans-serif",
    body: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    pairing: "modern-sans+humanist-sans",
    score: (a) => a.time * 1 + a.temperature * 0.8 + (1 - a.register) * 0.8,
  },
];

/** Select the best font pairing for the given axes. */
export function generateTypography(axes: DesignAxes): Typography {
  let best = FONT_PAIRINGS[0];
  let bestScore = -Infinity;
  for (const p of FONT_PAIRINGS) {
    const s = p.score(axes);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return { display: best.display, body: best.body, pairing: best.pairing };
}

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export interface Spacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

/**
 * Generate spacing scale based on the weight axis.
 * Airy (low weight) → generous spacing. Dense (high weight) → tighter spacing.
 */
export function generateSpacing(axes: DesignAxes): Spacing {
  // Base multiplier: airy (weight=0) → 1.2, dense (weight=1) → 0.8
  const m = 1.2 - axes.weight * 0.4;
  const fmt = (v: number) => `${Math.round(v * 1000) / 1000}rem`;
  return {
    xs: fmt(0.25 * m),
    sm: fmt(0.5 * m),
    md: fmt(1 * m),
    lg: fmt(2 * m),
    xl: fmt(4 * m),
  };
}

// ---------------------------------------------------------------------------
// Shape (border-radius, shadows)
// ---------------------------------------------------------------------------

export interface Shape {
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  shadowSm: string;
  shadowMd: string;
}

/**
 * Generate shape tokens from axes.
 * Playful/contemporary → rounder. Authoritative/classic → sharper.
 * Airy → softer shadows. Dense → stronger shadows.
 */
export function generateShape(axes: DesignAxes): Shape {
  // Roundness: playful (low register) + contemporary (high time) = rounder
  const roundness = (1 - axes.register) * 0.6 + axes.time * 0.4;
  const rSm = 0.125 + roundness * 0.25;
  const rMd = 0.25 + roundness * 0.5;
  const rLg = 0.5 + roundness * 1.0;

  // Shadow opacity: bold = stronger
  const shadowAlpha = 0.06 + axes.voice * 0.08;
  const shadowSpread = 2 + axes.weight * 4;

  const fmt = (v: number) => `${Math.round(v * 1000) / 1000}rem`;

  return {
    radiusSm: fmt(rSm),
    radiusMd: fmt(rMd),
    radiusLg: fmt(rLg),
    shadowSm: `0 1px ${Math.round(shadowSpread)}px rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`,
    shadowMd: `0 ${Math.round(shadowSpread)}px ${Math.round(shadowSpread * 3)}px rgba(0, 0, 0, ${(shadowAlpha * 1.5).toFixed(2)})`,
  };
}

// ---------------------------------------------------------------------------
// Design config
// ---------------------------------------------------------------------------

export interface DesignConfig {
  axes: DesignAxes;
  palette: Palette;
  typography: Typography;
  spacing: Spacing;
  shape: Shape;
  siteType: string;
  brandColor?: string;
  generatedAt: string;
}

/** Assemble a complete design config from axes, site type, and optional brand color. */
export function createDesignConfig(
  axes: DesignAxes,
  siteType: string,
  brandColor?: string,
): DesignConfig {
  return {
    axes: { ...axes },
    palette: generatePalette(axes, brandColor),
    typography: generateTypography(axes),
    spacing: generateSpacing(axes),
    shape: generateShape(axes),
    siteType,
    brandColor,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Incremental axis adjustment
// ---------------------------------------------------------------------------

/** Apply deltas to axes, clamping results to [0, 1]. */
export function adjustAxes(
  axes: DesignAxes,
  deltas: Partial<DesignAxes>,
): DesignAxes {
  const result = { ...axes };
  for (const key of Object.keys(deltas) as (keyof DesignAxes)[]) {
    const delta = deltas[key];
    if (typeof delta === "number") {
      result[key] = Math.max(0, Math.min(1, axes[key] + delta));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Token CSS generation
// ---------------------------------------------------------------------------

/** Generate a complete tokens.css file from a design config. */
export function designToTokensCss(config: DesignConfig): string {
  const { palette, typography, spacing, shape } = config;

  const lines = [
    "/* Generated by Anglesite — edit freely */",
    ":root {",
    "  /* Colors */",
    `  --color-brand: ${palette.brand};`,
    `  --color-accent: ${palette.accent};`,
    `  --color-bg: ${palette.bg};`,
    `  --color-surface: ${palette.surface};`,
    `  --color-text: ${palette.text};`,
    `  --color-muted: ${palette.muted};`,
    `  --color-border: ${palette.border};`,
    "",
    "  /* Typography */",
    `  --font-display: ${typography.display};`,
    `  --font-body: ${typography.body};`,
    "",
    "  /* Type scale (1.25 ratio) */",
    "  --font-size-sm: 0.8rem;",
    "  --font-size-base: 1rem;",
    "  --font-size-lg: 1.25rem;",
    "  --font-size-xl: 1.563rem;",
    "  --font-size-2xl: 1.953rem;",
    "  --font-size-3xl: 2.441rem;",
    "  --font-size-4xl: 3.052rem;",
    "",
    "  /* Spacing */",
    `  --space-xs: ${spacing.xs};`,
    `  --space-sm: ${spacing.sm};`,
    `  --space-md: ${spacing.md};`,
    `  --space-lg: ${spacing.lg};`,
    `  --space-xl: ${spacing.xl};`,
    "",
    "  /* Shape */",
    `  --radius-sm: ${shape.radiusSm};`,
    `  --radius-md: ${shape.radiusMd};`,
    `  --radius-lg: ${shape.radiusLg};`,
    `  --shadow-sm: ${shape.shadowSm};`,
    `  --shadow-md: ${shape.shadowMd};`,
    "}",
    "",
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// DESIGN.md rationale generation
// ---------------------------------------------------------------------------

/** Describe a 0–1 axis value in plain English. */
function describeAxis(value: number): string {
  if (value <= 0.2) return "strongly low";
  if (value <= 0.4) return "leaning low";
  if (value <= 0.6) return "balanced";
  if (value <= 0.8) return "leaning high";
  return "strongly high";
}

function axisLabel(axis: keyof DesignAxes, value: number): string {
  const labels: Record<keyof DesignAxes, [string, string]> = {
    temperature: ["cool", "warm"],
    weight: ["airy", "dense"],
    register: ["playful", "authoritative"],
    time: ["classic", "contemporary"],
    voice: ["subtle", "bold"],
  };
  const [low, high] = labels[axis];
  if (value <= 0.4) return low;
  if (value >= 0.6) return high;
  return `between ${low} and ${high}`;
}

/** Generate a human-readable DESIGN.md rationale from a design config. */
export function generateDesignRationale(config: DesignConfig): string {
  const { axes, palette, typography, siteType } = config;

  const moodWords = [
    axisLabel("temperature", axes.temperature),
    axisLabel("weight", axes.weight),
    axisLabel("register", axes.register),
    axisLabel("time", axes.time),
    axisLabel("voice", axes.voice),
  ].filter((w, i, a) => a.indexOf(w) === i); // dedupe

  const lines = [
    "# Your Design System",
    "",
    "## What we're going for",
    "",
    `The feel is **${moodWords.join(", ")}** — designed for a ${siteType.replace(/-/g, " ")}.`,
    "",
    "## Design axes",
    "",
    "These five axes position your design. Each is a value from 0 to 1.",
    "",
    "| Axis | Value | Reading |",
    "|------|-------|---------|",
    `| Temperature (cool ↔ warm) | ${axes.temperature} | ${axisLabel("temperature", axes.temperature)} |`,
    `| Weight (airy ↔ dense) | ${axes.weight} | ${axisLabel("weight", axes.weight)} |`,
    `| Register (playful ↔ authoritative) | ${axes.register} | ${axisLabel("register", axes.register)} |`,
    `| Time (classic ↔ contemporary) | ${axes.time} | ${axisLabel("time", axes.time)} |`,
    `| Voice (subtle ↔ bold) | ${axes.voice} | ${axisLabel("voice", axes.voice)} |`,
    "",
    "## Color",
    "",
    `Your brand color is \`${palette.brand}\`. ` +
      `The accent color \`${palette.accent}\` provides contrast for calls to action. ` +
      `The surface color \`${palette.surface}\` and background \`${palette.bg}\` ` +
      `set a ${axes.temperature > 0.5 ? "warm" : "cool"} foundation.`,
    "",
    `Text color \`${palette.text}\` on background \`${palette.bg}\` ` +
      "meets WCAG AA contrast requirements for readability.",
    "",
    "## Typography",
    "",
    `Display font: \`${typography.display.split(",")[0].replace(/"/g, "")}\` — ` +
      `${axes.register > 0.5 ? "conveys authority and expertise" : "feels approachable and friendly"}.`,
    "",
    `Body font: \`${typography.body.split(",")[0].replace(/"/g, "")}\` — ` +
      "optimized for comfortable reading at body text sizes.",
    "",
    `Pairing strategy: ${typography.pairing.replace(/-/g, " ").replace(/\+/g, " + ")}.`,
    "",
    "## To adjust",
    "",
    "You can nudge these axes without re-running the full interview:",
    "",
    `- Want it warmer? Increase \`temperature\` above ${axes.temperature}.`,
    `- Want more authority? Increase \`register\` above ${axes.register}.`,
    `- Want more whitespace? Decrease \`weight\` below ${axes.weight}.`,
    `- Want it more modern? Increase \`time\` above ${axes.time}.`,
    `- Want it louder? Increase \`voice\` above ${axes.voice}.`,
    "",
    "Edit `src/design/design.json` and Anglesite will regenerate the tokens.",
    "",
  ];

  return lines.join("\n");
}
