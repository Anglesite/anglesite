// Real-browser coverage for the two engine surfaces jsdom structurally cannot exercise, both of
// them acceptance bullets of #1223: `hitTest()` needs `Document#elementFromPoint` (stubbed to
// always return null in jsdom) and `computeHandleRect()` needs real `getBoundingClientRect`
// geometry (always zeros in jsdom). test/hit-test.test.ts and test/selection.test.ts cover only
// the pure halves and point here for the rest.
import { test, expect } from "@playwright/test";

test("hitTest() resolves a real viewport point to the block rendered under it", async ({ page }) => {
  await page.goto("/fixture.html");

  const box = await page.locator('[data-anglesite-block-id="b2"]').boundingBox();
  if (!box) throw new Error("b2 has no layout box");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const hit = await page.evaluate((point) => window.__engine.hitTest(point), center);
  expect(hit).toBe("b2");

  // The neighbouring block's centre resolves to *that* block, not to whichever was found first.
  const otherBox = await page.locator('[data-anglesite-block-id="b1"]').boundingBox();
  if (!otherBox) throw new Error("b1 has no layout box");
  const otherHit = await page.evaluate(
    (point) => window.__engine.hitTest(point),
    { x: otherBox.x + otherBox.width / 2, y: otherBox.y + otherBox.height / 2 },
  );
  expect(otherHit).toBe("b1");

  // A point over no block at all resolves to null rather than to the nearest one.
  const miss = await page.evaluate(() => window.__engine.hitTest({ x: 5000, y: 5000 }));
  expect(miss).toBeNull();
});

test("computeHandleRect() reports the selected block's real on-screen geometry", async ({ page }) => {
  await page.goto("/fixture.html");

  const box = await page.locator('[data-anglesite-block-id="b1"]').boundingBox();
  if (!box) throw new Error("b1 has no layout box");

  const rect = await page.evaluate(() => window.__computeHandleRect("b1"));
  if (!rect) throw new Error("expected a handle rect for b1");

  // Non-zero is the assertion jsdom can never make — this is the whole point of the e2e pass.
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x).toBeCloseTo(box.x, 0);
  expect(rect.y).toBeCloseTo(box.y, 0);
  expect(rect.width).toBeCloseTo(box.width, 0);
  expect(rect.height).toBeCloseTo(box.height, 0);

  // Handles track the block, not a fixed position: the second block sits below the first.
  const secondRect = await page.evaluate(() => window.__computeHandleRect("b2"));
  if (!secondRect) throw new Error("expected a handle rect for b2");
  expect(secondRect.y).toBeGreaterThan(rect.y);

  expect(await page.evaluate(() => window.__computeHandleRect("no-such-block"))).toBeNull();
});
