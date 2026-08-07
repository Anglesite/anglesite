import { describe, it, expect } from "vitest";
import { OpQueue } from "../src/op-queue.js";
import type { OpQueueEvent } from "../src/op-queue.js";
import { ModelSync } from "../src/model-sync.js";
import { FixtureHost } from "../src/testing/fixture-host.js";
import type { BlockModel, Op } from "../src/types.js";

function makeModel(): BlockModel {
  return {
    path: "src/pages/index.astro",
    version: "v1",
    rootIds: ["b1"],
    blocks: { b1: { id: "b1", kind: "astro", componentName: "Hero", props: {}, slots: {}, sourceSpan: [0, 1] } },
  };
}

describe("OpQueue", () => {
  it("applies an op, updates ModelSync, and emits 'applied' with the op's inverse", async () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const sync = new ModelSync(model);
    const queue = new OpQueue(host, sync);
    const events: OpQueueEvent[] = [];
    queue.onEvent((e) => events.push(e));

    const op: Op = { kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" };
    const result = await queue.submit(op);

    expect(result.status).toBe("applied");
    expect(sync.current.blocks.b1?.props.title).toBe("Hi");
    expect(events).toEqual([
      {
        type: "applied",
        op,
        inverse: { kind: "setProp", blockId: "b1", propName: "title", value: "", previousValue: "Hi" },
        model: sync.current,
      },
    ]);
  });

  it("on version mismatch, adopts the fresh model and emits a 'rejected' event", async () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const sync = new ModelSync(model);
    const queue = new OpQueue(host, sync);
    const events: OpQueueEvent[] = [];
    queue.onEvent((e) => events.push(e));

    host.simulateExternalEdit({ ...model, version: "v2" });
    const op: Op = { kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" };
    const result = await queue.submit(op);

    expect(result.status).toBe("rejected");
    expect(sync.version).toBe("v2"); // adopted the fresh model, not left stale
    // The adopted model rides along on the event: a consumer that re-renders on "applied" alone
    // would otherwise keep showing the pre-rejection model while the engine holds the newer one.
    expect(events).toEqual([
      { type: "rejected", op, reason: "version-mismatch", message: expect.any(String), model: host.model },
    ]);
  });

  it("omits the model on a rejection that carried no fresh model", async () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const sync = new ModelSync(model);
    const queue = new OpQueue(host, sync);
    const events: OpQueueEvent[] = [];
    queue.onEvent((e) => events.push(e));

    const op: Op = { kind: "setProp", blockId: "missing", propName: "title", value: "Hi", previousValue: "" };
    await queue.submit(op);

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type !== "rejected") throw new Error("expected a rejected event");
    expect(event.reason).toBe("invalid-target");
    expect(event.model).toBeUndefined();
    expect(sync.version).toBe("v1"); // nothing adopted, nothing to re-render
  });

  it("retry() re-submits the op against the now-current version (the 'replay' path of spec §9)", async () => {
    const model = makeModel();
    const host = new FixtureHost(model);
    const sync = new ModelSync(model);
    const queue = new OpQueue(host, sync);

    host.simulateExternalEdit({ ...model, version: "v2" });
    const op: Op = { kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" };
    await queue.submit(op);

    const retryResult = await queue.retry(op);
    expect(retryResult.status).toBe("applied");
  });
});
