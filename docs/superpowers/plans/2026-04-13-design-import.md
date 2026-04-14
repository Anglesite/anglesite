# Design Import Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/anglesite:design-import` — a skill that extracts design tokens and page layouts from Canva published sites and generates Astro pages with a seeded design system.

**Architecture:** Playwright scrapes `*.my.canva.site` SPAs to extract inline colors, @font-face fonts, section positions, text content, and images. A layout heuristics module classifies absolute-positioned sections into semantic types (hero, features, etc.). The shared generation pipeline maps tokens to CSS custom properties and assembles classified sections into Astro pages using BaseLayout.

**Tech Stack:** Playwright (browser automation), Node.js ESM scripts, Vitest (tests), existing color-utils.mjs (reuse), existing design.ts (axis inference)

**Spec:** `docs/superpowers/specs/2026-04-13-design-import-design.md`

---

### Task 1: Color extraction utilities for Canva

Extend color analysis to handle Canva's inline `rgb()` patterns. Canva uses `rgb(R, G, B)` on inline style attributes — similar to Wix but without CSS custom properties. We need functions to parse inline styles, deduplicate colors, rank by frequency, and infer color roles (background, primary, accent, text).

**Files:**
- Create: `scripts/design-import/canva-colors.mjs`
- Test: `tests/design-import/canva-colors.test.ts`
- Reuse: `scripts/import/wix/color-utils.mjs` (import `rgbToHex`, `luminance`, `saturation`, `isGray`, `isBrowserDefault`, `topColors`)

- [ ] **Step 1: Write failing test for `parseInlineColors`**

```ts
// tests/design-import/canva-colors.test.ts
import { describe, it, expect } from 'vitest';
import { parseInlineColors } from '../../scripts/design-import/canva-colors.mjs';

describe('parseInlineColors', () => {
  it('extracts rgb() values from inline style strings', () => {
    const styles = [
      'color: rgb(108, 229, 232); font-size: 16px;',
      'background-color: rgb(255, 255, 255);',
      'color: rgb(108, 229, 232);', // duplicate
      'border: 1px solid rgb(65, 184, 213);',
    ];
    const result = parseInlineColors(styles);
    expect(result).toEqual(['#6ce5e8', '#ffffff', '#41b8d5']);
  });

  it('handles rgba() with full opacity as rgb', () => {
    const styles = ['color: rgba(108, 229, 232, 1);'];
    const result = parseInlineColors(styles);
    expect(result).toEqual(['#6ce5e8']);
  });

  it('ignores rgba() with low opacity', () => {
    const styles = ['color: rgba(0, 0, 0, 0);', 'color: rgba(0, 0, 0, 0.1);'];
    const result = parseInlineColors(styles);
    expect(result).toEqual([]);
  });

  it('returns empty array for no colors', () => {
    const styles = ['font-size: 16px;', 'display: flex;'];
    const result = parseInlineColors(styles);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/canva-colors.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `parseInlineColors`**

```js
// scripts/design-import/canva-colors.mjs
import { rgbToHex } from '../import/wix/color-utils.mjs';

/**
 * Parse rgb()/rgba() values from an array of inline style strings.
 * Returns deduplicated hex color array, ordered by first occurrence.
 *
 * @param {string[]} styles - Array of CSS inline style strings
 * @returns {string[]} Deduplicated hex colors
 */
export function parseInlineColors(styles) {
  const seen = new Set();
  const colors = [];

  const rgbRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/g;

  for (const style of styles) {
    let m;
    while ((m = rgbRe.exec(style)) !== null) {
      const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
      if (alpha < 0.5) continue;
      const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
      if (!seen.has(hex)) {
        seen.add(hex);
        colors.push(hex);
      }
    }
  }

  return colors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/canva-colors.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for `inferColorRoles`**

```ts
// Append to tests/design-import/canva-colors.test.ts
import { inferColorRoles } from '../../scripts/design-import/canva-colors.mjs';

describe('inferColorRoles', () => {
  it('assigns roles based on luminance and saturation', () => {
    const colors = [
      { hex: '#ffffff', count: 50 },  // high luminance, high freq -> background
      { hex: '#333333', count: 40 },  // low luminance, gray -> text
      { hex: '#41b8d5', count: 20 },  // saturated, prominent -> primary
      { hex: '#6ce5e8', count: 10 },  // saturated, secondary -> accent
    ];
    const roles = inferColorRoles(colors);
    expect(roles.background).toBe('#ffffff');
    expect(roles.text).toBe('#333333');
    expect(roles.primary).toBe('#41b8d5');
    expect(roles.accent).toBe('#6ce5e8');
  });

  it('handles all-gray palette', () => {
    const colors = [
      { hex: '#f5f5f5', count: 30 },
      { hex: '#333333', count: 20 },
      { hex: '#666666', count: 10 },
    ];
    const roles = inferColorRoles(colors);
    expect(roles.background).toBe('#f5f5f5');
    expect(roles.text).toBe('#333333');
    expect(roles.primary).toBeNull();
    expect(roles.accent).toBeNull();
  });

  it('returns all nulls for empty input', () => {
    const roles = inferColorRoles([]);
    expect(roles.background).toBeNull();
    expect(roles.text).toBeNull();
    expect(roles.primary).toBeNull();
    expect(roles.accent).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/design-import/canva-colors.test.ts`
Expected: FAIL — inferColorRoles not exported

- [ ] **Step 7: Implement `inferColorRoles`**

```js
// Append to scripts/design-import/canva-colors.mjs
import { luminance, saturation, isGray, isBrowserDefault } from '../import/wix/color-utils.mjs';

/**
 * Infer CSS custom property roles from ranked color samples.
 *
 * @param {{ hex: string, count: number }[]} rankedColors - Colors sorted by frequency
 * @returns {{ background: string|null, text: string|null, primary: string|null, accent: string|null }}
 */
export function inferColorRoles(rankedColors) {
  const roles = { background: null, text: null, primary: null, accent: null };

  if (rankedColors.length === 0) return roles;

  // Filter out browser defaults
  const colors = rankedColors.filter((c) => !isBrowserDefault(c.hex));

  // Background: highest-luminance color (page backgrounds are light)
  const byLuminance = [...colors].sort((a, b) => luminance(b.hex) - luminance(a.hex));
  if (byLuminance.length > 0) {
    roles.background = byLuminance[0].hex;
  }

  // Text: darkest gray (low luminance, low saturation)
  const grays = colors.filter((c) => isGray(c.hex));
  const darkGrays = [...grays].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  if (darkGrays.length > 0) {
    roles.text = darkGrays[0].hex;
  }

  // Primary + accent: most frequent saturated (non-gray) colors
  const saturated = colors
    .filter((c) => !isGray(c.hex) && c.hex !== roles.background)
    .sort((a, b) => b.count - a.count);
  if (saturated.length > 0) roles.primary = saturated[0].hex;
  if (saturated.length > 1) roles.accent = saturated[1].hex;

  return roles;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/design-import/canva-colors.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing test for `rankColors`**

```ts
// Append to tests/design-import/canva-colors.test.ts
import { rankColors } from '../../scripts/design-import/canva-colors.mjs';

describe('rankColors', () => {
  it('counts and ranks by frequency', () => {
    const hexList = ['#aaa', '#bbb', '#aaa', '#ccc', '#aaa', '#bbb'];
    const ranked = rankColors(hexList);
    expect(ranked[0]).toEqual({ hex: '#aaa', count: 3 });
    expect(ranked[1]).toEqual({ hex: '#bbb', count: 2 });
    expect(ranked[2]).toEqual({ hex: '#ccc', count: 1 });
  });

  it('returns empty array for empty input', () => {
    expect(rankColors([])).toEqual([]);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run tests/design-import/canva-colors.test.ts`
Expected: FAIL — rankColors not exported

- [ ] **Step 11: Implement `rankColors`**

```js
// Append to scripts/design-import/canva-colors.mjs

/**
 * Count color occurrences and return sorted by frequency (descending).
 *
 * @param {string[]} hexList - Array of hex color strings
 * @returns {{ hex: string, count: number }[]}
 */
export function rankColors(hexList) {
  const counts = new Map();
  for (const hex of hexList) {
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/design-import/canva-colors.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add scripts/design-import/canva-colors.mjs tests/design-import/canva-colors.test.ts
git commit -m "feat(design-import): add Canva color extraction and role inference"
```

---

### Task 2: Font extraction utilities

Extract user-chosen fonts from `@font-face` declarations, filtering out Canva system fonts, and map to system font stacks.

**Files:**
- Create: `scripts/design-import/canva-fonts.mjs`
- Test: `tests/design-import/canva-fonts.test.ts`

- [ ] **Step 1: Write failing test for `parseCanvaFonts`**

```ts
// tests/design-import/canva-fonts.test.ts
import { describe, it, expect } from 'vitest';
import { parseCanvaFonts } from '../../scripts/design-import/canva-fonts.mjs';

describe('parseCanvaFonts', () => {
  it('extracts user fonts and filters Canva system fonts', () => {
    const fontFaceRules = [
      { family: 'Arimo' },
      { family: 'Open Sans' },
      { family: 'Canva Sans' },
      { family: 'Noto Sans' },
      { family: 'Canva Sans Text' },
    ];
    const result = parseCanvaFonts(fontFaceRules);
    expect(result).toEqual(['Arimo', 'Open Sans']);
  });

  it('deduplicates font families', () => {
    const fontFaceRules = [
      { family: 'Arimo' },
      { family: 'Arimo' },
      { family: 'Open Sans' },
    ];
    const result = parseCanvaFonts(fontFaceRules);
    expect(result).toEqual(['Arimo', 'Open Sans']);
  });

  it('returns empty array when only system fonts present', () => {
    const fontFaceRules = [
      { family: 'Canva Sans' },
      { family: 'Noto Sans' },
    ];
    const result = parseCanvaFonts(fontFaceRules);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/canva-fonts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `parseCanvaFonts`**

```js
// scripts/design-import/canva-fonts.mjs

const CANVA_SYSTEM_FONTS = new Set([
  'canva sans',
  'canva sans text',
  'canva sans display',
  'noto sans',
  'noto serif',
  'noto color emoji',
]);

/**
 * Extract user-chosen fonts from @font-face declarations, filtering
 * out Canva's built-in system fonts.
 *
 * @param {{ family: string }[]} fontFaceRules - Parsed @font-face declarations
 * @returns {string[]} Deduplicated user font family names
 */
export function parseCanvaFonts(fontFaceRules) {
  const seen = new Set();
  const fonts = [];

  for (const rule of fontFaceRules) {
    const family = rule.family.trim();
    const lower = family.toLowerCase();
    if (CANVA_SYSTEM_FONTS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    fonts.push(family);
  }

  return fonts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/canva-fonts.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for `mapToSystemStack`**

```ts
// Append to tests/design-import/canva-fonts.test.ts
import { mapToSystemStack } from '../../scripts/design-import/canva-fonts.mjs';

describe('mapToSystemStack', () => {
  it('maps geometric sans to system sans stack', () => {
    const result = mapToSystemStack('Montserrat');
    expect(result.stack).toContain('system-ui');
    expect(result.category).toBe('geometric-sans');
  });

  it('maps humanist sans to humanist stack', () => {
    const result = mapToSystemStack('Open Sans');
    expect(result.stack).toContain('system-ui');
    expect(result.category).toBe('humanist-sans');
  });

  it('maps serif font to serif stack', () => {
    const result = mapToSystemStack('Playfair Display');
    expect(result.stack).toContain('Georgia');
    expect(result.category).toBe('serif');
  });

  it('maps monospace font to mono stack', () => {
    const result = mapToSystemStack('Fira Code');
    expect(result.stack).toContain('monospace');
    expect(result.category).toBe('monospace');
  });

  it('returns default sans for unknown font', () => {
    const result = mapToSystemStack('SomeObscureFont');
    expect(result.stack).toContain('system-ui');
    expect(result.category).toBe('default-sans');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/design-import/canva-fonts.test.ts`
Expected: FAIL — mapToSystemStack not exported

- [ ] **Step 7: Implement `mapToSystemStack`**

```js
// Append to scripts/design-import/canva-fonts.mjs

// Known font classifications. Keys are lowercase font family names.
const FONT_CATEGORIES = new Map([
  // Geometric sans
  ...['montserrat', 'poppins', 'raleway', 'josefin sans', 'quicksand',
    'comfortaa', 'nunito', 'nunito sans', 'outfit', 'space grotesk',
    'dm sans', 'lexend'].map((f) => [f, 'geometric-sans']),
  // Humanist sans
  ...['open sans', 'lato', 'roboto', 'inter', 'arimo', 'source sans pro',
    'source sans 3', 'noto sans', 'work sans', 'barlow', 'cabin',
    'ubuntu', 'fira sans', 'karla', 'rubik', 'manrope', 'plus jakarta sans',
    'be vietnam pro'].map((f) => [f, 'humanist-sans']),
  // Serif
  ...['playfair display', 'merriweather', 'lora', 'eb garamond', 'libre baskerville',
    'cormorant garamond', 'crimson text', 'bitter', 'frank ruhl libre',
    'dm serif display', 'dm serif text', 'noto serif', 'source serif pro',
    'source serif 4', 'pt serif', 'spectral', 'vollkorn'].map((f) => [f, 'serif']),
  // Slab serif
  ...['roboto slab', 'arvo', 'zilla slab', 'crete round', 'rokkitt',
    'josefin slab', 'slabo 27px'].map((f) => [f, 'slab-serif']),
  // Monospace
  ...['fira code', 'fira mono', 'source code pro', 'jetbrains mono',
    'roboto mono', 'ibm plex mono', 'space mono', 'courier prime',
    'dm mono'].map((f) => [f, 'monospace']),
]);

const SYSTEM_STACKS = {
  'geometric-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'humanist-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'serif': 'Georgia, "Times New Roman", "Noto Serif", serif',
  'slab-serif': 'Georgia, "Rockwell", "Times New Roman", serif',
  'monospace': '"SFMono-Regular", "Cascadia Code", "Fira Code", monospace',
  'default-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

/**
 * Map a web font family name to the closest system font stack.
 *
 * @param {string} fontFamily - The web font name (e.g., "Montserrat")
 * @returns {{ stack: string, category: string, original: string }}
 */
export function mapToSystemStack(fontFamily) {
  const lower = fontFamily.toLowerCase().trim();
  const category = FONT_CATEGORIES.get(lower) || 'default-sans';
  return {
    stack: SYSTEM_STACKS[category],
    category,
    original: fontFamily,
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/design-import/canva-fonts.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/design-import/canva-fonts.mjs tests/design-import/canva-fonts.test.ts
git commit -m "feat(design-import): add Canva font extraction and system stack mapping"
```

---

### Task 3: Layout heuristics module

Classify absolute-positioned sections into semantic types based on spatial patterns and content analysis.

**Files:**
- Create: `scripts/design-import/layout-heuristics.mjs`
- Test: `tests/design-import/layout-heuristics.test.ts`

- [ ] **Step 1: Write failing test for `classifySection`**

```ts
// tests/design-import/layout-heuristics.test.ts
import { describe, it, expect } from 'vitest';
import { classifySection } from '../../scripts/design-import/layout-heuristics.mjs';

describe('classifySection', () => {
  it('classifies first section with large text + image as hero', () => {
    const section = {
      index: 0,
      bounds: { x: 0, y: 0, width: 1280, height: 600 },
      elements: [
        { type: 'text', content: 'Welcome to Our Business', style: { fontSize: 48 }, bounds: { x: 100, y: 200, width: 500, height: 60 } },
        { type: 'text', content: 'We do great things', style: { fontSize: 18 }, bounds: { x: 100, y: 280, width: 400, height: 30 } },
        { type: 'image', content: 'hero.png', style: {}, bounds: { x: 600, y: 100, width: 580, height: 400 } },
      ],
    };
    expect(classifySection(section)).toBe('hero');
  });

  it('classifies evenly-spaced same-sized groups as feature-grid', () => {
    const section = {
      index: 1,
      bounds: { x: 0, y: 600, width: 1280, height: 400 },
      elements: [
        { type: 'text', content: 'Feature 1', style: { fontSize: 20 }, bounds: { x: 50, y: 620, width: 350, height: 30 } },
        { type: 'text', content: 'Description 1', style: { fontSize: 14 }, bounds: { x: 50, y: 660, width: 350, height: 60 } },
        { type: 'text', content: 'Feature 2', style: { fontSize: 20 }, bounds: { x: 460, y: 620, width: 350, height: 30 } },
        { type: 'text', content: 'Description 2', style: { fontSize: 14 }, bounds: { x: 460, y: 660, width: 350, height: 60 } },
        { type: 'text', content: 'Feature 3', style: { fontSize: 20 }, bounds: { x: 870, y: 620, width: 350, height: 30 } },
        { type: 'text', content: 'Description 3', style: { fontSize: 14 }, bounds: { x: 870, y: 660, width: 350, height: 60 } },
      ],
    };
    expect(classifySection(section)).toBe('feature-grid');
  });

  it('classifies section with quote-style text as testimonial', () => {
    const section = {
      index: 2,
      bounds: { x: 0, y: 1000, width: 1280, height: 300 },
      elements: [
        { type: 'text', content: '\u201cThis product changed my life\u201d', style: { fontSize: 24 }, bounds: { x: 200, y: 1050, width: 880, height: 40 } },
        { type: 'text', content: '\u2014 Jane Smith, CEO', style: { fontSize: 14 }, bounds: { x: 400, y: 1120, width: 200, height: 20 } },
      ],
    };
    expect(classifySection(section)).toBe('testimonial');
  });

  it('classifies image-heavy section as gallery', () => {
    const section = {
      index: 3,
      bounds: { x: 0, y: 1300, width: 1280, height: 500 },
      elements: [
        { type: 'image', content: 'img1.png', style: {}, bounds: { x: 50, y: 1320, width: 380, height: 220 } },
        { type: 'image', content: 'img2.png', style: {}, bounds: { x: 450, y: 1320, width: 380, height: 220 } },
        { type: 'image', content: 'img3.png', style: {}, bounds: { x: 850, y: 1320, width: 380, height: 220 } },
        { type: 'image', content: 'img4.png', style: {}, bounds: { x: 50, y: 1560, width: 380, height: 220 } },
      ],
    };
    expect(classifySection(section)).toBe('gallery');
  });

  it('classifies small text + links at bottom as footer', () => {
    const section = {
      index: 5,
      bounds: { x: 0, y: 2800, width: 1280, height: 150 },
      elements: [
        { type: 'text', content: '2026 My Business. All rights reserved.', style: { fontSize: 12 }, bounds: { x: 50, y: 2820, width: 300, height: 20 } },
        { type: 'text', content: 'Privacy Policy', style: { fontSize: 12 }, bounds: { x: 500, y: 2820, width: 100, height: 20 } },
        { type: 'text', content: 'Terms of Service', style: { fontSize: 12 }, bounds: { x: 620, y: 2820, width: 120, height: 20 } },
      ],
    };
    expect(classifySection(section)).toBe('footer');
  });

  it('classifies unrecognized patterns as generic', () => {
    const section = {
      index: 4,
      bounds: { x: 0, y: 2000, width: 1280, height: 400 },
      elements: [
        { type: 'text', content: 'Some content here', style: { fontSize: 16 }, bounds: { x: 100, y: 2050, width: 600, height: 300 } },
      ],
    };
    expect(classifySection(section)).toBe('generic');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/layout-heuristics.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `classifySection`**

```js
// scripts/design-import/layout-heuristics.mjs

/**
 * Classify a section into a semantic type based on spatial patterns.
 *
 * @param {{ index: number, bounds: Object, elements: Object[] }} section
 * @returns {'hero'|'feature-grid'|'testimonial'|'gallery'|'cta'|'footer'|'content'|'generic'}
 */
export function classifySection(section) {
  const { index, elements } = section;
  const texts = elements.filter((e) => e.type === 'text');
  const images = elements.filter((e) => e.type === 'image');

  // Gallery: 3+ images
  if (images.length >= 3) return 'gallery';

  // Hero: first section with large text and an image
  if (index === 0) {
    const hasLargeText = texts.some((t) => (t.style.fontSize || 0) >= 32);
    const hasImage = images.length > 0;
    if (hasLargeText && hasImage) return 'hero';
    if (hasLargeText) return 'hero';
  }

  // Footer: all small text with footer signal words
  if (texts.length > 0 && texts.every((t) => (t.style.fontSize || 16) <= 14)) {
    const hasFooterSignals = texts.some((t) =>
      /rights reserved|privacy|terms|copyright|\u00a9/i.test(t.content),
    );
    if (hasFooterSignals) return 'footer';
  }

  // Testimonial: has quote marks and attribution dash
  if (texts.some((t) => /^["\u201c\u201d]/.test(t.content.trim())) &&
      texts.some((t) => /^[-\u2014\u2013]/.test(t.content.trim()))) {
    return 'testimonial';
  }

  // Feature grid: 2-4 groups of elements at similar x-intervals
  if (texts.length >= 4) {
    const groups = detectEvenlySpacedGroups(texts);
    if (groups >= 2 && groups <= 4) return 'feature-grid';
  }

  // CTA: short section with a button-like element or large centered text
  const buttons = elements.filter((e) => e.type === 'button');
  if (buttons.length > 0 && texts.length <= 3) return 'cta';

  // Content: single block of body text
  if (texts.length === 1 && (texts[0].style.fontSize || 16) <= 18 &&
      texts[0].content.length > 100) {
    return 'content';
  }

  return 'generic';
}

/**
 * Detect evenly-spaced groups by clustering elements by x-position.
 * Returns the number of distinct x-clusters found, or 0 if not evenly spaced.
 */
function detectEvenlySpacedGroups(elements) {
  const xPositions = elements.map((e) => e.bounds.x).sort((a, b) => a - b);
  const clusters = [];
  let current = [xPositions[0]];

  for (let i = 1; i < xPositions.length; i++) {
    if (xPositions[i] - xPositions[i - 1] < 50) {
      current.push(xPositions[i]);
    } else {
      clusters.push(current);
      current = [xPositions[i]];
    }
  }
  clusters.push(current);

  if (clusters.length < 2) return clusters.length;
  const gaps = [];
  for (let i = 1; i < clusters.length; i++) {
    const prevCenter = clusters[i - 1].reduce((a, b) => a + b, 0) / clusters[i - 1].length;
    const currCenter = clusters[i].reduce((a, b) => a + b, 0) / clusters[i].length;
    gaps.push(currCenter - prevCenter);
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const isEven = gaps.every((g) => Math.abs(g - avgGap) / avgGap < 0.2);

  return isEven ? clusters.length : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/layout-heuristics.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for `classifyAllSections`**

```ts
// Append to tests/design-import/layout-heuristics.test.ts
import { classifyAllSections } from '../../scripts/design-import/layout-heuristics.mjs';

describe('classifyAllSections', () => {
  it('classifies a full page of sections', () => {
    const sections = [
      {
        index: 0,
        bounds: { x: 0, y: 0, width: 1280, height: 600 },
        elements: [
          { type: 'text', content: 'Welcome', style: { fontSize: 48 }, bounds: { x: 100, y: 200, width: 500, height: 60 } },
          { type: 'image', content: 'hero.png', style: {}, bounds: { x: 600, y: 100, width: 580, height: 400 } },
        ],
      },
      {
        index: 1,
        bounds: { x: 0, y: 600, width: 1280, height: 200 },
        elements: [
          { type: 'text', content: 'Just some text about us', style: { fontSize: 16 }, bounds: { x: 100, y: 620, width: 600, height: 150 } },
        ],
      },
    ];
    const result = classifyAllSections(sections);
    expect(result[0].type).toBe('hero');
    expect(result[0].section).toBe(sections[0]);
    expect(result[1].type).toBe('generic');
    expect(result[1].section).toBe(sections[1]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/design-import/layout-heuristics.test.ts`
Expected: FAIL — classifyAllSections not exported

- [ ] **Step 7: Implement `classifyAllSections`**

```js
// Append to scripts/design-import/layout-heuristics.mjs

/**
 * Classify all sections on a page.
 *
 * @param {Object[]} sections
 * @returns {{ type: string, section: Object }[]}
 */
export function classifyAllSections(sections) {
  return sections.map((section) => ({
    type: classifySection(section),
    section,
  }));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/design-import/layout-heuristics.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/design-import/layout-heuristics.mjs tests/design-import/layout-heuristics.test.ts
git commit -m "feat(design-import): add layout heuristics for section classification"
```

---

### Task 4: Text hierarchy mapper

Map Canva font sizes to HTML heading levels, and detect button-like elements.

**Files:**
- Create: `scripts/design-import/text-hierarchy.mjs`
- Test: `tests/design-import/text-hierarchy.test.ts`

- [ ] **Step 1: Write failing test for `assignHeadingLevels`**

```ts
// tests/design-import/text-hierarchy.test.ts
import { describe, it, expect } from 'vitest';
import { assignHeadingLevels } from '../../scripts/design-import/text-hierarchy.mjs';

describe('assignHeadingLevels', () => {
  it('assigns h1 to largest, h2 to second, p to body', () => {
    const elements = [
      { content: 'Main Title', style: { fontSize: 48 } },
      { content: 'Subtitle', style: { fontSize: 24 } },
      { content: 'Body text that is longer and uses a smaller font.', style: { fontSize: 16 } },
    ];
    const result = assignHeadingLevels(elements);
    expect(result[0]).toEqual({ content: 'Main Title', tag: 'h1' });
    expect(result[1]).toEqual({ content: 'Subtitle', tag: 'h2' });
    expect(result[2]).toEqual({ content: 'Body text that is longer and uses a smaller font.', tag: 'p' });
  });

  it('uses h2 for largest when not the first h1 on page', () => {
    const elements = [
      { content: 'Section Title', style: { fontSize: 32 } },
      { content: 'Details here', style: { fontSize: 16 } },
    ];
    const result = assignHeadingLevels(elements, { h1Used: true });
    expect(result[0]).toEqual({ content: 'Section Title', tag: 'h2' });
    expect(result[1]).toEqual({ content: 'Details here', tag: 'p' });
  });

  it('marks small text as small', () => {
    const elements = [
      { content: '2026 All rights reserved', style: { fontSize: 10 } },
    ];
    const result = assignHeadingLevels(elements);
    expect(result[0]).toEqual({ content: '2026 All rights reserved', tag: 'small' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/text-hierarchy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `assignHeadingLevels`**

```js
// scripts/design-import/text-hierarchy.mjs

const SMALL_THRESHOLD = 12;
const BODY_THRESHOLD = 20;

/**
 * Assign HTML heading levels to text elements based on relative font size.
 *
 * @param {{ content: string, style: { fontSize?: number } }[]} elements
 * @param {{ h1Used?: boolean }} [options]
 * @returns {{ content: string, tag: 'h1'|'h2'|'h3'|'p'|'small' }[]}
 */
export function assignHeadingLevels(elements, options = {}) {
  if (elements.length === 0) return [];

  const sizes = elements.map((e) => e.style.fontSize || 16);
  const uniqueSizes = [...new Set(sizes)].sort((a, b) => b - a);

  return elements.map((el) => {
    const size = el.style.fontSize || 16;

    if (size <= SMALL_THRESHOLD) {
      return { content: el.content, tag: 'small' };
    }

    if (size <= BODY_THRESHOLD) {
      return { content: el.content, tag: 'p' };
    }

    const sizeRank = uniqueSizes.indexOf(size);

    if (sizeRank === 0 && !options.h1Used) {
      return { content: el.content, tag: 'h1' };
    }
    if (sizeRank <= 1) {
      return { content: el.content, tag: 'h2' };
    }
    return { content: el.content, tag: 'h3' };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/text-hierarchy.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for `detectButtons`**

```ts
// Append to tests/design-import/text-hierarchy.test.ts
import { detectButtons } from '../../scripts/design-import/text-hierarchy.mjs';

describe('detectButtons', () => {
  it('detects button-like elements by size and content length', () => {
    const elements = [
      { type: 'text', content: 'Learn More', style: { fontSize: 16 }, bounds: { x: 100, y: 100, width: 150, height: 40 } },
      { type: 'text', content: 'This is a longer paragraph of text that describes something.', style: { fontSize: 16 }, bounds: { x: 100, y: 200, width: 600, height: 100 } },
      { type: 'text', content: 'Get Started', style: { fontSize: 14 }, bounds: { x: 300, y: 300, width: 120, height: 36 } },
    ];
    const result = detectButtons(elements);
    expect(result).toEqual([0, 2]);
  });

  it('returns empty array when no buttons detected', () => {
    const elements = [
      { type: 'text', content: 'A fairly long piece of body text that is clearly a paragraph.', style: { fontSize: 16 }, bounds: { x: 100, y: 100, width: 600, height: 100 } },
    ];
    const result = detectButtons(elements);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/design-import/text-hierarchy.test.ts`
Expected: FAIL — detectButtons not exported

- [ ] **Step 7: Implement `detectButtons`**

```js
// Append to scripts/design-import/text-hierarchy.mjs

/**
 * Detect button-like text elements based on bounds and content.
 *
 * @param {{ type: string, content: string, bounds: { width: number, height: number } }[]} elements
 * @returns {number[]} Indices of button-like elements
 */
export function detectButtons(elements) {
  const buttons = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type !== 'text') continue;
    const isShortText = el.content.length <= 30;
    const isCompact = el.bounds.height <= 60 && el.bounds.width <= 250;
    if (isShortText && isCompact) {
      buttons.push(i);
    }
  }
  return buttons;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/design-import/text-hierarchy.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/design-import/text-hierarchy.mjs tests/design-import/text-hierarchy.test.ts
git commit -m "feat(design-import): add text hierarchy mapping and button detection"
```

---

### Task 5: Canva Playwright extraction script

The browser-context script that navigates Canva published sites and extracts tokens, sections, and content.

**Files:**
- Create: `scripts/design-import/canva-playwright.mjs`
- Test: `tests/design-import/canva-playwright.test.ts` (unit test for `buildSectionData` transform)

- [ ] **Step 1: Write failing test for `buildSectionData`**

```ts
// tests/design-import/canva-playwright.test.ts
import { describe, it, expect } from 'vitest';
import { buildSectionData } from '../../scripts/design-import/canva-playwright.mjs';

describe('buildSectionData', () => {
  it('transforms raw browser data into structured sections', () => {
    const rawSections = [
      {
        id: 'section-1',
        bounds: { x: 0, y: 0, width: 1280, height: 600 },
        elements: [
          { tagName: 'DIV', textContent: 'Hello World', style: { fontSize: '48px', fontFamily: 'Arimo', color: 'rgb(255, 255, 255)' }, bounds: { x: 100, y: 200, width: 500, height: 60 }, src: null },
          { tagName: 'IMG', textContent: '', style: {}, bounds: { x: 600, y: 100, width: 580, height: 400 }, src: 'media/abc123.png' },
        ],
      },
    ];
    const result = buildSectionData(rawSections);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
    expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 1280, height: 600 });
    expect(result[0].elements).toHaveLength(2);
    expect(result[0].elements[0].type).toBe('text');
    expect(result[0].elements[0].content).toBe('Hello World');
    expect(result[0].elements[0].style.fontSize).toBe(48);
    expect(result[0].elements[1].type).toBe('image');
    expect(result[0].elements[1].content).toBe('media/abc123.png');
  });

  it('handles empty sections', () => {
    const rawSections = [
      { id: 'empty', bounds: { x: 0, y: 0, width: 1280, height: 100 }, elements: [] },
    ];
    const result = buildSectionData(rawSections);
    expect(result).toHaveLength(1);
    expect(result[0].elements).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/canva-playwright.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `canva-playwright.mjs`**

This is a large file. Create it with all the functions described in the spec. The key exports are:

- `buildSectionData(rawSections)` — transforms raw browser evaluation data into structured sections (testable without Playwright)
- `extractStylesSrc` — browser-context function that reads inline styles and @font-face rules
- `extractSectionsSrc` — browser-context function that reads section elements and their positions
- `extractNavSrc` — browser-context function that reads navigation links
- `extractImagesSrc` — browser-context function that collects all image URLs
- `extractCanvaPage(page, url, options)` — orchestrates a single page extraction
- `extractCanvaSite(baseUrl)` — orchestrates full multi-page site extraction

See the spec at `docs/superpowers/specs/2026-04-13-design-import-design.md` for the full extraction output shape. The script follows the same patterns as `scripts/import/wix/wix-playwright.mjs`:

- Uses `createRequire` from `node:module` to resolve Playwright from the user's project `node_modules` (not the plugin cache)
- Browser-context functions are exported as named constants for testability
- CLI entry point uses `process.argv[1]?.endsWith('canva-playwright.mjs')` guard
- Outputs JSON to stdout

The browser-context functions (`extractStylesSrc`, `extractSectionsSrc`, etc.) run inside `page.evaluate()` and can only use browser APIs. The orchestration functions run in Node and can import from other modules.

Key differences from the Wix script:
- Waits for `networkidle` instead of `domcontentloaded` (Canva is a full SPA)
- Looks for `<section>` elements instead of `#SITE_CONTAINER`
- Extracts inline `style` attributes instead of `getComputedStyle` backgrounds
- Reads `@font-face` rules from stylesheets for font extraction
- Navigates subpages discovered from nav links

The file should import from:
- `./canva-colors.mjs` — `parseInlineColors`, `rankColors`, `inferColorRoles`
- `./canva-fonts.mjs` — `parseCanvaFonts`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/canva-playwright.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/design-import/canva-playwright.mjs tests/design-import/canva-playwright.test.ts
git commit -m "feat(design-import): add Canva Playwright extraction script"
```

---

### Task 6: Comparison screenshot utility

Generate side-by-side screenshots of the Canva original and the built Astro site.

**Files:**
- Create: `scripts/design-import/comparison.mjs`
- Test: `tests/design-import/comparison.test.ts` (unit test for path generation)

- [ ] **Step 1: Write failing test for `comparisonPaths`**

```ts
// tests/design-import/comparison.test.ts
import { describe, it, expect } from 'vitest';
import { comparisonPaths } from '../../scripts/design-import/comparison.mjs';

describe('comparisonPaths', () => {
  it('generates correct paths for homepage', () => {
    const result = comparisonPaths('/');
    expect(result.original).toBe('docs/design-import/comparison/home-original.png');
    expect(result.generated).toBe('docs/design-import/comparison/home-generated.png');
  });

  it('generates correct paths for subpages', () => {
    const result = comparisonPaths('/services');
    expect(result.original).toBe('docs/design-import/comparison/services-original.png');
    expect(result.generated).toBe('docs/design-import/comparison/services-generated.png');
  });

  it('handles nested paths', () => {
    const result = comparisonPaths('/about/team');
    expect(result.original).toBe('docs/design-import/comparison/about-team-original.png');
    expect(result.generated).toBe('docs/design-import/comparison/about-team-generated.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/comparison.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `comparison.mjs`**

```js
// scripts/design-import/comparison.mjs
//
// Screenshot comparison utility for design-import.
// Captures the original Canva site and the generated Astro site
// side by side for owner review.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const COMPARISON_DIR = 'docs/design-import/comparison';

/**
 * Generate file paths for comparison screenshots.
 *
 * @param {string} pagePath - URL path (e.g., "/" or "/services")
 * @returns {{ original: string, generated: string }}
 */
export function comparisonPaths(pagePath) {
  const slug = pagePath === '/'
    ? 'home'
    : pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '-');
  return {
    original: `${COMPARISON_DIR}/${slug}-original.png`,
    generated: `${COMPARISON_DIR}/${slug}-generated.png`,
  };
}

/**
 * Capture comparison screenshots for all pages.
 * Requires Playwright to be installed.
 *
 * @param {string} canvaBaseUrl - The *.my.canva.site URL
 * @param {string} localBaseUrl - The local dev server URL (e.g., http://localhost:4321)
 * @param {string[]} pagePaths - Page paths to screenshot
 * @returns {Promise<Array<{ original: string, generated: string }>>}
 */
export async function captureComparisons(canvaBaseUrl, localBaseUrl, pagePaths) {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const playwright = require('playwright');
  const browser = await playwright.chromium.launch({ headless: true });

  mkdirSync(COMPARISON_DIR, { recursive: true });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const results = [];

  try {
    for (const pagePath of pagePaths) {
      const paths = comparisonPaths(pagePath);

      // Screenshot original Canva page
      const canvaUrl = new URL(pagePath, canvaBaseUrl).href;
      await page.goto(canvaUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: paths.original, fullPage: true });

      // Screenshot generated Astro page
      const localUrl = new URL(pagePath, localBaseUrl).href;
      await page.goto(localUrl, { waitUntil: 'networkidle', timeout: 15000 });
      await page.screenshot({ path: paths.generated, fullPage: true });

      results.push(paths);
    }
  } finally {
    await browser.close();
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/comparison.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/design-import/comparison.mjs tests/design-import/comparison.test.ts
git commit -m "feat(design-import): add comparison screenshot utility"
```

---

### Task 7: Design axes inference

Infer the five design axes from extracted Canva tokens.

**Files:**
- Create: `scripts/design-import/infer-axes.mjs`
- Test: `tests/design-import/infer-axes.test.ts`
- Reference: `template/scripts/design.ts` (for axis definitions)

- [ ] **Step 1: Write failing test for `inferAxes`**

```ts
// tests/design-import/infer-axes.test.ts
import { describe, it, expect } from 'vitest';
import { inferAxes } from '../../scripts/design-import/infer-axes.mjs';

describe('inferAxes', () => {
  it('infers warm temperature from warm-hued primary color', () => {
    const tokens = {
      colorRoles: { primary: '#e06030', accent: '#ff8844', background: '#fff8f0', text: '#333' },
      fonts: ['Playfair Display'],
    };
    const axes = inferAxes(tokens);
    expect(axes.temperature).toBeGreaterThan(0.6);
  });

  it('infers cool temperature from cool-hued primary color', () => {
    const tokens = {
      colorRoles: { primary: '#41b8d5', accent: '#6ce5e8', background: '#ffffff', text: '#333' },
      fonts: ['Arimo'],
    };
    const axes = inferAxes(tokens);
    expect(axes.temperature).toBeLessThan(0.4);
  });

  it('infers classic time axis from serif fonts', () => {
    const tokens = {
      colorRoles: { primary: '#666', accent: null, background: '#fff', text: '#333' },
      fonts: ['Playfair Display', 'Merriweather'],
    };
    const axes = inferAxes(tokens);
    expect(axes.time).toBeLessThan(0.4);
  });

  it('infers contemporary time axis from sans-serif fonts', () => {
    const tokens = {
      colorRoles: { primary: '#41b8d5', accent: '#6ce5e8', background: '#fff', text: '#333' },
      fonts: ['Montserrat', 'Open Sans'],
    };
    const axes = inferAxes(tokens);
    expect(axes.time).toBeGreaterThan(0.6);
  });

  it('infers bold voice from high-saturation colors', () => {
    const tokens = {
      colorRoles: { primary: '#ff0000', accent: '#00ff00', background: '#fff', text: '#000' },
      fonts: ['Poppins'],
    };
    const axes = inferAxes(tokens);
    expect(axes.voice).toBeGreaterThan(0.6);
  });

  it('returns all values clamped to [0, 1]', () => {
    const tokens = {
      colorRoles: { primary: null, accent: null, background: '#fff', text: '#333' },
      fonts: [],
    };
    const axes = inferAxes(tokens);
    for (const val of Object.values(axes)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/design-import/infer-axes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `inferAxes`**

```js
// scripts/design-import/infer-axes.mjs
//
// Infer Anglesite's five design axes from extracted Canva tokens.

import { saturation } from '../import/wix/color-utils.mjs';
import { mapToSystemStack } from './canva-fonts.mjs';

/**
 * Parse a hex color to HSL hue (0-360).
 */
function hue(hex) {
  if (!hex) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  let h;
  const d = max - min;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

const clamp = (v) => Math.max(0, Math.min(1, v));

const FONT_TIME_SCORES = {
  'serif': 0.2,
  'slab-serif': 0.35,
  'default-sans': 0.5,
  'humanist-sans': 0.65,
  'geometric-sans': 0.8,
  'monospace': 0.5,
};

/**
 * Infer Anglesite design axes from extracted tokens.
 *
 * @param {{ colorRoles: { primary: string|null, accent: string|null, background: string|null, text: string|null }, fonts: string[] }} tokens
 * @returns {{ temperature: number, weight: number, register: number, time: number, voice: number }}
 */
export function inferAxes(tokens) {
  const { colorRoles, fonts } = tokens;

  // Temperature: warm hues (red/orange 0-60, 300-360) vs cool (blue/green 150-270)
  let temperature = 0.5;
  if (colorRoles.primary) {
    const h = hue(colorRoles.primary);
    if (h <= 60 || h >= 300) temperature = 0.6 + (h <= 60 ? h : 360 - h) / 60 * 0.3;
    else if (h >= 150 && h <= 270) temperature = 0.4 - (h - 150) / 120 * 0.3;
    else temperature = 0.5;
  }

  // Weight: default to middle (no reliable spatial signal from tokens alone)
  const weight = 0.45;

  // Register: serif = authoritative, sans = playful
  let register = 0.5;
  if (fonts.length > 0) {
    const mapped = mapToSystemStack(fonts[0]);
    const isSerif = mapped.category === 'serif' || mapped.category === 'slab-serif';
    register = isSerif ? 0.7 : 0.4;
  }

  // Time: serif = classic, sans = contemporary
  let time = 0.5;
  if (fonts.length > 0) {
    const scores = fonts.map((f) => {
      const mapped = mapToSystemStack(f);
      return FONT_TIME_SCORES[mapped.category] ?? 0.5;
    });
    time = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Voice: saturation of primary + accent
  let voice = 0.5;
  const sats = [colorRoles.primary, colorRoles.accent]
    .filter(Boolean)
    .map((c) => saturation(c));
  if (sats.length > 0) {
    const avgSat = sats.reduce((a, b) => a + b, 0) / sats.length;
    voice = clamp(avgSat * 1.2);
  }

  return {
    temperature: clamp(temperature),
    weight: clamp(weight),
    register: clamp(register),
    time: clamp(time),
    voice: clamp(voice),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/design-import/infer-axes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/design-import/infer-axes.mjs tests/design-import/infer-axes.test.ts
git commit -m "feat(design-import): add design axis inference from extracted tokens"
```

---

### Task 8: Canva platform doc

Create the platform-specific extraction guide.

**Files:**
- Create: `docs/import/canva-site.md`
- Modify: `docs/import/README.md`

- [ ] **Step 1: Create `docs/import/canva-site.md`**

Write the Canva platform guide following the same structure as `docs/import/wix.md`. Cover:
- Detection signals (`my.canva.site` in URL)
- Site characteristics (SPA, absolute positioning, inline styles, hashed classes)
- Design token extraction (inline `rgb()`, `@font-face` rules, Canva system font filtering)
- Image URL patterns (`media/<hash>.<ext>`)
- Multi-page structure (up to 45 pages, path-based URLs)
- Metadata (minimal OG tags)
- Extraction script usage
- Known limitations (forms, videos, complex overlapping layers)

- [ ] **Step 2: Update `docs/import/README.md`**

Add after the Carrd entry in the hosted platforms list:

```markdown
- [Canva Published Sites](canva-site.md) -- Playwright extraction from `*.my.canva.site` (design tokens + layout + content)
```

- [ ] **Step 3: Commit**

```bash
git add docs/import/canva-site.md docs/import/README.md
git commit -m "docs: add Canva published site extraction guide"
```

---

### Task 9: Main skill file

Create the user-facing `/anglesite:design-import` skill.

**Files:**
- Create: `skills/design-import/SKILL.md`

- [ ] **Step 1: Create the skill**

Write `skills/design-import/SKILL.md` with YAML frontmatter matching the plugin convention:

```yaml
---
name: design-import
description: "Import design tokens and page layouts from a Canva published site or Figma file to build your Astro site"
argument-hint: "[Canva site URL or Figma file URL]"
allowed-tools: ["Bash(node *)", "Bash(npx sharp-cli *)", "Bash(npx playwright install *)", "Bash(npm install *)", "Bash(npm run dev *)", "Bash(npm run build)", "Bash(mkdir *)", "Bash(curl *)", "Bash(git add *)", "Bash(git commit *)", "Bash(git push *)", "Bash(ls *)", "Bash(npm ls *)", "Write", "Read", "Edit", "Glob"]
disable-model-invocation: true
---
```

The skill body follows the step-by-step flow from the spec:

- **Step 0:** Get URL, detect source (Canva vs Figma), check project state, scaffold if needed
- **Step 1:** Check/install Playwright
- **Step 2:** Run extraction, present findings to owner
- **Step 3:** Generate design system (colors, fonts, axes) — skip if DESIGN_MODE is `keep`
- **Step 4:** Generate pages (classify sections, download images, assign text hierarchy, assemble Astro files, build navigation)
- **Step 5:** Build and verify (no external Canva dependencies)
- **Step 6:** Comparison screenshots
- **Step 7:** Present results with summary of what was created and what differs
- **Step 8:** Commit
- **Step 9:** Offer next steps (deploy, design-interview, seo)

Reference scripts using `${CLAUDE_PLUGIN_ROOT}/scripts/design-import/` paths. Reference docs using `${CLAUDE_PLUGIN_ROOT}/docs/import/canva-site.md`. Follow the same communication style as the import skill (plain English, explain before tool calls).

- [ ] **Step 2: Verify frontmatter matches conventions**

Compare frontmatter pattern against `skills/import/SKILL.md` and `skills/deploy/SKILL.md`.

- [ ] **Step 3: Commit**

```bash
git add skills/design-import/SKILL.md
git commit -m "feat: add /anglesite:design-import skill (Canva support)"
```

---

### Task 10: Update plugin docs

Register the new skill in documentation.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md skill tables**

Add `design-import` to the user-facing skills table:

```markdown
| `design-import` | Import design tokens and page layouts from Canva or Figma |
```

Add to plugin structure tree:

```
│   ├── design-import/SKILL.md    Import design from Canva/Figma (user-facing)
```

Update skill count from "40 total: 17 user-facing, 23 model-only" to "41 total: 18 user-facing, 23 model-only".

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register design-import skill in plugin manifest"
```

---

### Task 11: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

```sh
npx vitest run
```

Expected: All tests pass including new tests from Tasks 1-7.

- [ ] **Step 2: Verify file structure**

```sh
ls -la scripts/design-import/
ls -la tests/design-import/
ls -la skills/design-import/
ls docs/import/canva-site.md
```

Expected: All files present:
- `scripts/design-import/`: canva-colors.mjs, canva-fonts.mjs, canva-playwright.mjs, layout-heuristics.mjs, text-hierarchy.mjs, comparison.mjs, infer-axes.mjs
- `tests/design-import/`: canva-colors.test.ts, canva-fonts.test.ts, canva-playwright.test.ts, layout-heuristics.test.ts, text-hierarchy.test.ts, comparison.test.ts, infer-axes.test.ts
- `skills/design-import/`: SKILL.md
- `docs/import/canva-site.md`

- [ ] **Step 3: Verify skill frontmatter**

```sh
head -10 skills/design-import/SKILL.md
```

Expected: Valid YAML frontmatter with name, description, allowed-tools, disable-model-invocation.

- [ ] **Step 4: Quick smoke test of color extraction**

```sh
node --input-type=module -e "
  import { parseInlineColors, rankColors, inferColorRoles } from './scripts/design-import/canva-colors.mjs';
  const styles = ['color: rgb(108, 229, 232);', 'background: rgb(255,255,255);', 'color: rgb(65,184,213);', 'color: rgb(65,184,213);'];
  const colors = parseInlineColors(styles);
  const ranked = rankColors(colors);
  const roles = inferColorRoles(ranked);
  console.log(JSON.stringify(roles, null, 2));
"
```

Expected: JSON with background, text, primary, accent fields.

- [ ] **Step 5: Fix and commit if needed**

If any tests failed or files need adjustment, fix and commit. Only run if fixes were needed.

```bash
git add -A
git commit -m "fix: address test failures in design-import"
```
