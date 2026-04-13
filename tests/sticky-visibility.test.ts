import { describe, it, expect } from "vitest";
import { isElementVisible } from "../template/src/toolbar/sticky-visibility.js";

describe("isElementVisible", () => {
  const viewport = { width: 1024, height: 768 };

  it("returns true when element is fully within viewport", () => {
    const rect = { top: 100, left: 100, bottom: 200, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(true);
  });

  it("returns true when element is partially visible at top", () => {
    const rect = { top: -50, left: 100, bottom: 50, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(true);
  });

  it("returns true when element is partially visible at bottom", () => {
    const rect = { top: 700, left: 100, bottom: 850, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(true);
  });

  it("returns true when element is partially visible at left", () => {
    const rect = { top: 100, left: -50, bottom: 200, right: 50 };
    expect(isElementVisible(rect, viewport)).toBe(true);
  });

  it("returns true when element is partially visible at right", () => {
    const rect = { top: 100, left: 990, bottom: 200, right: 1100 };
    expect(isElementVisible(rect, viewport)).toBe(true);
  });

  it("returns false when element is completely above viewport", () => {
    const rect = { top: -200, left: 100, bottom: -10, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element is completely below viewport", () => {
    const rect = { top: 800, left: 100, bottom: 900, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element is completely to the left", () => {
    const rect = { top: 100, left: -300, bottom: 200, right: -10 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element is completely to the right", () => {
    const rect = { top: 100, left: 1100, bottom: 200, right: 1300 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element bottom is exactly at viewport top (0)", () => {
    const rect = { top: -100, left: 100, bottom: 0, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element top is exactly at viewport bottom", () => {
    const rect = { top: 768, left: 100, bottom: 868, right: 300 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element right is exactly at viewport left (0)", () => {
    const rect = { top: 100, left: -100, bottom: 200, right: 0 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });

  it("returns false when element left is exactly at viewport right", () => {
    const rect = { top: 100, left: 1024, bottom: 200, right: 1124 };
    expect(isElementVisible(rect, viewport)).toBe(false);
  });
});
