import { describe, it, expect } from "vitest";
import { WysiwygEngine } from "../src/engine.js";
import type { EngineEvent } from "../src/engine.js";
import { FixtureHost } from "../src/testing/fixture-host.js";
import { ROOT_PARENT_ID } from "../src/types.js";
import type { BlockModel, Op } from "../src/types.js";

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

  it("retry() replays a rejected op against the now-current version, like submit() would", async () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const engine = new WysiwygEngine(model, host);
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));
    const op: Op = { kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" };

    host.forceReject("version-mismatch", "stale");
    const rejected = await engine.submit(op);
    expect(rejected.status).toBe("rejected");
    expect(engine.modelSync.current.blocks.b1?.props.title).toBeUndefined();

    // The replay half of the contract is reachable from the engine itself, not only opQueue.
    const replayed = await engine.retry(op);

    expect(replayed.status).toBe("applied");
    expect(engine.modelSync.current.blocks.b1?.props.title).toBe("Hi");
    expect(events.filter((e) => e.type === "applied")).toHaveLength(1);
  });

  it("clears the selection when an external update removes the selected block", () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const engine = new WysiwygEngine(model, host);
    engine.selection.select("b1");
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    host.simulateExternalEdit({ ...model, version: "v2", rootIds: [], blocks: {} });

    expect(engine.selection.current).toBeNull();
    expect(events).toContainEqual({ type: "selection-changed", blockId: null });
  });

  it("keeps the selection when the selected block survives an external update", () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const engine = new WysiwygEngine(model, host);
    engine.selection.select("b1");

    host.simulateExternalEdit({ ...model, version: "v2" });

    expect(engine.selection.current).toBe("b1");
  });

  it("clears the selection when an applied op deletes the selected block", async () => {
    const model = makeModel();
    const engine = new WysiwygEngine(model, new FixtureHost(model));
    const b1 = model.blocks.b1;
    if (!b1) throw new Error("b1 missing from the fixture model");
    engine.selection.select("b1");
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    await engine.submit({
      kind: "deleteBlock",
      blockId: "b1",
      parentId: ROOT_PARENT_ID,
      slot: "default",
      index: 0,
      block: b1,
    });

    expect(engine.selection.current).toBeNull();
    expect(events).toContainEqual({ type: "selection-changed", blockId: null });
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
