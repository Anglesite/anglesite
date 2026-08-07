import { describe, it, expect } from "vitest";
import { invertOp } from "../src/ops.js";
import { ROOT_PARENT_ID } from "../src/types.js";
import type { Op, BlockNode } from "../src/types.js";

const sampleBlock: BlockNode = {
  id: "b1",
  kind: "astro",
  componentName: "Hero",
  props: { title: "Hi" },
  slots: {},
  sourceSpan: [0, 5],
};

describe("invertOp", () => {
  it("inverts insertBlock into a matching deleteBlock", () => {
    const op: Op = {
      kind: "insertBlock",
      parentId: ROOT_PARENT_ID,
      slot: "default",
      index: 0,
      newId: "b1",
      block: { kind: "astro", componentName: "Hero", props: { title: "Hi" }, slots: {}, sourceSpan: [0, 5] },
    };
    expect(invertOp(op)).toEqual({
      kind: "deleteBlock",
      parentId: ROOT_PARENT_ID,
      slot: "default",
      index: 0,
      blockId: "b1",
      block: sampleBlock,
    });
  });

  it("inverts deleteBlock into a matching insertBlock", () => {
    const op: Op = {
      kind: "deleteBlock",
      parentId: ROOT_PARENT_ID,
      slot: "default",
      index: 0,
      blockId: "b1",
      block: sampleBlock,
    };
    expect(invertOp(op)).toEqual({
      kind: "insertBlock",
      parentId: ROOT_PARENT_ID,
      slot: "default",
      index: 0,
      newId: "b1",
      block: { kind: "astro", componentName: "Hero", props: { title: "Hi" }, slots: {}, sourceSpan: [0, 5] },
    });
  });

  it("swaps from/to on moveBlock", () => {
    const op: Op = {
      kind: "moveBlock",
      blockId: "b1",
      fromParentId: ROOT_PARENT_ID,
      fromSlot: "default",
      fromIndex: 0,
      toParentId: ROOT_PARENT_ID,
      toSlot: "default",
      toIndex: 2,
    };
    expect(invertOp(op)).toEqual({
      kind: "moveBlock",
      blockId: "b1",
      fromParentId: ROOT_PARENT_ID,
      fromSlot: "default",
      fromIndex: 2,
      toParentId: ROOT_PARENT_ID,
      toSlot: "default",
      toIndex: 0,
    });
  });

  it("swaps value/previousValue on setProp, editText, and setDesignToken", () => {
    expect(
      invertOp({ kind: "setProp", blockId: "b1", propName: "title", value: "New", previousValue: "Old" }),
    ).toEqual({ kind: "setProp", blockId: "b1", propName: "title", value: "Old", previousValue: "New" });

    expect(
      invertOp({
        kind: "editText",
        blockId: "b1",
        runs: [{ kind: "text", text: "new" }],
        previousRuns: [{ kind: "text", text: "old" }],
      }),
    ).toEqual({
      kind: "editText",
      blockId: "b1",
      runs: [{ kind: "text", text: "old" }],
      previousRuns: [{ kind: "text", text: "new" }],
    });

    expect(
      invertOp({ kind: "setDesignToken", tokenName: "color-primary", value: "#000", previousValue: "#fff" }),
    ).toEqual({ kind: "setDesignToken", tokenName: "color-primary", value: "#fff", previousValue: "#000" });
  });

  it("round-trips: inverting an op twice restores the original", () => {
    const op: Op = { kind: "setProp", blockId: "b1", propName: "title", value: "New", previousValue: "Old" };
    expect(invertOp(invertOp(op))).toEqual(op);
  });
});
