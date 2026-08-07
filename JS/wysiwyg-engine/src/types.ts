// The ops protocol (spec: docs/superpowers/specs/2026-08-03-modern-wysiwyg-editor-design.md §3.2).
// This file has no runtime logic beyond the ROOT_PARENT_ID sentinel — it is the shared vocabulary
// every other module in this package (and, eventually, every host) speaks.

export type BlockId = string;

export type PropValue = string | number | boolean | null | { [key: string]: PropValue } | PropValue[];

export interface RichTextRun {
  kind: "text" | "strong" | "em" | "link" | "code";
  text: string;
  /** Only meaningful when kind === "link". */
  href?: string;
  children?: RichTextRun[];
}

export type BlockKind = "astro" | "custom-element" | "text";

export interface BlockNode {
  id: BlockId;
  kind: BlockKind;
  /** Manifest component name (e.g. "Testimonial"), or a tag/role name for "text" blocks. */
  componentName: string;
  props: Record<string, PropValue>;
  /** Slot name -> ordered child block IDs. Empty for leaf/text blocks. */
  slots: Record<string, BlockId[]>;
  /** [start, end) byte offsets into the source file this block was parsed from. */
  sourceSpan: [number, number];
  /** Present only on "text" blocks — the rich-text runs `editText` operates on. */
  richText?: RichTextRun[];
}

/** Sentinel parent for blocks that live at the page root rather than inside another block's slot. */
export const ROOT_PARENT_ID = "__root__" as const;
export type ParentRef = BlockId | typeof ROOT_PARENT_ID;

export interface BlockModel {
  /** Project-relative path of the page this model describes. */
  path: string;
  /** Content hash of the page's current source — the staleness signal (spec §3.2, §9). */
  version: string;
  rootIds: BlockId[];
  blocks: Record<BlockId, BlockNode>;
}

// Engine -> host semantic ops (spec §3.2). Every variant here MUST have a matching case in
// ops.ts's invertOp — that is the protocol's "no op ships without its inverse" guarantee.
export type Op =
  | {
      kind: "insertBlock";
      parentId: ParentRef;
      slot: string;
      index: number;
      newId: BlockId;
      block: Omit<BlockNode, "id">;
    }
  | {
      kind: "deleteBlock";
      parentId: ParentRef;
      slot: string;
      index: number;
      blockId: BlockId;
      block: BlockNode;
    }
  | {
      kind: "moveBlock";
      blockId: BlockId;
      fromParentId: ParentRef;
      fromSlot: string;
      fromIndex: number;
      toParentId: ParentRef;
      toSlot: string;
      toIndex: number;
    }
  | {
      kind: "setProp";
      blockId: BlockId;
      propName: string;
      value: PropValue;
      previousValue: PropValue;
    }
  | {
      kind: "editText";
      blockId: BlockId;
      runs: RichTextRun[];
      previousRuns: RichTextRun[];
    }
  | {
      kind: "setDesignToken";
      tokenName: string;
      value: string;
      previousValue: string;
    };

export interface OpEnvelope {
  id: string;
  /** The model version (content hash) this op was computed against — spec §9. */
  targetVersion: string;
  op: Op;
}

export type OpRejectionReason = "version-mismatch" | "invalid-target" | "host-error";

export type OpResult =
  | { status: "applied"; model: BlockModel }
  | {
      status: "rejected";
      reason: OpRejectionReason;
      message?: string;
      /** Sent by the host on version-mismatch so the engine can replay against current state. */
      freshModel?: BlockModel;
    };

/** Host -> engine seam (spec §3.2/§3.3). A real host adapts this to the sidecar's MCP transport;
 *  FixtureHost (src/testing/fixture-host.ts) adapts it to an in-memory model for tests. */
export interface HostTransport {
  sendOp(envelope: OpEnvelope): Promise<OpResult>;
  /** Host-initiated model push — a re-render notification, e.g. after an outside hand edit. */
  onModelUpdate(listener: (model: BlockModel) => void): () => void;
}

// Re-declared here (not in engine.ts) so test files can import both the engine's event type and
// the protocol types from one place without creating an import cycle with op-queue.ts.
export type EngineEvent =
  | { type: "model-updated"; model: BlockModel }
  | { type: "selection-changed"; blockId: BlockId | null }
  | { type: "applied"; op: Op; inverse: Op; model: BlockModel }
  | { type: "rejected"; op: Op; reason: OpRejectionReason; message?: string };
