import type { BlockNode, Op } from "./types.js";

function stripId({ id, ...rest }: BlockNode): Omit<BlockNode, "id"> {
  void id;
  return rest;
}

/**
 * Every op ships with its inverse (spec §3.2) — this function is the single source of truth for
 * that guarantee. It is what lets a host register real undo, so a missing/wrong case here is a
 * protocol bug, not a style nit.
 */
export function invertOp(op: Op): Op {
  switch (op.kind) {
    case "insertBlock":
      return {
        kind: "deleteBlock",
        parentId: op.parentId,
        slot: op.slot,
        index: op.index,
        blockId: op.newId,
        block: { ...op.block, id: op.newId },
      };
    case "deleteBlock":
      return {
        kind: "insertBlock",
        parentId: op.parentId,
        slot: op.slot,
        index: op.index,
        newId: op.blockId,
        block: stripId(op.block),
      };
    case "moveBlock":
      return {
        kind: "moveBlock",
        blockId: op.blockId,
        fromParentId: op.toParentId,
        fromSlot: op.toSlot,
        fromIndex: op.toIndex,
        toParentId: op.fromParentId,
        toSlot: op.fromSlot,
        toIndex: op.fromIndex,
      };
    case "setProp":
      return {
        kind: "setProp",
        blockId: op.blockId,
        propName: op.propName,
        value: op.previousValue,
        previousValue: op.value,
      };
    case "editText":
      return {
        kind: "editText",
        blockId: op.blockId,
        runs: op.previousRuns,
        previousRuns: op.runs,
      };
    case "setDesignToken":
      return {
        kind: "setDesignToken",
        tokenName: op.tokenName,
        value: op.previousValue,
        previousValue: op.value,
      };
  }
}
