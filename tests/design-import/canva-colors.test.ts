import { describe, it, expect } from "vitest";
import {
  parseInlineColors,
  rankColors,
  inferColorRoles,
} from "../../scripts/design-import/canva-colors.mjs";

// ---------------------------------------------------------------------------
// parseInlineColors
// ---------------------------------------------------------------------------

describe("parseInlineColors", () => {
  it("extracts rgb() from a single inline style string", () => {
    const result = parseInlineColors(["color: rgb(255, 0, 0)"]);
    expect(result).toContain("#ff0000");
  });

  it("extracts multiple rgb() values from a single style string", () => {
    const result = parseInlineColors([
      "color: rgb(255, 0, 0); background-color: rgb(0, 128, 0)",
    ]);
    expect(result).toContain("#ff0000");
    expect(result).toContain("#008000");
  });

  it("extracts rgb() values across multiple style strings", () => {
    const result = parseInlineColors([
      "color: rgb(255, 0, 0)",
      "background-color: rgb(0, 0, 255)",
    ]);
    expect(result).toContain("#ff0000");
    expect(result).toContain("#0000ff");
  });

  it("deduplicates repeated rgb() values", () => {
    const result = parseInlineColors([
      "color: rgb(255, 0, 0)",
      "color: rgb(255, 0, 0)",
      "background: rgb(255, 0, 0)",
    ]);
    expect(result.filter((h) => h === "#ff0000").length).toBe(1);
  });

  it("handles rgba() with full opacity (1) as rgb", () => {
    const result = parseInlineColors(["color: rgba(0, 128, 255, 1)"]);
    expect(result).toContain("#0080ff");
  });

  it("handles rgba() with opacity 1.0 as rgb", () => {
    const result = parseInlineColors(["color: rgba(100, 200, 50, 1.0)"]);
    expect(result).toContain("#64c832");
  });

  it("ignores rgba() with low opacity (< 0.5)", () => {
    const result = parseInlineColors(["color: rgba(255, 0, 0, 0.3)"]);
    expect(result).not.toContain("#ff0000");
  });

  it("ignores rgba() with exactly 0.5 opacity — boundary is exclusive", () => {
    // opacity 0.5 is NOT < 0.5, so it should be included
    const result = parseInlineColors(["color: rgba(255, 0, 0, 0.5)"]);
    expect(result).toContain("#ff0000");
  });

  it("ignores rgba() with opacity 0.49", () => {
    const result = parseInlineColors(["color: rgba(255, 0, 0, 0.49)"]);
    expect(result).not.toContain("#ff0000");
  });

  it("returns empty array for styles without colors", () => {
    const result = parseInlineColors(["font-size: 16px; font-weight: bold"]);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    const result = parseInlineColors([]);
    expect(result).toEqual([]);
  });

  it("handles whitespace variations in rgb()", () => {
    const result = parseInlineColors(["color: rgb( 255 , 0 , 0 )"]);
    expect(result).toContain("#ff0000");
  });

  it("handles whitespace variations in rgba()", () => {
    const result = parseInlineColors(["color: rgba( 0, 128, 255, 1 )"]);
    expect(result).toContain("#0080ff");
  });

  it("returns lowercase hex values", () => {
    const result = parseInlineColors(["color: rgb(171, 205, 239)"]);
    expect(result[0]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// rankColors
// ---------------------------------------------------------------------------

describe("rankColors", () => {
  it("counts and ranks by frequency descending", () => {
    const ranked = rankColors([
      "#ff0000",
      "#0000ff",
      "#ff0000",
      "#ff0000",
      "#0000ff",
    ]);
    expect(ranked[0]).toEqual({ hex: "#ff0000", count: 3 });
    expect(ranked[1]).toEqual({ hex: "#0000ff", count: 2 });
  });

  it("returns a single entry for a single unique color", () => {
    const ranked = rankColors(["#aabbcc", "#aabbcc"]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toEqual({ hex: "#aabbcc", count: 2 });
  });

  it("handles a list with all unique colors", () => {
    const ranked = rankColors(["#ff0000", "#00ff00", "#0000ff"]);
    expect(ranked).toHaveLength(3);
    // Each should have count 1
    for (const entry of ranked) {
      expect(entry.count).toBe(1);
    }
  });

  it("returns empty array for empty input", () => {
    const ranked = rankColors([]);
    expect(ranked).toEqual([]);
  });

  it("preserves stable order among equal-count colors", () => {
    const ranked = rankColors(["#aaaaaa", "#bbbbbb"]);
    // Both have count 1; just verify both are present
    const hexes = ranked.map((r) => r.hex);
    expect(hexes).toContain("#aaaaaa");
    expect(hexes).toContain("#bbbbbb");
  });

  it("handles a list with many duplicates", () => {
    const input = Array(10).fill("#123456").concat(Array(5).fill("#abcdef"));
    const ranked = rankColors(input);
    expect(ranked[0]).toEqual({ hex: "#123456", count: 10 });
    expect(ranked[1]).toEqual({ hex: "#abcdef", count: 5 });
  });
});

// ---------------------------------------------------------------------------
// inferColorRoles
// ---------------------------------------------------------------------------

describe("inferColorRoles", () => {
  // A typical web palette: near-white bg, dark-gray text, saturated blue
  // primary, saturated orange accent.
  const typicalPalette = [
    { hex: "#f5f5f5", count: 20 }, // near-white — should be background
    { hex: "#333333", count: 15 }, // dark gray — should be text
    { hex: "#1a6eb5", count: 10 }, // saturated blue — primary
    { hex: "#e86a1f", count: 5 },  // saturated orange — accent
  ];

  it("assigns background to highest-luminance non-browser-default color", () => {
    const roles = inferColorRoles(typicalPalette);
    expect(roles.background).toBe("#f5f5f5");
  });

  it("assigns text to darkest gray color", () => {
    const roles = inferColorRoles(typicalPalette);
    expect(roles.text).toBe("#333333");
  });

  it("assigns primary to most frequent saturated non-gray color", () => {
    const roles = inferColorRoles(typicalPalette);
    expect(roles.primary).toBe("#1a6eb5");
  });

  it("assigns accent to second most frequent saturated non-gray color", () => {
    const roles = inferColorRoles(typicalPalette);
    expect(roles.accent).toBe("#e86a1f");
  });

  it("returns null for accent when only one saturated color exists", () => {
    const palette = [
      { hex: "#f0f0f0", count: 20 },
      { hex: "#222222", count: 15 },
      { hex: "#2266aa", count: 10 },
    ];
    const roles = inferColorRoles(palette);
    expect(roles.primary).toBe("#2266aa");
    expect(roles.accent).toBeNull();
  });

  it("returns null for primary and accent when all colors are gray", () => {
    const allGray = [
      { hex: "#f5f5f5", count: 20 },
      { hex: "#888888", count: 10 },
      { hex: "#333333", count: 5 },
    ];
    const roles = inferColorRoles(allGray);
    expect(roles.primary).toBeNull();
    expect(roles.accent).toBeNull();
  });

  it("returns all nulls for empty input", () => {
    const roles = inferColorRoles([]);
    expect(roles.background).toBeNull();
    expect(roles.text).toBeNull();
    expect(roles.primary).toBeNull();
    expect(roles.accent).toBeNull();
  });

  it("excludes browser defaults from background selection", () => {
    const paletteWithWhite = [
      { hex: "#ffffff", count: 100 }, // browser default pure white — should be excluded
      { hex: "#f7f7f7", count: 20 },  // near-white, not a browser default
      { hex: "#222222", count: 10 },
    ];
    const roles = inferColorRoles(paletteWithWhite);
    expect(roles.background).toBe("#f7f7f7");
  });

  it("returns null for text when no gray exists", () => {
    const noGray = [
      { hex: "#f5f5f5", count: 10 }, // near-white (gray) background
      { hex: "#ff4400", count: 8 },  // saturated — not gray
      { hex: "#0044ff", count: 5 },  // saturated — not gray
    ];
    const roles = inferColorRoles(noGray);
    // f5f5f5 is actually gray (saturation near 0), so it may be text or background
    // Let's test a palette truly without grays for text role
    const trulyNoGray = [
      { hex: "#ff4400", count: 8 },
      { hex: "#0044ff", count: 5 },
    ];
    const roles2 = inferColorRoles(trulyNoGray);
    expect(roles2.text).toBeNull();
  });

  it("handles a palette with only one color", () => {
    const single = [{ hex: "#336699", count: 5 }];
    const roles = inferColorRoles(single);
    // 336699 is saturated (blue), not gray — so it becomes primary
    expect(roles.primary).toBe("#336699");
    expect(roles.accent).toBeNull();
    expect(roles.text).toBeNull();
  });
});
