import { describe, it, expect } from "vitest";
import { pickerTheme } from "../template/src/toolbar/picker-theme.js";

describe("pickerTheme", () => {
  it("exports a frozen theme object", () => {
    expect(Object.isFrozen(pickerTheme)).toBe(true);
  });

  describe("color tokens", () => {
    it("has warm neutral surface colors", () => {
      expect(pickerTheme.surface).toBeDefined();
      expect(pickerTheme.surfaceMuted).toBeDefined();
      expect(pickerTheme.border).toBeDefined();
    });

    it("has text colors", () => {
      expect(pickerTheme.text).toBeDefined();
      expect(pickerTheme.textMuted).toBeDefined();
      expect(pickerTheme.textFaint).toBeDefined();
    });

    it("has a single warm accent color", () => {
      expect(pickerTheme.accent).toBeDefined();
      expect(pickerTheme.accentMuted).toBeDefined();
    });

    it("has highlight colors for the picker overlay", () => {
      expect(pickerTheme.highlightBorder).toBeDefined();
      expect(pickerTheme.highlightBackground).toBeDefined();
    });

    it("has resolve/success color", () => {
      expect(pickerTheme.success).toBeDefined();
      expect(pickerTheme.successMuted).toBeDefined();
    });
  });

  describe("design tokens", () => {
    it("has border radius", () => {
      expect(pickerTheme.radius).toBeDefined();
      expect(pickerTheme.radiusSmall).toBeDefined();
    });

    it("has shadow", () => {
      expect(pickerTheme.shadow).toBeDefined();
    });

    it("has font stack", () => {
      expect(pickerTheme.fontFamily).toContain("system-ui");
    });
  });

  describe("no harsh colors", () => {
    const allColorValues = () => [
      pickerTheme.surface,
      pickerTheme.surfaceMuted,
      pickerTheme.border,
      pickerTheme.accent,
      pickerTheme.accentMuted,
      pickerTheme.highlightBorder,
      pickerTheme.highlightBackground,
    ];

    it("does not use saturated blue (#0000ff style)", () => {
      for (const color of allColorValues()) {
        expect(color).not.toMatch(/^#0000ff$/i);
      }
    });

    it("does not use neon or saturated purple (#7c3aed)", () => {
      for (const color of allColorValues()) {
        expect(color).not.toMatch(/^#7c3aed$/i);
      }
    });

    it("does not use dark DevTools background (#1e1e2e)", () => {
      expect(pickerTheme.surface).not.toBe("#1e1e2e");
    });
  });
});
