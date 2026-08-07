import { describe, it, expect } from "vitest";
import { WysiwygEngine } from "../src/engine.js";
import { FixtureHost } from "../src/testing/fixture-host.js";
import type { BlockModel, EngineEvent } from "../src/types.js";

function makeModel(): BlockModel {
  return {
    path: "src/pages/index.astro",
    version: "v1",
    rootIds: ["b1"],
    blocks: { b1: { id: "b1", kind: "astro", componentName: "Hero", props: {}, slots: {}, sourceSpan: [0, 1] } },
  };
}

describe("WysiwygEngine", () => {
  it("re-renders its own model when the host pushes an external update", () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const engine = new WysiwygEngine(model, host);
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    const updated: BlockModel = { ...model, version: "v2" };
    host.simulateExternalEdit(updated);

    expect(engine.modelSync.current).toBe(updated);
    expect(events).toContainEqual({ type: "model-updated", model: updated });
  });

  it("forwards selection changes as engine events", () => {
    const model = makeModel();
    const engine = new WysiwygEngine(model, new FixtureHost(model));
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    engine.selection.select("b1");

    expect(events).toContainEqual({ type: "selection-changed", blockId: "b1" });
  });

  it("forwards op-queue events as engine events via submit()", async () => {
    const model = makeModel();
    const engine = new WysiwygEngine(model, new FixtureHost(model));
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    await engine.submit({ kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" });

    expect(events.some((e) => e.type === "applied")).toBe(true);
  });

  it("dispose() stops forwarding further events", () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const engine = new WysiwygEngine(model, host);
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));
    engine.dispose();

    host.simulateExternalEdit({ ...model, version: "v2" });
    engine.selection.select("b1");

    expect(events).toEqual([]);
  });
});
