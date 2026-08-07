import { describe, it, expect } from "vitest";
import { FixtureHost } from "../src/testing/fixture-host.js";
import { ROOT_PARENT_ID } from "../src/types.js";
import type { BlockModel } from "../src/types.js";

function makeModel(): BlockModel {
  return {
    path: "src/pages/index.astro",
    version: "v1",
    rootIds: ["b1", "b2"],
    blocks: {
      b1: { id: "b1", kind: "astro", componentName: "Hero", props: {}, slots: {}, sourceSpan: [0, 1] },
      b2: { id: "b2", kind: "astro", componentName: "Testimonial", props: {}, slots: {}, sourceSpan: [1, 2] },
    },
  };
}

describe("FixtureHost", () => {
  it("applies insertBlock, moveBlock, setProp, deleteBlock at the root level", async () => {
    const host = new FixtureHost(makeModel());

    const insert = await host.sendOp({
      id: "op-1",
      targetVersion: host.model.version,
      op: {
        kind: "insertBlock",
        parentId: ROOT_PARENT_ID,
        slot: "default",
        index: 2,
        newId: "b3",
        block: { kind: "astro", componentName: "Newsletter", props: {}, slots: {}, sourceSpan: [2, 3] },
      },
    });
    expect(insert.status).toBe("applied");
    expect(host.model.rootIds).toEqual(["b1", "b2", "b3"]);

    const move = await host.sendOp({
      id: "op-2",
      targetVersion: host.model.version,
      op: {
        kind: "moveBlock",
        blockId: "b3",
        fromParentId: ROOT_PARENT_ID,
        fromSlot: "default",
        fromIndex: 2,
        toParentId: ROOT_PARENT_ID,
        toSlot: "default",
        toIndex: 0,
      },
    });
    expect(move.status).toBe("applied");
    expect(host.model.rootIds).toEqual(["b3", "b1", "b2"]);

    const setProp = await host.sendOp({
      id: "op-3",
      targetVersion: host.model.version,
      op: { kind: "setProp", blockId: "b3", propName: "title", value: "Sign up", previousValue: "" },
    });
    expect(setProp.status).toBe("applied");
    expect(host.model.blocks.b3?.props.title).toBe("Sign up");

    const b3 = host.model.blocks.b3;
    if (!b3) throw new Error("b3 missing");
    const del = await host.sendOp({
      id: "op-4",
      targetVersion: host.model.version,
      op: { kind: "deleteBlock", blockId: "b3", parentId: ROOT_PARENT_ID, slot: "default", index: 0, block: b3 },
    });
    expect(del.status).toBe("applied");
    expect(host.model.rootIds).toEqual(["b1", "b2"]);
  });

  it("rejects with version-mismatch and a fresh model when the target version is stale", async () => {
    const host = new FixtureHost(makeModel());
    const result = await host.sendOp({
      id: "op-1",
      targetVersion: "stale",
      op: { kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" },
    });
    expect(result).toMatchObject({ status: "rejected", reason: "version-mismatch" });
    if (result.status !== "rejected") throw new Error("expected rejected");
    expect(result.freshModel).toBe(host.model);
  });

  it("rejects with invalid-target when the block does not exist", async () => {
    const host = new FixtureHost(makeModel());
    const result = await host.sendOp({
      id: "op-1",
      targetVersion: host.model.version,
      op: { kind: "setProp", blockId: "missing", propName: "title", value: "Hi", previousValue: "" },
    });
    expect(result).toMatchObject({ status: "rejected", reason: "invalid-target" });
  });

  it("forceReject overrides the next sendOp", async () => {
    const host = new FixtureHost(makeModel());
    host.forceReject("host-error", "boom");
    const result = await host.sendOp({
      id: "op-1",
      targetVersion: host.model.version,
      op: { kind: "setProp", blockId: "b1", propName: "title", value: "Hi", previousValue: "" },
    });
    expect(result).toMatchObject({ status: "rejected", reason: "host-error", message: "boom" });
  });

  it("notifies onModelUpdate listeners on simulateExternalEdit", () => {
    const host = new FixtureHost(makeModel());
    const seen: BlockModel[] = [];
    host.onModelUpdate((m) => seen.push(m));
    const updated = { ...makeModel(), version: "v2" };
    host.simulateExternalEdit(updated);
    expect(seen).toEqual([updated]);
  });
});
