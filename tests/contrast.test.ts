import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  meetsWcagAA,
  meetsWcagAALarge,
  suggestReadable,
} from "../template/scripts/contrast.js";

// ---------------------------------------------------------------------------
// hexToRgb
// ---------------------------------------------------------------------------

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("parses 3-digit shorthand hex", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("handles hex without hash prefix", () => {
    expect(hexToRgb("2563eb")).toEqual({ r: 37, g: 99, b: 235 });
  });

  it("is case-insensitive", () => {
    expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("returns null for invalid input", () => {
    expect(hexToRgb("not-a-color")).toBeNull();
    expect(hexToRgb("#gggggg")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// relativeLuminance — per WCAG 2.2 definition
// ---------------------------------------------------------------------------

describe("relativeLuminance", () => {
  it("returns 1 for white", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 4);
  });

  it("returns 0 for black", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 4);
  });

  it("computes correct luminance for mid-gray (#808080)", () => {
    // sRGB linearization: 128/255 ≈ 0.502, linearized ≈ 0.2159
    // L = 0.2126*0.2159 + 0.7152*0.2159 + 0.0722*0.2159 ≈ 0.2159
    expect(relativeLuminance({ r: 128, g: 128, b: 128 })).toBeCloseTo(
      0.2159,
      3,
    );
  });

  it("gives red higher luminance than blue", () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(red).toBeGreaterThan(blue);
  });
});

// ---------------------------------------------------------------------------
// contrastRatio
// ---------------------------------------------------------------------------

describe("contrastRatio", () => {
  it("returns 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("returns 1 for same colors", () => {
    expect(contrastRatio("#2563eb", "#2563eb")).toBeCloseTo(1, 2);
  });

  it("is symmetric (order does not matter)", () => {
    const a = contrastRatio("#2563eb", "#ffffff");
    const b = contrastRatio("#ffffff", "#2563eb");
    expect(a).toBeCloseTo(b, 4);
  });

  it("computes correct ratio for Anglesite primary on white", () => {
    // #2563eb on #ffffff — known ratio ≈ 5.17:1
    const ratio = contrastRatio("#2563eb", "#ffffff");
    expect(ratio).toBeGreaterThan(5.0);
    expect(ratio).toBeLessThan(5.5);
  });
});

// ---------------------------------------------------------------------------
// meetsWcagAA — 4.5:1 for normal text
// ---------------------------------------------------------------------------

describe("meetsWcagAA", () => {
  it("passes for black on white", () => {
    expect(meetsWcagAA("#000000", "#ffffff")).toBe(true);
  });

  it("fails for light gray on white", () => {
    // #aaaaaa on white ≈ 2.32:1
    expect(meetsWcagAA("#aaaaaa", "#ffffff")).toBe(false);
  });

  it("passes for Anglesite text on background", () => {
    // #1a1a1a on #ffffff — very high contrast
    expect(meetsWcagAA("#1a1a1a", "#ffffff")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// meetsWcagAALarge — 3:1 for large text (≥18pt or ≥14pt bold)
// ---------------------------------------------------------------------------

describe("meetsWcagAALarge", () => {
  it("passes for mid-contrast that fails normal AA", () => {
    // #767676 on white ≈ 4.54:1 — passes both, let's use a weaker one
    // #888888 on white ≈ 3.54:1 — passes large, fails normal
    expect(meetsWcagAALarge("#888888", "#ffffff")).toBe(true);
    expect(meetsWcagAA("#888888", "#ffffff")).toBe(false);
  });

  it("fails for very low contrast", () => {
    // #cccccc on white ≈ 1.61:1
    expect(meetsWcagAALarge("#cccccc", "#ffffff")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestReadable — darken/lighten a color to meet AA on a background
// ---------------------------------------------------------------------------

describe("suggestReadable", () => {
  it("returns the original color if it already meets AA", () => {
    const result = suggestReadable("#000000", "#ffffff");
    expect(result).toBe("#000000");
  });

  it("suggests a darker shade when foreground is too light on white", () => {
    const result = suggestReadable("#aaaaaa", "#ffffff");
    // The suggestion should meet AA
    expect(meetsWcagAA(result, "#ffffff")).toBe(true);
    // And should still be a gray-ish color (not jump to black)
    const rgb = hexToRgb(result)!;
    expect(rgb.r).toBeGreaterThan(30);
  });

  it("suggests a lighter shade when foreground is too dark on black", () => {
    const result = suggestReadable("#333333", "#000000");
    expect(meetsWcagAA(result, "#000000")).toBe(true);
  });

  it("returns a valid hex color", () => {
    const result = suggestReadable("#aaaaaa", "#ffffff");
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});
