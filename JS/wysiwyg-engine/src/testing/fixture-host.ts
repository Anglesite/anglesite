import type {
  BlockModel,
  BlockNode,
  HostTransport,
  Op,
  OpEnvelope,
  OpResult,
  BlockId,
  ParentRef,
  OpRejectionReason,
} from "../types.js";
import { ROOT_PARENT_ID } from "../types.js";

/** Fixture-only, dependency-free stand-in for the sidecar's real content hash (`fileVersion()` in
 *  `Anglesite/anglesite-skills`'s server hashes actual source bytes). Good enough to detect
 *  "something in the block tree changed" for tests — never treat this as a real hash algorithm. */
function hashModel(rootIds: BlockId[], blocks: Record<BlockId, BlockNode>): string {
  const json = JSON.stringify({ rootIds, blocks });
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
  }
  return `fixture-${h}`;
}

function spliceIntoSlot(
  blocks: Record<BlockId, BlockNode>,
  rootIds: BlockId[],
  parentId: ParentRef,
  slot: string,
  index: number,
  blockId: BlockId,
  mode: "insert" | "remove",
): boolean {
  if (parentId === ROOT_PARENT_ID) {
    if (mode === "insert") {
      rootIds.splice(index, 0, blockId);
    } else {
      const i = rootIds.indexOf(blockId);
      if (i === -1) return false;
      rootIds.splice(i, 1);
    }
    return true;
  }
  const parent = blocks[parentId];
  if (!parent) return false;
  const slotIds = [...(parent.slots[slot] ?? [])];
  if (mode === "insert") {
    slotIds.splice(index, 0, blockId);
  } else {
    const i = slotIds.indexOf(blockId);
    if (i === -1) return false;
    slotIds.splice(i, 1);
  }
  blocks[parentId] = { ...parent, slots: { ...parent.slots, [slot]: slotIds } };
  return true;
}

function applyOp(model: BlockModel, op: Op): BlockModel | null {
  const blocks = { ...model.blocks };
  const rootIds = [...model.rootIds];

  switch (op.kind) {
    case "insertBlock": {
      blocks[op.newId] = { ...op.block, id: op.newId };
      if (!spliceIntoSlot(blocks, rootIds, op.parentId, op.slot, op.index, op.newId, "insert")) return null;
      break;
    }
    case "deleteBlock": {
      if (!spliceIntoSlot(blocks, rootIds, op.parentId, op.slot, op.index, op.blockId, "remove")) return null;
      delete blocks[op.blockId];
      break;
    }
    case "moveBlock": {
      if (!spliceIntoSlot(blocks, rootIds, op.fromParentId, op.fromSlot, op.fromIndex, op.blockId, "remove")) {
        return null;
      }
      if (!spliceIntoSlot(blocks, rootIds, op.toParentId, op.toSlot, op.toIndex, op.blockId, "insert")) return null;
      break;
    }
    case "setProp": {
      const block = blocks[op.blockId];
      if (!block) return null;
      blocks[op.blockId] = { ...block, props: { ...block.props, [op.propName]: op.value } };
      break;
    }
    case "editText": {
      const block = blocks[op.blockId];
      if (!block) return null;
      blocks[op.blockId] = { ...block, richText: op.runs };
      break;
    }
    case "setDesignToken": {
      // Design tokens aren't part of the block tree the fixture models — accepted and
      // round-tripped through the ops layer, but no observable effect on this model.
      break;
    }
    default:
      return null;
  }

  return { ...model, blocks, rootIds, version: hashModel(rootIds, blocks) };
}

/** In-memory `HostTransport` standing in for the real sidecar-backed host (#1222, not yet
 *  shipped) — used by unit tests and by e2e/fixture-page.ts for the Playwright goldens. Test-only:
 *  never re-exported from src/index.ts. */
export class FixtureHost implements HostTransport {
  #model: BlockModel;
  #listeners = new Set<(model: BlockModel) => void>();
  #forceRejectNext: { reason: OpRejectionReason; message?: string } | null = null;

  constructor(initialModel: BlockModel) {
    this.#model = initialModel;
  }

  get model(): BlockModel {
    return this.#model;
  }

  /** Test hook: make the next sendOp() reject regardless of version, e.g. to simulate a host-side
   *  failure unrelated to staleness. */
  forceReject(reason: OpRejectionReason, message?: string): void {
    this.#forceRejectNext = { reason, message };
  }

  /** Test hook: mutate the model out from under a pending op, as an outside hand edit would
   *  (spec §9's "roundtrip honesty" scenario). */
  simulateExternalEdit(model: BlockModel): void {
    this.#model = model;
    for (const listener of this.#listeners) listener(model);
  }

  async sendOp(envelope: OpEnvelope): Promise<OpResult> {
    if (this.#forceRejectNext) {
      const { reason, message } = this.#forceRejectNext;
      this.#forceRejectNext = null;
      return reason === "version-mismatch"
        ? { status: "rejected", reason, message, freshModel: this.#model }
        : { status: "rejected", reason, message };
    }
    if (envelope.targetVersion !== this.#model.version) {
      return { status: "rejected", reason: "version-mismatch", freshModel: this.#model, message: "stale model version" };
    }
    const next = applyOp(this.#model, envelope.op);
    if (next === null) {
      return { status: "rejected", reason: "invalid-target", message: "target block not found" };
    }
    this.#model = next;
    return { status: "applied", model: next };
  }

  onModelUpdate(listener: (model: BlockModel) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
