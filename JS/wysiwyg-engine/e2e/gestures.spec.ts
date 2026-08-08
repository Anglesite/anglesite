import { test, expect } from "@playwright/test";

test("clicking a block selects it and is reflected via a data attribute, not direct styling", async ({ page }) => {
  await page.goto("/fixture.html");
  await page.click('[data-anglesite-block-id="b2"]');
  await expect(page.locator('[data-anglesite-block-id="b2"]')).toHaveAttribute("data-anglesite-selected", "true");
  await expect(page.locator('[data-anglesite-block-id="b1"]')).toHaveAttribute("data-anglesite-selected", "false");
});

test("a moveBlock gesture reorders the canvas through a re-render, not a direct DOM mutation", async ({ page }) => {
  await page.goto("/fixture.html");
  const before = await page.locator("#canvas > div").allTextContents();
  expect(before[0]).toContain("Hero");

  await page.evaluate(() => window.__moveBlock("b1", 1));
  await page.waitForFunction(() => document.title === "event:applied");

  const after = await page.locator("#canvas > div").allTextContents();
  expect(after[0]).toContain("Testimonial");
  expect(after[1]).toContain("Hero");
});
