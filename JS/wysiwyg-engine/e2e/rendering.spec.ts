import { test, expect } from "@playwright/test";

test("an external model update (e.g. a hand edit via HMR) re-renders the canvas without an engine-originated op", async ({
  page,
}) => {
  await page.goto("/fixture.html");
  await page.evaluate(() => {
    const model = window.__engine.modelSync.current;
    const updated = {
      ...model,
      version: "fixture-external-edit",
      rootIds: [...model.rootIds, "b3"],
      blocks: {
        ...model.blocks,
        b3: { id: "b3", kind: "astro" as const, componentName: "Newsletter", props: {}, slots: {}, sourceSpan: [21, 30] as [number, number] },
      },
    };
    window.__host.simulateExternalEdit(updated);
  });
  await expect(page.locator('[data-anglesite-block-id="b3"]')).toContainText("Newsletter");
});
