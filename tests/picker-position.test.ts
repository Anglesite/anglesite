import { describe, it, expect } from "vitest";
import { computePopoverPosition } from "../template/src/toolbar/picker-position.js";

describe("computePopoverPosition", () => {
  const popoverWidth = 280;
  const popoverHeight = 160;
  const viewport = { width: 1024, height: 768 };

  describe("default placement (below element)", () => {
    it("positions below the element with 8px gap", () => {
      const rect = { top: 100, left: 200, bottom: 140, right: 400, width: 200, height: 40 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      expect(pos.top).toBe(148); // bottom + 8
      expect(pos.left).toBe(200); // aligned with element left
    });
  });

  describe("near bottom of viewport", () => {
    it("flips above the element when not enough space below", () => {
      const rect = { top: 650, left: 200, bottom: 690, right: 400, width: 200, height: 40 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      // Should flip above: top - popoverHeight - 8
      expect(pos.top).toBe(650 - popoverHeight - 8);
    });

    it("flips above even for elements very near viewport bottom", () => {
      const rect = { top: 740, left: 200, bottom: 768, right: 400, width: 200, height: 28 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      expect(pos.top).toBeLessThan(rect.top);
    });
  });

  describe("near right edge of viewport", () => {
    it("shifts left so popover stays within viewport", () => {
      const rect = { top: 100, left: 900, bottom: 140, right: 1020, width: 120, height: 40 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      expect(pos.left).toBeLessThanOrEqual(viewport.width - popoverWidth - 8);
    });
  });

  describe("near left edge of viewport", () => {
    it("clamps left to minimum padding", () => {
      const rect = { top: 100, left: 2, bottom: 140, right: 102, width: 100, height: 40 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      expect(pos.left).toBeGreaterThanOrEqual(8);
    });
  });

  describe("near top of viewport (flipped above would go offscreen)", () => {
    it("stays below when both above and below are tight, preferring below", () => {
      // Element near top — flipping above would go negative
      const rect = { top: 20, left: 200, bottom: 60, right: 400, width: 200, height: 40 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      // Enough space below (768 - 60 - 8 = 700 > 160), so stays below
      expect(pos.top).toBe(68); // bottom + 8
    });
  });

  describe("very small viewport", () => {
    it("clamps position to stay on screen", () => {
      const small = { width: 320, height: 480 };
      const rect = { top: 400, left: 100, bottom: 440, right: 300, width: 200, height: 40 };
      const pos = computePopoverPosition(rect, small, popoverWidth, popoverHeight);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.left).toBeGreaterThanOrEqual(8);
      expect(pos.left + popoverWidth).toBeLessThanOrEqual(small.width);
    });
  });

  describe("return shape", () => {
    it("returns top and left as numbers", () => {
      const rect = { top: 100, left: 200, bottom: 140, right: 400, width: 200, height: 40 };
      const pos = computePopoverPosition(rect, viewport, popoverWidth, popoverHeight);
      expect(typeof pos.top).toBe("number");
      expect(typeof pos.left).toBe("number");
    });
  });
});
