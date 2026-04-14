import { describe, it, expect } from "vitest";
import { inferAxes } from "../../scripts/design-import/infer-axes.mjs";

// ---------------------------------------------------------------------------
// temperature axis
// ---------------------------------------------------------------------------

describe("temperature axis", () => {
  it("returns > 0.6 for a warm primary color (#e06030, orange-red)", () => {
    const result = inferAxes({
      colorRoles: { primary: "#e06030", accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.temperature).toBeGreaterThan(0.6);
  });

  it("returns < 0.4 for a cool primary color (#41b8d5, cyan-blue)", () => {
    const result = inferAxes({
      colorRoles: { primary: "#41b8d5", accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.temperature).toBeLessThan(0.4);
  });

  it("returns 0.5 when no primary color", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.temperature).toBe(0.5);
  });

  it("returns 0.6-0.9 for a warm red primary (#cc2200)", () => {
    const result = inferAxes({
      colorRoles: { primary: "#cc2200", accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.temperature).toBeGreaterThanOrEqual(0.6);
    expect(result.temperature).toBeLessThanOrEqual(0.9);
  });

  it("returns 0.1-0.4 for a deep blue primary (#1a3a8a)", () => {
    const result = inferAxes({
      colorRoles: { primary: "#1a3a8a", accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.temperature).toBeGreaterThanOrEqual(0.1);
    expect(result.temperature).toBeLessThanOrEqual(0.4);
  });

  it("clamps temperature to [0, 1]", () => {
    const result = inferAxes({
      colorRoles: { primary: "#ff0000", accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.temperature).toBeGreaterThanOrEqual(0);
    expect(result.temperature).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// weight axis
// ---------------------------------------------------------------------------

describe("weight axis", () => {
  it("is always 0.45 regardless of input", () => {
    const cases = [
      { colorRoles: { primary: "#e06030", accent: null, background: null, text: null }, fonts: ["Playfair Display"] },
      { colorRoles: { primary: null, accent: null, background: null, text: null }, fonts: [] },
      { colorRoles: { primary: "#41b8d5", accent: "#ff00ff", background: "#ffffff", text: "#333333" }, fonts: ["Montserrat", "Open Sans"] },
    ];
    for (const input of cases) {
      expect(inferAxes(input).weight).toBe(0.45);
    }
  });
});

// ---------------------------------------------------------------------------
// register axis
// ---------------------------------------------------------------------------

describe("register axis", () => {
  it("returns 0.7 for a serif first font (Playfair Display)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Playfair Display"],
    });
    expect(result.register).toBe(0.7);
  });

  it("returns 0.7 for a slab-serif first font (Roboto Slab)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Roboto Slab"],
    });
    expect(result.register).toBe(0.7);
  });

  it("returns 0.4 for a sans-serif first font (Open Sans)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Open Sans"],
    });
    expect(result.register).toBe(0.4);
  });

  it("returns 0.4 for a geometric-sans first font (Montserrat)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Montserrat"],
    });
    expect(result.register).toBe(0.4);
  });

  it("returns 0.5 when no fonts provided", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.register).toBe(0.5);
  });

  it("uses only the first font for register inference", () => {
    const withSerif = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Playfair Display", "Open Sans"],
    });
    const withSans = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Open Sans", "Playfair Display"],
    });
    expect(withSerif.register).toBe(0.7);
    expect(withSans.register).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// time axis
// ---------------------------------------------------------------------------

describe("time axis", () => {
  it("returns < 0.4 for serif fonts (Playfair Display, Merriweather)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Playfair Display", "Merriweather"],
    });
    expect(result.time).toBeLessThan(0.4);
  });

  it("returns > 0.6 for sans fonts (Montserrat, Open Sans)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Montserrat", "Open Sans"],
    });
    expect(result.time).toBeGreaterThan(0.6);
  });

  it("maps individual font categories to expected time values", () => {
    const cases: Array<[string, number]> = [
      ["Playfair Display", 0.2],     // serif → 0.2
      ["Roboto Slab", 0.35],          // slab-serif → 0.35
      ["Open Sans", 0.65],            // humanist-sans → 0.65
      ["Montserrat", 0.8],            // geometric-sans → 0.8
      ["Fira Code", 0.5],             // monospace → 0.5
    ];
    for (const [font, expected] of cases) {
      const result = inferAxes({
        colorRoles: { primary: null, accent: null, background: null, text: null },
        fonts: [font],
      });
      expect(result.time).toBeCloseTo(expected, 5);
    }
  });

  it("averages time across multiple fonts", () => {
    // serif(0.2) + geometric-sans(0.8) = avg 0.5
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["Playfair Display", "Montserrat"],
    });
    expect(result.time).toBeCloseTo(0.5, 5);
  });

  it("returns 0.5 when no fonts provided", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.time).toBe(0.5);
  });

  it("defaults unknown fonts to 0.5 (default-sans)", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: ["SomeMadeUpFont"],
    });
    expect(result.time).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// voice axis
// ---------------------------------------------------------------------------

describe("voice axis", () => {
  it("returns > 0.6 for high-saturation primary and accent", () => {
    // #ff0000 (red, full saturation) and #00ff00 (green, full saturation)
    const result = inferAxes({
      colorRoles: { primary: "#ff0000", accent: "#00ff00", background: null, text: null },
      fonts: [],
    });
    expect(result.voice).toBeGreaterThan(0.6);
  });

  it("returns 0.5 when no primary or accent color", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: [],
    });
    expect(result.voice).toBe(0.5);
  });

  it("returns 0.5 for fully desaturated (gray) colors", () => {
    const result = inferAxes({
      colorRoles: { primary: "#808080", accent: "#404040", background: null, text: null },
      fonts: [],
    });
    expect(result.voice).toBe(0.5);
  });

  it("clamps voice to [0, 1] for very high saturation", () => {
    const result = inferAxes({
      colorRoles: { primary: "#ff0000", accent: "#0000ff", background: null, text: null },
      fonts: [],
    });
    expect(result.voice).toBeGreaterThanOrEqual(0);
    expect(result.voice).toBeLessThanOrEqual(1);
  });

  it("averages saturation when both primary and accent exist", () => {
    // #ff0000 saturation = 1.0, #808080 saturation = 0 → avg 0.5 × 1.2 = 0.6, clamped to 0.6
    const result = inferAxes({
      colorRoles: { primary: "#ff0000", accent: "#808080", background: null, text: null },
      fonts: [],
    });
    expect(result.voice).toBeCloseTo(0.6, 5);
  });

  it("uses only primary when accent is null", () => {
    const resultWithPrimary = inferAxes({
      colorRoles: { primary: "#ff0000", accent: null, background: null, text: null },
      fonts: [],
    });
    // saturation(#ff0000) = 1.0, × 1.2 = 1.2, clamped to 1.0
    expect(resultWithPrimary.voice).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// all axes clamped to [0, 1]
// ---------------------------------------------------------------------------

describe("all axes clamped to [0, 1]", () => {
  it("returns all axes in [0, 1] for null colors and empty fonts", () => {
    const result = inferAxes({
      colorRoles: { primary: null, accent: null, background: null, text: null },
      fonts: [],
    });
    for (const key of ["temperature", "weight", "register", "time", "voice"] as const) {
      expect(result[key]).toBeGreaterThanOrEqual(0);
      expect(result[key]).toBeLessThanOrEqual(1);
    }
  });

  it("returns all axes in [0, 1] for extreme warm colors and serif fonts", () => {
    const result = inferAxes({
      colorRoles: { primary: "#ff4400", accent: "#ff0000", background: "#ffffff", text: "#111111" },
      fonts: ["Playfair Display", "Merriweather"],
    });
    for (const key of ["temperature", "weight", "register", "time", "voice"] as const) {
      expect(result[key]).toBeGreaterThanOrEqual(0);
      expect(result[key]).toBeLessThanOrEqual(1);
    }
  });

  it("returns all axes in [0, 1] for extreme cool colors and geometric-sans fonts", () => {
    const result = inferAxes({
      colorRoles: { primary: "#0055ff", accent: "#00ccff", background: "#f0f8ff", text: "#222222" },
      fonts: ["Montserrat", "Poppins"],
    });
    for (const key of ["temperature", "weight", "register", "time", "voice"] as const) {
      expect(result[key]).toBeGreaterThanOrEqual(0);
      expect(result[key]).toBeLessThanOrEqual(1);
    }
  });
});
