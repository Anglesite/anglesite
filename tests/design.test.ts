import { describe, it, expect } from "vitest";
import {
  validateAxes,
  axesFromBusinessType,
  generatePalette,
  generateTypography,
  generateSpacing,
  generateShape,
  createDesignConfig,
  adjustAxes,
  designToTokensCss,
  generateDesignRationale,
  type DesignAxes,
  type DesignConfig,
  type Palette,
  type Typography,
  type Spacing,
  type Shape,
} from "../template/scripts/design.js";
import { meetsWcagAA } from "../template/scripts/contrast.js";

// ---------------------------------------------------------------------------
// validateAxes
// ---------------------------------------------------------------------------

describe("validateAxes", () => {
  it("accepts valid axes with all values between 0 and 1", () => {
    const axes: DesignAxes = {
      temperature: 0.5,
      weight: 0.3,
      register: 0.7,
      time: 0.2,
      voice: 0.9,
    };
    expect(validateAxes(axes)).toBe(true);
  });

  it("accepts boundary values 0 and 1", () => {
    const axes: DesignAxes = {
      temperature: 0,
      weight: 1,
      register: 0,
      time: 1,
      voice: 0,
    };
    expect(validateAxes(axes)).toBe(true);
  });

  it("rejects values below 0", () => {
    const axes: DesignAxes = {
      temperature: -0.1,
      weight: 0.5,
      register: 0.5,
      time: 0.5,
      voice: 0.5,
    };
    expect(validateAxes(axes)).toBe(false);
  });

  it("rejects values above 1", () => {
    const axes: DesignAxes = {
      temperature: 0.5,
      weight: 1.1,
      register: 0.5,
      time: 0.5,
      voice: 0.5,
    };
    expect(validateAxes(axes)).toBe(false);
  });

  it("rejects NaN values", () => {
    const axes: DesignAxes = {
      temperature: NaN,
      weight: 0.5,
      register: 0.5,
      time: 0.5,
      voice: 0.5,
    };
    expect(validateAxes(axes)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// axesFromBusinessType
// ---------------------------------------------------------------------------

describe("axesFromBusinessType", () => {
  it("returns axes for restaurant (warm, inviting)", () => {
    const axes = axesFromBusinessType("restaurant");
    expect(axes.temperature).toBeGreaterThan(0.6); // warm
    expect(axes.register).toBeLessThan(0.5); // approachable, not authoritative
  });

  it("returns axes for accounting (cool, authoritative)", () => {
    const axes = axesFromBusinessType("accounting");
    expect(axes.temperature).toBeLessThan(0.4); // cool
    expect(axes.register).toBeGreaterThan(0.6); // authoritative
  });

  it("returns axes for childcare (playful, warm)", () => {
    const axes = axesFromBusinessType("childcare");
    expect(axes.temperature).toBeGreaterThan(0.5); // warm
    expect(axes.register).toBeLessThan(0.3); // playful
    expect(axes.voice).toBeGreaterThan(0.5); // bold/expressive
  });

  it("returns axes for salon (elegant, contemporary)", () => {
    const axes = axesFromBusinessType("salon");
    expect(axes.time).toBeGreaterThan(0.5); // contemporary
    expect(axes.register).toBeGreaterThan(0.5); // authoritative side
  });

  it("returns axes for nonprofit (warm, community)", () => {
    const axes = axesFromBusinessType("nonprofit");
    expect(axes.temperature).toBeGreaterThan(0.4); // warm-ish
    expect(axes.register).toBeLessThan(0.5); // approachable
  });

  it("falls back to balanced defaults for unknown types", () => {
    const axes = axesFromBusinessType("unknown-type");
    expect(validateAxes(axes)).toBe(true);
    // Defaults should be moderate
    expect(axes.temperature).toBeGreaterThanOrEqual(0.3);
    expect(axes.temperature).toBeLessThanOrEqual(0.7);
  });

  it("handles empty string", () => {
    const axes = axesFromBusinessType("");
    expect(validateAxes(axes)).toBe(true);
  });

  it("always returns valid axes", () => {
    const types = [
      "restaurant", "accounting", "fitness", "florist", "salon",
      "childcare", "nonprofit", "healthcare", "bakery", "photography",
    ];
    for (const type of types) {
      expect(validateAxes(axesFromBusinessType(type)), `invalid axes for ${type}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// generatePalette
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-f]{6}$/;

describe("generatePalette", () => {
  it("returns all required color keys", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const palette = generatePalette(axes);
    expect(palette.brand).toMatch(HEX_RE);
    expect(palette.accent).toMatch(HEX_RE);
    expect(palette.surface).toMatch(HEX_RE);
    expect(palette.text).toMatch(HEX_RE);
    expect(palette.muted).toMatch(HEX_RE);
    expect(palette.border).toMatch(HEX_RE);
    expect(palette.bg).toMatch(HEX_RE);
  });

  it("warm axes produce warm-hued brand color", () => {
    const warm: DesignAxes = { temperature: 0.9, weight: 0.5, register: 0.3, time: 0.5, voice: 0.5 };
    const cool: DesignAxes = { temperature: 0.1, weight: 0.5, register: 0.3, time: 0.5, voice: 0.5 };
    const warmPalette = generatePalette(warm);
    const coolPalette = generatePalette(cool);
    // Warm and cool should produce different brand colors
    expect(warmPalette.brand).not.toBe(coolPalette.brand);
  });

  it("respects a brand color anchor", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const palette = generatePalette(axes, "#b5541c");
    expect(palette.brand).toBe("#b5541c");
  });

  it("generates WCAG AA compliant text on bg", () => {
    const types = ["restaurant", "accounting", "fitness", "salon", "childcare"];
    for (const type of types) {
      const axes = axesFromBusinessType(type);
      const palette = generatePalette(axes);
      expect(
        meetsWcagAA(palette.text, palette.bg),
        `${type}: text ${palette.text} on bg ${palette.bg} fails WCAG AA`,
      ).toBe(true);
    }
  });

  it("is deterministic — same inputs produce same outputs", () => {
    const axes: DesignAxes = { temperature: 0.6, weight: 0.4, register: 0.3, time: 0.5, voice: 0.7 };
    const a = generatePalette(axes);
    const b = generatePalette(axes);
    expect(a).toEqual(b);
  });

  it("bold axes produce dark background", () => {
    const bold: DesignAxes = { temperature: 0.4, weight: 0.9, register: 0.6, time: 0.7, voice: 0.9 };
    const palette = generatePalette(bold);
    // Bold/dense + bold voice → dark mode
    // bg should be dark (low RGB values)
    const bgHex = palette.bg;
    const r = parseInt(bgHex.slice(1, 3), 16);
    const g = parseInt(bgHex.slice(3, 5), 16);
    const b = parseInt(bgHex.slice(5, 7), 16);
    expect((r + g + b) / 3).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// generateTypography
// ---------------------------------------------------------------------------

describe("generateTypography", () => {
  it("returns display and body font stacks", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const typo = generateTypography(axes);
    expect(typo.display.length).toBeGreaterThan(0);
    expect(typo.body.length).toBeGreaterThan(0);
  });

  it("returns a pairing name", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const typo = generateTypography(axes);
    expect(typo.pairing.length).toBeGreaterThan(0);
  });

  it("classic + authoritative axes produce serif display font", () => {
    const axes: DesignAxes = { temperature: 0.3, weight: 0.4, register: 0.8, time: 0.2, voice: 0.3 };
    const typo = generateTypography(axes);
    expect(typo.display).toContain("serif");
  });

  it("contemporary + playful axes produce sans-serif display font", () => {
    const axes: DesignAxes = { temperature: 0.6, weight: 0.3, register: 0.2, time: 0.8, voice: 0.7 };
    const typo = generateTypography(axes);
    expect(typo.display).toContain("sans-serif");
  });

  it("is deterministic", () => {
    const axes: DesignAxes = { temperature: 0.6, weight: 0.4, register: 0.3, time: 0.5, voice: 0.7 };
    expect(generateTypography(axes)).toEqual(generateTypography(axes));
  });
});

// ---------------------------------------------------------------------------
// generateSpacing
// ---------------------------------------------------------------------------

describe("generateSpacing", () => {
  it("returns all spacing tokens", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const spacing = generateSpacing(axes);
    expect(spacing.xs).toMatch(/rem$/);
    expect(spacing.sm).toMatch(/rem$/);
    expect(spacing.md).toMatch(/rem$/);
    expect(spacing.lg).toMatch(/rem$/);
    expect(spacing.xl).toMatch(/rem$/);
  });

  it("airy weight produces larger spacing", () => {
    const airy: DesignAxes = { temperature: 0.5, weight: 0.1, register: 0.5, time: 0.5, voice: 0.5 };
    const dense: DesignAxes = { temperature: 0.5, weight: 0.9, register: 0.5, time: 0.5, voice: 0.5 };
    const airySpacing = generateSpacing(airy);
    const denseSpacing = generateSpacing(dense);
    expect(parseFloat(airySpacing.xl)).toBeGreaterThan(parseFloat(denseSpacing.xl));
  });
});

// ---------------------------------------------------------------------------
// generateShape
// ---------------------------------------------------------------------------

describe("generateShape", () => {
  it("returns radius and shadow tokens", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const shape = generateShape(axes);
    expect(shape.radiusSm).toMatch(/rem$/);
    expect(shape.radiusMd).toMatch(/rem$/);
    expect(shape.radiusLg).toMatch(/rem$/);
    expect(shape.shadowSm).toContain("rgba");
    expect(shape.shadowMd).toContain("rgba");
  });

  it("playful axes produce larger border radius", () => {
    const playful: DesignAxes = { temperature: 0.7, weight: 0.3, register: 0.1, time: 0.7, voice: 0.6 };
    const formal: DesignAxes = { temperature: 0.3, weight: 0.5, register: 0.9, time: 0.2, voice: 0.3 };
    const playfulShape = generateShape(playful);
    const formalShape = generateShape(formal);
    expect(parseFloat(playfulShape.radiusMd)).toBeGreaterThan(parseFloat(formalShape.radiusMd));
  });
});

// ---------------------------------------------------------------------------
// createDesignConfig
// ---------------------------------------------------------------------------

describe("createDesignConfig", () => {
  it("assembles a complete design config", () => {
    const axes: DesignAxes = { temperature: 0.75, weight: 0.3, register: 0.4, time: 0.25, voice: 0.45 };
    const config = createDesignConfig(axes, "handmade-goods-shop");
    expect(config.axes).toEqual(axes);
    expect(config.siteType).toBe("handmade-goods-shop");
    expect(config.palette.brand).toMatch(/^#[0-9a-f]{6}$/);
    expect(config.typography.display.length).toBeGreaterThan(0);
    expect(config.spacing.md).toMatch(/rem$/);
    expect(config.shape.radiusMd).toMatch(/rem$/);
    expect(config.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passes through a brand color anchor", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const config = createDesignConfig(axes, "bakery", "#b5541c");
    expect(config.palette.brand).toBe("#b5541c");
    expect(config.brandColor).toBe("#b5541c");
  });

  it("omits brandColor when not provided", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const config = createDesignConfig(axes, "bakery");
    expect(config.brandColor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// adjustAxes
// ---------------------------------------------------------------------------

describe("adjustAxes", () => {
  it("applies positive incremental adjustments", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const adjusted = adjustAxes(axes, { temperature: 0.15 });
    expect(adjusted.temperature).toBeCloseTo(0.65);
    expect(adjusted.weight).toBe(0.5); // unchanged
  });

  it("applies negative incremental adjustments", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const adjusted = adjustAxes(axes, { register: -0.2 });
    expect(adjusted.register).toBeCloseTo(0.3);
  });

  it("clamps to [0, 1]", () => {
    const axes: DesignAxes = { temperature: 0.9, weight: 0.1, register: 0.5, time: 0.5, voice: 0.5 };
    const adjusted = adjustAxes(axes, { temperature: 0.3, weight: -0.5 });
    expect(adjusted.temperature).toBe(1);
    expect(adjusted.weight).toBe(0);
  });

  it("supports adjusting multiple axes at once", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const adjusted = adjustAxes(axes, { temperature: 0.1, voice: 0.2 });
    expect(adjusted.temperature).toBeCloseTo(0.6);
    expect(adjusted.voice).toBeCloseTo(0.7);
  });

  it("returns valid axes", () => {
    const axes: DesignAxes = { temperature: 0.5, weight: 0.5, register: 0.5, time: 0.5, voice: 0.5 };
    const adjusted = adjustAxes(axes, { temperature: 0.15, weight: -0.1 });
    expect(validateAxes(adjusted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// designToTokensCss
// ---------------------------------------------------------------------------

describe("designToTokensCss", () => {
  const axes: DesignAxes = { temperature: 0.75, weight: 0.3, register: 0.4, time: 0.25, voice: 0.45 };
  const config = createDesignConfig(axes, "bakery");

  it("generates a valid CSS :root block", () => {
    const css = designToTokensCss(config);
    expect(css).toContain(":root {");
    expect(css).toContain("}");
  });

  it("includes color tokens", () => {
    const css = designToTokensCss(config);
    expect(css).toContain("--color-brand:");
    expect(css).toContain("--color-accent:");
    expect(css).toContain("--color-bg:");
    expect(css).toContain("--color-surface:");
    expect(css).toContain("--color-text:");
    expect(css).toContain("--color-muted:");
    expect(css).toContain("--color-border:");
  });

  it("includes typography tokens", () => {
    const css = designToTokensCss(config);
    expect(css).toContain("--font-display:");
    expect(css).toContain("--font-body:");
  });

  it("includes spacing tokens", () => {
    const css = designToTokensCss(config);
    expect(css).toContain("--space-xs:");
    expect(css).toContain("--space-sm:");
    expect(css).toContain("--space-md:");
    expect(css).toContain("--space-lg:");
    expect(css).toContain("--space-xl:");
  });

  it("includes shape tokens", () => {
    const css = designToTokensCss(config);
    expect(css).toContain("--radius-sm:");
    expect(css).toContain("--radius-md:");
    expect(css).toContain("--radius-lg:");
    expect(css).toContain("--shadow-sm:");
    expect(css).toContain("--shadow-md:");
  });

  it("includes type scale tokens", () => {
    const css = designToTokensCss(config);
    expect(css).toContain("--font-size-sm:");
    expect(css).toContain("--font-size-base:");
    expect(css).toContain("--font-size-lg:");
    expect(css).toContain("--font-size-xl:");
    expect(css).toContain("--font-size-2xl:");
    expect(css).toContain("--font-size-3xl:");
    expect(css).toContain("--font-size-4xl:");
  });

  it("starts with a generated-by comment", () => {
    const css = designToTokensCss(config);
    expect(css).toMatch(/^\/\* Generated by Anglesite/);
  });
});

// ---------------------------------------------------------------------------
// generateDesignRationale
// ---------------------------------------------------------------------------

describe("generateDesignRationale", () => {
  const axes: DesignAxes = { temperature: 0.75, weight: 0.3, register: 0.4, time: 0.25, voice: 0.45 };
  const config = createDesignConfig(axes, "bakery");

  it("returns markdown with a heading", () => {
    const md = generateDesignRationale(config);
    expect(md).toContain("# Your Design System");
  });

  it("includes color section", () => {
    const md = generateDesignRationale(config);
    expect(md).toContain("## Color");
    expect(md).toContain(config.palette.brand);
  });

  it("includes typography section", () => {
    const md = generateDesignRationale(config);
    expect(md).toContain("## Typography");
  });

  it("includes adjustment guidance", () => {
    const md = generateDesignRationale(config);
    expect(md).toContain("## To adjust");
  });

  it("includes axis positions", () => {
    const md = generateDesignRationale(config);
    expect(md).toContain("temperature");
    expect(md).toContain("0.75");
  });

  it("describes the site type", () => {
    const md = generateDesignRationale(config);
    expect(md).toContain("bakery");
  });
});
