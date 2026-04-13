import { describe, it, expect } from "vitest";
import {
  THEMES,
  themeNames,
  themeForBusinessType,
  themeToCss,
  type Theme,
} from "../template/scripts/themes.js";

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

const REQUIRED_CSS_PROPS = [
  "color-primary",
  "color-accent",
  "color-bg",
  "color-text",
  "color-muted",
  "color-surface",
  "color-border",
  "font-heading",
  "font-body",
];

describe("THEMES", () => {
  it("has 8 themes", () => {
    expect(Object.keys(THEMES).length).toBe(8);
  });

  it("has all expected theme names", () => {
    const names = Object.keys(THEMES);
    expect(names).toContain("classic");
    expect(names).toContain("fresh");
    expect(names).toContain("warm");
    expect(names).toContain("bold");
    expect(names).toContain("earthy");
    expect(names).toContain("playful");
    expect(names).toContain("elegant");
    expect(names).toContain("community");
  });

  for (const [name, theme] of Object.entries(THEMES)) {
    describe(`theme: ${name}`, () => {
      it("has all required CSS properties", () => {
        for (const prop of REQUIRED_CSS_PROPS) {
          expect(theme.vars[prop], `missing ${prop}`).toBeDefined();
        }
      });

      it("has a display name", () => {
        expect(theme.displayName.length).toBeGreaterThan(0);
      });

      it("has a description", () => {
        expect(theme.description.length).toBeGreaterThan(0);
      });

      it("has a bestFor list", () => {
        expect(theme.bestFor.length).toBeGreaterThan(0);
      });

      it("has valid hex colors for color properties", () => {
        const colorProps = REQUIRED_CSS_PROPS.filter((p) => p.startsWith("color-"));
        for (const prop of colorProps) {
          expect(theme.vars[prop]).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// themeNames
// ---------------------------------------------------------------------------

describe("themeNames", () => {
  it("returns all 8 theme names", () => {
    expect(themeNames().length).toBe(8);
  });

  it("returns strings", () => {
    for (const name of themeNames()) {
      expect(typeof name).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// themeForBusinessType
// ---------------------------------------------------------------------------

describe("themeForBusinessType", () => {
  it("maps restaurant to warm", () => {
    expect(themeForBusinessType("restaurant")).toBe("warm");
  });

  it("maps accounting to classic", () => {
    expect(themeForBusinessType("accounting")).toBe("classic");
  });

  it("maps fitness to bold", () => {
    expect(themeForBusinessType("fitness")).toBe("bold");
  });

  it("maps florist to earthy", () => {
    expect(themeForBusinessType("florist")).toBe("earthy");
  });

  it("maps salon to elegant", () => {
    expect(themeForBusinessType("salon")).toBe("elegant");
  });

  it("maps childcare to playful", () => {
    expect(themeForBusinessType("childcare")).toBe("playful");
  });

  it("maps nonprofit to community", () => {
    expect(themeForBusinessType("nonprofit")).toBe("community");
  });

  it("maps healthcare to fresh", () => {
    expect(themeForBusinessType("healthcare")).toBe("fresh");
  });

  it("falls back to classic for unknown types", () => {
    expect(themeForBusinessType("unknown")).toBe("classic");
  });

  it("handles empty string", () => {
    expect(themeForBusinessType("")).toBe("classic");
  });
});

// ---------------------------------------------------------------------------
// themeToCss
// ---------------------------------------------------------------------------

describe("themeToCss", () => {
  it("generates CSS custom property declarations", () => {
    const css = themeToCss(THEMES.classic);
    expect(css).toContain("--color-primary:");
    expect(css).toContain("--color-accent:");
    expect(css).toContain("--font-heading:");
    expect(css).toContain("--font-body:");
  });

  it("includes actual color values", () => {
    const css = themeToCss(THEMES.classic);
    expect(css).toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("generates valid CSS lines ending with semicolons", () => {
    const css = themeToCss(THEMES.classic);
    const lines = css.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      expect(line.trim()).toMatch(/^--[\w-]+:\s*.+;$/);
    }
  });

  it("generates all required properties", () => {
    const css = themeToCss(THEMES.classic);
    for (const prop of REQUIRED_CSS_PROPS) {
      expect(css).toContain(`--${prop}:`);
    }
  });
});
