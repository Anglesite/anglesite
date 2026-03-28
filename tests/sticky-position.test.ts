import { describe, it, expect } from "vitest";
import { computeBadgePosition, computeCardPosition } from "../template/src/toolbar/sticky-position.js";

describe("computeBadgePosition", () => {
  const viewport = { width: 1024, height: 768 };

  it("places badge at the top-right edge of the target element", () => {
    const rect = { top: 100, left: 200, bottom: 200, right: 500, width: 300, height: 100 };
    const pos = computeBadgePosition(rect, viewport);
    // Badge sits at the top-right corner, offset slightly inward
    expect(pos.top).toBe(rect.top - 12); // half badge height above element top
    expect(pos.left).toBe(rect.right - 12); // overlap element right edge
  });

  it("clamps badge to right edge of viewport", () => {
    const rect = { top: 100, left: 900, bottom: 200, right: 1020, width: 120, height: 100 };
    const pos = computeBadgePosition(rect, viewport);
    // Badge should not overflow viewport right
    expect(pos.left).toBeLessThanOrEqual(viewport.width - 4);
  });

  it("clamps badge to top edge of viewport", () => {
    const rect = { top: 2, left: 200, bottom: 50, right: 500, width: 300, height: 48 };
    const pos = computeBadgePosition(rect, viewport);
    expect(pos.top).toBeGreaterThanOrEqual(0);
  });

  it("clamps badge to left edge when element is at left viewport edge", () => {
    const rect = { top: 100, left: 0, bottom: 200, right: 30, width: 30, height: 100 };
    const pos = computeBadgePosition(rect, viewport);
    expect(pos.left).toBeGreaterThanOrEqual(0);
  });

  it("returns top and left as numbers", () => {
    const rect = { top: 100, left: 200, bottom: 200, right: 500, width: 300, height: 100 };
    const pos = computeBadgePosition(rect, viewport);
    expect(typeof pos.top).toBe("number");
    expect(typeof pos.left).toBe("number");
  });
});

describe("computeCardPosition", () => {
  const viewport = { width: 1024, height: 768 };
  const cardWidth = 260;
  const cardHeight = 120;

  it("places card below the badge by default", () => {
    const badgePos = { top: 88, left: 488 };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);
    // Card below badge with 6px gap
    expect(pos.top).toBe(badgePos.top + 24 + 6); // badge height (24) + gap (6)
    expect(pos.left).toBe(badgePos.left);
  });

  it("flips card above badge when not enough space below", () => {
    const badgePos = { top: 720, left: 200 };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);
    // Card above badge
    expect(pos.top).toBe(720 - cardHeight - 6);
  });

  it("clamps card to right edge of viewport", () => {
    const badgePos = { top: 100, left: 900 };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);
    expect(pos.left + cardWidth).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("clamps card to left edge of viewport", () => {
    const badgePos = { top: 100, left: 2 };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);
    expect(pos.left).toBeGreaterThanOrEqual(8);
  });

  it("clamps card vertically to stay on screen", () => {
    const badgePos = { top: 5, left: 200 };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);
    expect(pos.top).toBeGreaterThanOrEqual(0);
  });

  it("returns top and left as numbers", () => {
    const badgePos = { top: 100, left: 200 };
    const pos = computeCardPosition(badgePos, viewport, cardWidth, cardHeight);
    expect(typeof pos.top).toBe("number");
    expect(typeof pos.left).toBe("number");
  });
});
