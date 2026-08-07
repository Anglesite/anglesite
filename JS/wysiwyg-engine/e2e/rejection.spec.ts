import { test, expect } from "@playwright/test";

test("a version-mismatch rejection is surfaced visibly and the gesture does not silently apply", async ({ page }) => {
  await page.goto("/fixture.html");
  await page.evaluate(() => window.__host.forceReject("version-mismatch", "stale"));

  const result = await page.evaluate(() => window.__moveBlock("b1", 1));
  expect(result).toMatchObject({ status: "rejected", reason: "version-mismatch" });

  await page.waitForFunction(() => document.title === "event:rejected");

  // The gesture did not silently apply: b1 is still ahead of b2.
  const order = await page.locator("#canvas > div").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-anglesite-block-id")),
  );
  expect(order.indexOf("b1")).toBeLessThan(order.indexOf("b2"));
});

test("the fresh model that came with the rejection is adopted AND rendered", async ({ page }) => {
  await page.goto("/fixture.html");
  // FixtureHost's forced version-mismatch advances its own model (adding a synthetic "HostEdit"
  // root block the engine has never seen) and returns that as freshModel — so "did the canvas
  // follow the host?" is answerable from the DOM, not just from a version string.
  await page.evaluate(() => window.__host.forceReject("version-mismatch", "stale"));
  await page.evaluate(() => window.__moveBlock("b1", 1));
  await page.waitForFunction(() => document.title === "event:rejected");

  // The rejection carried the adopted model...
  const eventModelVersion = await page.evaluate(
    () =>
      new Promise<string | undefined>((resolve) => {
        const stop = window.__engine.onEvent((event) => {
          if (event.type !== "rejected") return;
          stop();
          resolve(event.model?.version);
        });
        window.__host.forceReject("version-mismatch", "stale again");
        void window.__moveBlock("b1", 1);
      }),
  );
  expect(eventModelVersion).toBeTruthy();

  // ...the engine's model matches the host's rather than drifting from it...
  const [engineVersion, hostVersion] = await page.evaluate(() => [
    window.__engine.modelSync.current.version,
    window.__host.model.version,
  ]);
  expect(engineVersion).toBe(hostVersion);
  expect(engineVersion).toBe(eventModelVersion);

  // ...and the canvas re-rendered from it: both synthetic host edits are on screen. Without the
  // rejection carrying a model (and the host re-rendering on it), the DOM would still show the
  // pre-rejection two blocks while the engine held the host's newer four-block model.
  await expect(page.locator('[data-anglesite-block-id="host-edit-1"]')).toContainText("HostEdit");
  await expect(page.locator('[data-anglesite-block-id="host-edit-2"]')).toContainText("HostEdit");
});
