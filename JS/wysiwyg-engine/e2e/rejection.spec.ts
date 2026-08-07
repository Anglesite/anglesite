import { test, expect } from "@playwright/test";

test("a version-mismatch rejection is surfaced visibly and the gesture does not silently apply", async ({ page }) => {
  await page.goto("/fixture.html");
  await page.evaluate(() => window.__host.forceReject("version-mismatch", "stale"));

  const result = await page.evaluate(() => window.__moveBlock("b1", 1));
  expect(result).toMatchObject({ status: "rejected", reason: "version-mismatch" });

  await page.waitForFunction(() => document.title === "event:rejected");

  // Order is unchanged — the gesture did not silently apply — and the rejection was observable
  // (the title flip above), not swallowed.
  const after = await page.locator("#canvas > div").allTextContents();
  expect(after[0]).toContain("Hero");
});
