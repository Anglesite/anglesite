# WYSIWYG Overlay Engine Core (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the portable, dependency-free TypeScript overlay engine core for the modern WYSIWYG page editor (issue #1223, part of epic #1221) — model sync with content-hash staleness detection, block selection + handles, a hit-testing service, semantic-op emission with mandatory inverses, visible op-rejection handling, and headless Playwright golden tests against an in-memory fixture host.

**Architecture:** A new `JS/wysiwyg-engine/` package (successor to `JS/edit-overlay/` at page level) exports a `WysiwygEngine` class plus the ops-protocol types from `docs/superpowers/specs/2026-08-03-modern-wysiwyg-editor-design.md` §3.2. The engine never mutates the DOM as an act of editing — every gesture becomes a semantic `Op` sent through a host-supplied `HostTransport`; the DOM is a projection driven by `model-updated`/`applied` events. A `FixtureHost` (in-memory `HostTransport` implementation) stands in for the real sidecar-backed host (#1222, not yet shipped) for both `vitest` unit tests and Playwright e2e goldens — this is deliberate: the issue itself specifies "headless Playwright tests against a fixture host," so slice 2 does not block on slice 1's MCP schema landing.

**Tech Stack:** TypeScript (ES2022 target, strict), Vitest (+ jsdom for DOM-touching unit tests), Playwright (`@playwright/test`) for e2e goldens, esbuild for the e2e fixture bundle, oxlint. No runtime dependencies — the engine itself imports nothing beyond the TypeScript standard lib and DOM types, per spec §3.1 ("dependency-free").

## Global Constraints

- Engine code ships **zero runtime dependencies** — `src/**` may only use ES2022/DOM APIs, never an npm package (spec §3.1). devDependencies (test/build tooling) are fine.
- **Every op ships with its inverse** — no op type or op-construction path may exist without a corresponding entry in `invertOp` (spec §3.2, hard requirement).
- **The engine never mutates the DOM as an act of editing** — DOM changes only ever happen inside a `render()` driven by a `model-updated`/`applied` event, never inside gesture-handling code directly (spec §3.1).
- **Op rejection is never silent** — every `rejected` outcome must be observable through the engine's event stream (spec §9).
- Match `JS/edit-overlay/`'s established toolchain and pinned devDependency versions where the same tool is reused (`@types/node`, `esbuild`, `jsdom`, `oxlint`, `typescript`, `vitest`) — see `JS/edit-overlay/package.json`.
- Node **>=22**, `"type": "module"`, ES modules throughout — matches `JS/edit-overlay/`.
- `tsconfig.json` uses `verbatimModuleSyntax: true` — every type-only import must be a separate `import type { ... }` statement (never inline `type X`), matching `JS/edit-overlay/src/messages.ts`'s existing style.
- `noUncheckedIndexedAccess: true` — every `record[key]` access is `T | undefined`; guard before use, never assume presence.
- New JS toolchain devDependencies (Playwright) are pre-approved by issue #1223's own text ("Headless Playwright tests against a fixture host") — no separate approval step needed.
- CI must gate this package the same way it gates `JS/edit-overlay/` (path-filtered job + required-checks aggregation) — a package with no CI wiring is untested in practice.

---

## File Structure

```
JS/wysiwyg-engine/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── src/
│   ├── types.ts              # protocol types: BlockModel, BlockNode, Op union, HostTransport, ROOT_PARENT_ID
│   ├── ops.ts                 # invertOp() — the single source of truth for "every op has an inverse"
│   ├── model-sync.ts          # ModelSync — holds current model, content-hash staleness detection
│   ├── hit-test.ts            # hitTest()/blockIdForElement() — DOM point → block ID
│   ├── selection.ts           # SelectionState, findBlockElement(), computeHandleRect()
│   ├── op-queue.ts            # OpQueue — submits ops, applies/rejects, visible rejection events
│   ├── engine.ts              # WysiwygEngine — wires model sync + selection + op queue + hit-test
│   ├── index.ts                # public barrel export (production surface — no fixture-host)
│   └── testing/
│       └── fixture-host.ts    # FixtureHost — in-memory HostTransport for tests/e2e (test-only, not in index.ts)
├── test/
│   ├── sanity.test.ts
│   ├── ops.test.ts
│   ├── model-sync.test.ts
│   ├── hit-test.test.ts
│   ├── selection.test.ts
│   ├── fixture-host.test.ts
│   ├── op-queue.test.ts
│   └── engine.test.ts
└── e2e/
    ├── static-server.mjs      # dependency-free static file server for Playwright's webServer
    ├── fixture.html
    ├── fixture-page.ts        # boots WysiwygEngine + FixtureHost against fixture.html, exposes window.__engine
    ├── gestures.spec.ts       # golden: gesture → op → re-render
    ├── rendering.spec.ts      # golden: external model update → chrome re-render
    └── rejection.spec.ts      # golden: op rejection is visible, never silently dropped
```

---

### Task 1: Package scaffold

**Files:**
- Create: `JS/wysiwyg-engine/package.json`
- Create: `JS/wysiwyg-engine/tsconfig.json`
- Create: `JS/wysiwyg-engine/vitest.config.ts`
- Create: `JS/wysiwyg-engine/test/sanity.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the `npm run lint` / `npm run typecheck` / `npm test` script names every later task's CI/test instructions assume.

- [ ] **Step 1: Create the package directory and `package.json`**

```json
{
  "name": "@anglesite/wysiwyg-engine",
  "version": "0.1.0",
  "private": true,
  "description": "Portable, dependency-free TypeScript overlay engine for the WYSIWYG page editor (spec: docs/superpowers/specs/2026-08-03-modern-wysiwyg-editor-design.md). Successor to JS/edit-overlay/ at page level.",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src test e2e",
    "test": "vitest run",
    "test:watch": "vitest",
    "build:e2e": "esbuild e2e/fixture-page.ts --bundle --format=iife --target=es2022 --outfile=e2e/.generated/fixture-bundle.js",
    "test:e2e": "npm run build:e2e && playwright test"
  },
  "devDependencies": {
    "@types/node": "^26.1.2",
    "esbuild": "^0.28.1",
    "jsdom": "^30.0.1",
    "oxlint": "^1.76.0",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (mirrors `JS/edit-overlay/tsconfig.json`, adds `e2e/`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "e2e/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`** (mirrors `JS/edit-overlay/vitest.config.ts`)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `environment` is set per-file via `// @vitest-environment` so pure-logic tests can stay on
    // Node and DOM-behavior tests can opt in to jsdom. Default to node for speed.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing sanity test**

`JS/wysiwyg-engine/test/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("package scaffold", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Install dependencies and generate the lock file**

```bash
cd JS/wysiwyg-engine && npm install
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd JS/wysiwyg-engine && npm test`
Expected: PASS (1 test)

Also run: `npm run typecheck && npm run lint` — both should pass cleanly on the empty scaffold.

- [ ] **Step 7: Gitignore the e2e build/output directories**

In `.gitignore`, after the `node_modules/` line (currently line 51), add:

```gitignore
JS/wysiwyg-engine/e2e/.generated/
JS/wysiwyg-engine/test-results/
JS/wysiwyg-engine/playwright-report/
```

- [ ] **Step 8: Commit**

```bash
git add JS/wysiwyg-engine/package.json JS/wysiwyg-engine/package-lock.json \
  JS/wysiwyg-engine/tsconfig.json JS/wysiwyg-engine/vitest.config.ts \
  JS/wysiwyg-engine/test/sanity.test.ts .gitignore
git commit -m "feat(#1223): scaffold JS/wysiwyg-engine package"
```

---

### Task 2: Protocol types + op inversion

**Files:**
- Create: `JS/wysiwyg-engine/src/types.ts`
- Create: `JS/wysiwyg-engine/src/ops.ts`
- Test: `JS/wysiwyg-engine/test/ops.test.ts`

**Interfaces:**
- Produces: `BlockId`, `PropValue`, `RichTextRun`, `BlockKind`, `BlockNode`, `BlockModel`, `ROOT_PARENT_ID`, `ParentRef`, `Op`, `OpEnvelope`, `OpRejectionReason`, `OpResult`, `HostTransport` (all from `types.ts`); `invertOp(op: Op): Op` (from `ops.ts`). Every later task imports from these two files.

- [ ] **Step 1: Write `src/types.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/ops.ts`**

```ts
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
```

- [ ] **Step 3: Write the failing test** `JS/wysiwyg-engine/test/ops.test.ts`

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `cd JS/wysiwyg-engine && npm test -- ops`
Expected: PASS (5 tests). Also run `npm run typecheck` — the `Op` switch in `invertOp` has no `default`, so TypeScript's control-flow analysis already fails the build if a case is missing a `return` (exhaustiveness is enforced by the compiler, not a runtime check).

- [ ] **Step 5: Commit**

```bash
git add JS/wysiwyg-engine/src/types.ts JS/wysiwyg-engine/src/ops.ts JS/wysiwyg-engine/test/ops.test.ts
git commit -m "feat(#1223): add ops protocol types and invertOp"
```

---

### Task 3: Model sync (content-hash staleness)

**Files:**
- Create: `JS/wysiwyg-engine/src/model-sync.ts`
- Test: `JS/wysiwyg-engine/test/model-sync.test.ts`

**Interfaces:**
- Consumes: `BlockModel`, `BlockId`, `BlockNode` (types.ts).
- Produces: `class ModelSync { constructor(initialModel: BlockModel); get current(): BlockModel; get version(): string; isStale(targetVersion: string): boolean; applyModel(model: BlockModel): void; getBlock(id: BlockId): BlockNode | undefined; }` — consumed by `op-queue.ts` and `engine.ts`.

- [ ] **Step 1: Write the failing test** `JS/wysiwyg-engine/test/model-sync.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ModelSync } from "../src/model-sync.js";
import type { BlockModel } from "../src/types.js";

function makeModel(): BlockModel {
  return {
    path: "src/pages/index.astro",
    version: "v1",
    rootIds: ["b1"],
    blocks: { b1: { id: "b1", kind: "astro", componentName: "Hero", props: {}, slots: {}, sourceSpan: [0, 1] } },
  };
}

describe("ModelSync", () => {
  it("reports the initial version", () => {
    expect(new ModelSync(makeModel()).version).toBe("v1");
  });

  it("detects staleness against the current version", () => {
    const sync = new ModelSync(makeModel());
    expect(sync.isStale("v1")).toBe(false);
    expect(sync.isStale("v0")).toBe(true);
  });

  it("adopts a new model and updates the version", () => {
    const sync = new ModelSync(makeModel());
    const next: BlockModel = { ...makeModel(), version: "v2" };
    sync.applyModel(next);
    expect(sync.version).toBe("v2");
    expect(sync.current).toBe(next);
  });

  it("refuses to adopt a model for a different page", () => {
    const sync = new ModelSync(makeModel());
    expect(() => sync.applyModel({ ...makeModel(), path: "src/pages/about.astro" })).toThrow();
  });

  it("looks up a block by id, or undefined when absent", () => {
    const sync = new ModelSync(makeModel());
    expect(sync.getBlock("b1")?.componentName).toBe("Hero");
    expect(sync.getBlock("missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd JS/wysiwyg-engine && npm test -- model-sync`
Expected: FAIL — `Cannot find module '../src/model-sync.js'`

- [ ] **Step 3: Write `src/model-sync.ts`**

```ts
import type { BlockModel, BlockId, BlockNode } from "./types.js";

/** Holds the engine's current view of one page's block model and answers the staleness question
 *  every op-targeting decision depends on (spec §3.2/§9: versioning by content hash). */
export class ModelSync {
  #model: BlockModel;

  constructor(initialModel: BlockModel) {
    this.#model = initialModel;
  }

  get current(): BlockModel {
    return this.#model;
  }

  get version(): string {
    return this.#model.version;
  }

  isStale(targetVersion: string): boolean {
    return targetVersion !== this.#model.version;
  }

  applyModel(model: BlockModel): void {
    if (model.path !== this.#model.path) {
      throw new Error(`ModelSync: model path changed from ${this.#model.path} to ${model.path}`);
    }
    this.#model = model;
  }

  getBlock(id: BlockId): BlockNode | undefined {
    return this.#model.blocks[id];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd JS/wysiwyg-engine && npm test -- model-sync`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add JS/wysiwyg-engine/src/model-sync.ts JS/wysiwyg-engine/test/model-sync.test.ts
git commit -m "feat(#1223): add ModelSync content-hash staleness detection"
```

---

### Task 4: Hit-testing service

**Files:**
- Create: `JS/wysiwyg-engine/src/hit-test.ts`
- Test: `JS/wysiwyg-engine/test/hit-test.test.ts`

**Interfaces:**
- Consumes: `BlockId` (types.ts).
- Produces: `BLOCK_ID_ATTR` (string const), `interface Point { x: number; y: number }`, `hitTest(point: Point, doc?: Document): BlockId | null`, `blockIdForElement(el: Element | null): BlockId | null` — consumed by `selection.ts` and `engine.ts`.

- [ ] **Step 1: Write the failing test** `JS/wysiwyg-engine/test/hit-test.test.ts`

```ts
// @vitest-environment jsdom
//
// jsdom has no layout engine, so `Document#elementFromPoint` is stubbed to always return null —
// there is no way to unit-test `hitTest()`'s point-based lookup here. This file covers the pure
// DOM-traversal half (`blockIdForElement`); `hitTest()`'s point resolution is covered by the
// Playwright e2e goldens (e2e/gestures.spec.ts) against a real browser layout engine.
import { describe, it, expect, beforeEach } from "vitest";
import { blockIdForElement, BLOCK_ID_ATTR } from "../src/hit-test.js";

describe("blockIdForElement", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div ${BLOCK_ID_ATTR}="parent">
        <span id="child"><em id="grandchild">text</em></span>
      </div>
      <div id="outside"></div>
    `;
  });

  it("finds the block id on the element itself", () => {
    const el = document.querySelector(`[${BLOCK_ID_ATTR}]`);
    expect(blockIdForElement(el)).toBe("parent");
  });

  it("walks up to the nearest ancestor carrying the block id", () => {
    expect(blockIdForElement(document.getElementById("grandchild"))).toBe("parent");
  });

  it("returns null when no ancestor carries a block id", () => {
    expect(blockIdForElement(document.getElementById("outside"))).toBeNull();
  });

  it("returns null for a null element", () => {
    expect(blockIdForElement(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd JS/wysiwyg-engine && npm test -- hit-test`
Expected: FAIL — `Cannot find module '../src/hit-test.js'`

- [ ] **Step 3: Write `src/hit-test.ts`**

```ts
import type { BlockId } from "./types.js";

/** DOM attribute every block-projecting element carries, targeted by CSS-attribute selectors
 *  elsewhere (selection.ts) and walked here for hit-testing. */
export const BLOCK_ID_ATTR = "data-anglesite-block-id";

export interface Point {
  x: number;
  y: number;
}

/** Host context menus and click/drag gestures resolve a screen point to the block under it —
 *  spec §8.1: "the engine hit-tests and reports the block under the cursor; the host builds the
 *  menu." Relies on `elementFromPoint`, which needs a real layout engine (see hit-test.test.ts). */
export function hitTest(point: Point, doc: Document = document): BlockId | null {
  return blockIdForElement(doc.elementFromPoint(point.x, point.y));
}

/** Walks up from `el` to the nearest ancestor (inclusive) carrying `BLOCK_ID_ATTR`. */
export function blockIdForElement(el: Element | null): BlockId | null {
  let node: Element | null = el;
  while (node) {
    const id = node.getAttribute(BLOCK_ID_ATTR);
    if (id) return id;
    node = node.parentElement;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd JS/wysiwyg-engine && npm test -- hit-test`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add JS/wysiwyg-engine/src/hit-test.ts JS/wysiwyg-engine/test/hit-test.test.ts
git commit -m "feat(#1223): add hit-testing service"
```

---

### Task 5: Block selection + handles

**Files:**
- Create: `JS/wysiwyg-engine/src/selection.ts`
- Test: `JS/wysiwyg-engine/test/selection.test.ts`

**Interfaces:**
- Consumes: `BlockId` (types.ts), `BLOCK_ID_ATTR` (hit-test.ts).
- Produces: `interface HandleRect { x: number; y: number; width: number; height: number }`, `class SelectionState { get current(): BlockId | null; select(id: BlockId | null): void; clear(): void; onChange(listener: (id: BlockId | null) => void): () => void }`, `findBlockElement(id: BlockId, root?: ParentNode): Element | null`, `computeHandleRect(id: BlockId, root?: ParentNode): HandleRect | null` — `SelectionState` is consumed by `engine.ts`.

- [ ] **Step 1: Write the failing test** `JS/wysiwyg-engine/test/selection.test.ts`

```ts
// @vitest-environment jsdom
//
// jsdom's `getBoundingClientRect` always returns zeros (no layout engine), so
// `computeHandleRect` here only proves the wiring (present block -> a rect shape, missing block ->
// null); real handle geometry is covered by the Playwright e2e goldens.
import { describe, it, expect, beforeEach } from "vitest";
import { SelectionState, findBlockElement, computeHandleRect } from "../src/selection.js";
import { BLOCK_ID_ATTR } from "../src/hit-test.js";

describe("SelectionState", () => {
  it("starts with nothing selected", () => {
    expect(new SelectionState().current).toBeNull();
  });

  it("notifies listeners on change, and not on a no-op re-select", () => {
    const state = new SelectionState();
    const seen: (string | null)[] = [];
    state.onChange((id) => seen.push(id));
    state.select("b1");
    state.select("b1");
    state.select("b2");
    state.clear();
    expect(seen).toEqual(["b1", "b2", null]);
  });

  it("stops notifying after unsubscribe", () => {
    const state = new SelectionState();
    const seen: (string | null)[] = [];
    const unsubscribe = state.onChange((id) => seen.push(id));
    unsubscribe();
    state.select("b1");
    expect(seen).toEqual([]);
  });
});

describe("findBlockElement / computeHandleRect", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div ${BLOCK_ID_ATTR}="b1">hero</div>`;
  });

  it("finds the element carrying a block id", () => {
    expect(findBlockElement("b1")?.textContent).toBe("hero");
  });

  it("returns null for a missing block id", () => {
    expect(findBlockElement("missing")).toBeNull();
  });

  it("returns a rect shape for a present block, null for a missing one", () => {
    expect(computeHandleRect("b1")).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(computeHandleRect("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd JS/wysiwyg-engine && npm test -- selection`
Expected: FAIL — `Cannot find module '../src/selection.js'`

- [ ] **Step 3: Write `src/selection.ts`**

```ts
import type { BlockId } from "./types.js";
import { BLOCK_ID_ATTR } from "./hit-test.js";

export interface HandleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The engine's single-block selection (spec §3.1: "block selection and handles"). Multi-select
 *  is out of scope for this core slice — canvas chrome (#1224) layers it on if needed. */
export class SelectionState {
  #selected: BlockId | null = null;
  #listeners = new Set<(id: BlockId | null) => void>();

  get current(): BlockId | null {
    return this.#selected;
  }

  select(id: BlockId | null): void {
    if (id === this.#selected) return;
    this.#selected = id;
    for (const listener of this.#listeners) listener(id);
  }

  clear(): void {
    this.select(null);
  }

  onChange(listener: (id: BlockId | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** Block IDs are engine-generated (never raw user text), so a conservative manual escape covers
 *  the only characters that could break the attribute selector below. */
function escapeAttrValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function findBlockElement(id: BlockId, root: ParentNode = document): Element | null {
  return root.querySelector(`[${BLOCK_ID_ATTR}="${escapeAttrValue(id)}"]`);
}

/** Selection-handle geometry for host chrome to draw an outline/handles around. */
export function computeHandleRect(id: BlockId, root: ParentNode = document): HandleRect | null {
  const el = findBlockElement(id, root);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd JS/wysiwyg-engine && npm test -- selection`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add JS/wysiwyg-engine/src/selection.ts JS/wysiwyg-engine/test/selection.test.ts
git commit -m "feat(#1223): add block selection state and handle geometry"
```

---

### Task 6: Fixture host

**Files:**
- Create: `JS/wysiwyg-engine/src/testing/fixture-host.ts`
- Test: `JS/wysiwyg-engine/test/fixture-host.test.ts`

**Interfaces:**
- Consumes: `BlockModel`, `BlockNode`, `BlockId`, `HostTransport`, `Op`, `OpEnvelope`, `OpResult`, `OpRejectionReason`, `ROOT_PARENT_ID` (types.ts).
- Produces: `class FixtureHost implements HostTransport { constructor(initialModel: BlockModel); get model(): BlockModel; forceReject(reason: OpRejectionReason, message?: string): void; simulateExternalEdit(model: BlockModel): void; sendOp(envelope: OpEnvelope): Promise<OpResult>; onModelUpdate(listener: (model: BlockModel) => void): () => void }` — consumed by `op-queue.test.ts`, `engine.test.ts`, and `e2e/fixture-page.ts`. **Not** re-exported from `src/index.ts` — it is test-only, not part of the production engine surface.

- [ ] **Step 1: Write the failing test** `JS/wysiwyg-engine/test/fixture-host.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd JS/wysiwyg-engine && npm test -- fixture-host`
Expected: FAIL — `Cannot find module '../src/testing/fixture-host.js'`

- [ ] **Step 3: Write `src/testing/fixture-host.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd JS/wysiwyg-engine && npm test -- fixture-host`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add JS/wysiwyg-engine/src/testing/fixture-host.ts JS/wysiwyg-engine/test/fixture-host.test.ts
git commit -m "feat(#1223): add in-memory FixtureHost for tests and e2e goldens"
```

---

### Task 7: Op queue (submission + visible rejection handling)

**Files:**
- Create: `JS/wysiwyg-engine/src/op-queue.ts`
- Test: `JS/wysiwyg-engine/test/op-queue.test.ts`

**Interfaces:**
- Consumes: `HostTransport`, `Op`, `OpEnvelope`, `OpResult`, `BlockModel`, `OpRejectionReason` (types.ts); `invertOp` (ops.ts); `ModelSync` (model-sync.ts); `FixtureHost` (testing/fixture-host.ts, test-only).
- Produces: `interface AppliedEvent { type: "applied"; op: Op; inverse: Op; model: BlockModel }`, `interface RejectedEvent { type: "rejected"; op: Op; reason: OpRejectionReason; message?: string }`, `type OpQueueEvent = AppliedEvent | RejectedEvent`, `class OpQueue { constructor(transport: HostTransport, modelSync: ModelSync); onEvent(listener: (event: OpQueueEvent) => void): () => void; submit(op: Op): Promise<OpResult>; retry(op: Op): Promise<OpResult> }` — consumed by `engine.ts`.

- [ ] **Step 1: Write the failing test** `JS/wysiwyg-engine/test/op-queue.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { OpQueue } from "../src/op-queue.js";
import { ModelSync } from "../src/model-sync.js";
import { FixtureHost } from "../src/testing/fixture-host.js";
import type { BlockModel, Op, OpQueueEvent } from "../src/types.js";

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
    expect(events).toEqual([
      { type: "rejected", op, reason: "version-mismatch", message: expect.any(String) },
    ]);
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd JS/wysiwyg-engine && npm test -- op-queue`
Expected: FAIL — `Cannot find module '../src/op-queue.js'`

- [ ] **Step 3: Write `src/op-queue.ts`**

```ts
import type { HostTransport, Op, OpEnvelope, OpResult, BlockModel, OpRejectionReason } from "./types.js";
import { invertOp } from "./ops.js";
import { ModelSync } from "./model-sync.js";

export interface AppliedEvent {
  type: "applied";
  op: Op;
  inverse: Op;
  model: BlockModel;
}

export interface RejectedEvent {
  type: "rejected";
  op: Op;
  reason: OpRejectionReason;
  message?: string;
}

export type OpQueueEvent = AppliedEvent | RejectedEvent;

let counter = 0;
function nextOpId(): string {
  counter += 1;
  return `op-${counter}`;
}

/**
 * Submits ops to the host and turns every outcome into an event a caller must observe — the
 * mechanism behind spec §9's "no silent loss." A rejection is never swallowed: it is always an
 * emitted `RejectedEvent`, and on version-mismatch the fresh model is adopted into `modelSync`
 * before the event fires, so `retry()` (the "replay" half of §9) targets current state.
 */
export class OpQueue {
  #transport: HostTransport;
  #modelSync: ModelSync;
  #listeners = new Set<(event: OpQueueEvent) => void>();

  constructor(transport: HostTransport, modelSync: ModelSync) {
    this.#transport = transport;
    this.#modelSync = modelSync;
  }

  onEvent(listener: (event: OpQueueEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async submit(op: Op): Promise<OpResult> {
    const envelope: OpEnvelope = { id: nextOpId(), targetVersion: this.#modelSync.version, op };
    const result = await this.#transport.sendOp(envelope);

    if (result.status === "applied") {
      this.#modelSync.applyModel(result.model);
      this.#emit({ type: "applied", op, inverse: invertOp(op), model: result.model });
      return result;
    }

    if (result.reason === "version-mismatch" && result.freshModel) {
      this.#modelSync.applyModel(result.freshModel);
    }
    this.#emit({ type: "rejected", op, reason: result.reason, message: result.message });
    return result;
  }

  /** Re-submits `op` against the current model version — the "replay" outcome of spec §9's
   *  rejection handling. Callers choose "drop" simply by not calling this. */
  retry(op: Op): Promise<OpResult> {
    return this.submit(op);
  }

  #emit(event: OpQueueEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd JS/wysiwyg-engine && npm test -- op-queue`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add JS/wysiwyg-engine/src/op-queue.ts JS/wysiwyg-engine/test/op-queue.test.ts
git commit -m "feat(#1223): add OpQueue with visible op-rejection handling"
```

---

### Task 8: Engine + public barrel

**Files:**
- Create: `JS/wysiwyg-engine/src/engine.ts`
- Create: `JS/wysiwyg-engine/src/index.ts`
- Test: `JS/wysiwyg-engine/test/engine.test.ts`

**Interfaces:**
- Consumes: `BlockModel`, `BlockId`, `HostTransport`, `Op` (types.ts); `Point` (hit-test.ts); `OpQueueEvent` (op-queue.ts); `ModelSync`, `SelectionState`, `OpQueue`, `hitTest` (value imports).
- Produces: `type EngineEvent = { type: "model-updated"; model: BlockModel } | { type: "selection-changed"; blockId: BlockId | null } | OpQueueEvent`, `class WysiwygEngine { readonly modelSync: ModelSync; readonly selection: SelectionState; readonly opQueue: OpQueue; constructor(initialModel: BlockModel, transport: HostTransport); hitTest(point: Point, doc?: Document): BlockId | null; submit(op: Op): Promise<OpResult>; onEvent(listener: (event: EngineEvent) => void): () => void; dispose(): void }` — this is the package's top-level consumer-facing API, used by `e2e/fixture-page.ts` and (in later slices) a real host.

- [ ] **Step 1: Write the failing test** `JS/wysiwyg-engine/test/engine.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd JS/wysiwyg-engine && npm test -- engine`
Expected: FAIL — `Cannot find module '../src/engine.js'`

- [ ] **Step 3: Add `EngineEvent` to `src/types.ts`**

Append to `JS/wysiwyg-engine/src/types.ts` (after the `HostTransport` interface):

```ts

// Re-declared here (not in engine.ts) so test files can import both the engine's event type and
// the protocol types from one place without creating an import cycle with op-queue.ts.
export type EngineEvent =
  | { type: "model-updated"; model: BlockModel }
  | { type: "selection-changed"; blockId: BlockId | null }
  | { type: "applied"; op: Op; inverse: Op; model: BlockModel }
  | { type: "rejected"; op: Op; reason: OpRejectionReason; message?: string };
```

- [ ] **Step 4: Write `src/engine.ts`**

```ts
import type { BlockModel, BlockId, HostTransport, Op, OpResult, EngineEvent } from "./types.js";
import type { Point } from "./hit-test.js";
import { ModelSync } from "./model-sync.js";
import { SelectionState } from "./selection.js";
import { OpQueue } from "./op-queue.js";
import { hitTest } from "./hit-test.js";

/**
 * The portable overlay engine core (spec §3.1). Wires model sync, selection, hit-testing, and the
 * op queue together behind one event stream. Owns nothing about rendering — a host (or, in this
 * slice's tests, e2e/fixture-page.ts) subscribes via `onEvent` and re-renders its own DOM
 * projection in response; the engine never touches the DOM itself.
 */
export class WysiwygEngine {
  readonly modelSync: ModelSync;
  readonly selection = new SelectionState();
  readonly opQueue: OpQueue;

  #listeners = new Set<(event: EngineEvent) => void>();
  #unsubscribeModel: () => void;
  #unsubscribeSelection: () => void;
  #unsubscribeOps: () => void;

  constructor(initialModel: BlockModel, transport: HostTransport) {
    this.modelSync = new ModelSync(initialModel);
    this.opQueue = new OpQueue(transport, this.modelSync);

    this.#unsubscribeModel = transport.onModelUpdate((model) => {
      this.modelSync.applyModel(model);
      this.#emit({ type: "model-updated", model });
    });
    this.#unsubscribeSelection = this.selection.onChange((blockId) => {
      this.#emit({ type: "selection-changed", blockId });
    });
    this.#unsubscribeOps = this.opQueue.onEvent((event) => this.#emit(event));
  }

  hitTest(point: Point, doc: Document = document): BlockId | null {
    return hitTest(point, doc);
  }

  submit(op: Op): Promise<OpResult> {
    return this.opQueue.submit(op);
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#unsubscribeModel();
    this.#unsubscribeSelection();
    this.#unsubscribeOps();
  }

  #emit(event: EngineEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
```

- [ ] **Step 5: Write `src/index.ts`** (public barrel — deliberately excludes `testing/fixture-host.ts`)

```ts
// Public production surface of @anglesite/wysiwyg-engine. `src/testing/fixture-host.ts` is
// intentionally not re-exported here — it is a test double, not part of the dependency-free
// engine a real host consumes.
export * from "./types.js";
export * from "./ops.js";
export * from "./model-sync.js";
export * from "./hit-test.js";
export * from "./selection.js";
export * from "./op-queue.js";
export * from "./engine.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd JS/wysiwyg-engine && npm test`
Expected: PASS (all tests across every file so far). Also run `npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add JS/wysiwyg-engine/src/engine.ts JS/wysiwyg-engine/src/index.ts \
  JS/wysiwyg-engine/src/types.ts JS/wysiwyg-engine/test/engine.test.ts
git commit -m "feat(#1223): add WysiwygEngine and public barrel export"
```

---

### Task 9: Playwright goldens against the fixture host

**Files:**
- Create: `JS/wysiwyg-engine/playwright.config.ts`
- Create: `JS/wysiwyg-engine/e2e/static-server.mjs`
- Create: `JS/wysiwyg-engine/e2e/fixture.html`
- Create: `JS/wysiwyg-engine/e2e/fixture-page.ts`
- Create: `JS/wysiwyg-engine/e2e/gestures.spec.ts`
- Create: `JS/wysiwyg-engine/e2e/rendering.spec.ts`
- Create: `JS/wysiwyg-engine/e2e/rejection.spec.ts`
- Modify: `JS/wysiwyg-engine/package.json`

**Interfaces:**
- Consumes: `WysiwygEngine` (engine.ts), `FixtureHost` (testing/fixture-host.ts), `ROOT_PARENT_ID` (types.ts).
- Produces: `window.__engine: WysiwygEngine`, `window.__host: FixtureHost`, `window.__moveBlock(blockId: string, toIndex: number): Promise<OpResult>` on the fixture page — the surface the three golden specs drive.

- [ ] **Step 1: Add the Playwright devDependency**

```bash
cd JS/wysiwyg-engine && npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  webServer: {
    command: "node e2e/static-server.mjs",
    url: "http://127.0.0.1:4173/fixture.html",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
});
```

- [ ] **Step 3: Write `e2e/static-server.mjs`** (dependency-free — no new runtime dep just to serve two static files)

```js
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const path = req.url === "/" ? "/fixture.html" : (req.url ?? "/fixture.html");
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(4173, "127.0.0.1", () => {
  console.log("fixture server listening on http://127.0.0.1:4173");
});
```

- [ ] **Step 4: Write `e2e/fixture.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>WYSIWYG engine fixture</title>
  </head>
  <body>
    <div id="canvas"></div>
    <script src="./.generated/fixture-bundle.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `e2e/fixture-page.ts`**

```ts
import { WysiwygEngine } from "../src/engine.js";
import { FixtureHost } from "../src/testing/fixture-host.js";
import { ROOT_PARENT_ID } from "../src/types.js";
import type { BlockModel, OpResult } from "../src/types.js";

const initialModel: BlockModel = {
  path: "src/pages/index.astro",
  version: "fixture-initial",
  rootIds: ["b1", "b2"],
  blocks: {
    b1: { id: "b1", kind: "astro", componentName: "Hero", props: { title: "Welcome" }, slots: {}, sourceSpan: [0, 10] },
    b2: { id: "b2", kind: "astro", componentName: "Testimonial", props: { quote: "Great!" }, slots: {}, sourceSpan: [11, 20] },
  },
};

const host = new FixtureHost(initialModel);
const engine = new WysiwygEngine(initialModel, host);

function canvas(): HTMLElement {
  const el = document.getElementById("canvas");
  if (!el) throw new Error("fixture.html is missing #canvas");
  return el;
}

function render(model: BlockModel): void {
  const root = canvas();
  root.innerHTML = "";
  for (const id of model.rootIds) {
    const block = model.blocks[id];
    if (!block) continue;
    const el = document.createElement("div");
    el.setAttribute("data-anglesite-block-id", id);
    el.setAttribute("data-component", block.componentName);
    el.setAttribute("data-anglesite-selected", "false");
    el.textContent = `${block.componentName} (${id})`;
    el.style.cssText = "padding:8px;margin:4px;border:1px solid #ccc;";
    el.addEventListener("click", () => engine.selection.select(id));
    root.appendChild(el);
  }
}

engine.onEvent((event) => {
  if (event.type === "model-updated" || event.type === "applied") {
    render(engine.modelSync.current);
  }
  if (event.type === "selection-changed") {
    for (const el of Array.from(canvas().children)) {
      const selected = el.getAttribute("data-anglesite-block-id") === event.blockId;
      el.setAttribute("data-anglesite-selected", String(selected));
    }
  }
  // Cheap, poll-able signal Playwright can wait on without a custom event bridge.
  document.title = `event:${event.type}`;
});

render(initialModel);

declare global {
  interface Window {
    __engine: WysiwygEngine;
    __host: FixtureHost;
    __moveBlock: (blockId: string, toIndex: number) => Promise<OpResult>;
  }
}

window.__engine = engine;
window.__host = host;
window.__moveBlock = (blockId, toIndex) => {
  const model = engine.modelSync.current;
  const fromIndex = model.rootIds.indexOf(blockId);
  return engine.submit({
    kind: "moveBlock",
    blockId,
    fromParentId: ROOT_PARENT_ID,
    fromSlot: "default",
    fromIndex,
    toParentId: ROOT_PARENT_ID,
    toSlot: "default",
    toIndex,
  });
};
```

- [ ] **Step 6: Write `e2e/gestures.spec.ts`** (golden: gesture → op → re-render)

```ts
import { test, expect } from "@playwright/test";

test("clicking a block selects it and is reflected via a data attribute, not direct styling", async ({ page }) => {
  await page.goto("/fixture.html");
  await page.click('[data-anglesite-block-id="b2"]');
  await expect(page.locator('[data-anglesite-block-id="b2"]')).toHaveAttribute("data-anglesite-selected", "true");
  await expect(page.locator('[data-anglesite-block-id="b1"]')).toHaveAttribute("data-anglesite-selected", "false");
});

test("a moveBlock gesture reorders the canvas through a re-render, not a direct DOM mutation", async ({ page }) => {
  await page.goto("/fixture.html");
  const before = await page.locator("#canvas > div").allTextContents();
  expect(before[0]).toContain("Hero");

  await page.evaluate(() => window.__moveBlock("b1", 1));
  await page.waitForFunction(() => document.title === "event:applied");

  const after = await page.locator("#canvas > div").allTextContents();
  expect(after[0]).toContain("Testimonial");
  expect(after[1]).toContain("Hero");
});
```

- [ ] **Step 7: Write `e2e/rendering.spec.ts`** (golden: model → chrome rendering)

```ts
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
```

- [ ] **Step 8: Write `e2e/rejection.spec.ts`** (golden: op rejection is visible, never silent)

```ts
import { test, expect } from "@playwright/test";

test("a version-mismatch rejection is surfaced visibly and the gesture does not silently apply", async ({ page }) => {
  await page.goto("/fixture.html");
  await page.evaluate(() => window.__host.forceReject("version-mismatch", "stale"));

  const result = await page.evaluate(() => window.__moveBlock("b1", 1));
  expect(result).toMatchObject({ status: "rejected", reason: "version-mismatch" });

  await page.waitForFunction(() => document.title === "event:rejected");

  // Order is unchanged — the gesture did not silently apply — and the rejection was observable
  // (the title flip above), not swallowed.
  const after = await page.locator("#canvas > div").allTextContents();
  expect(after[0]).toContain("Hero");
});
```

- [ ] **Step 9: Run the e2e suite**

Run: `cd JS/wysiwyg-engine && npm run test:e2e`
Expected: PASS (4 tests across the three spec files)

- [ ] **Step 10: Run the full local check set**

Run: `cd JS/wysiwyg-engine && npm run lint && npm run typecheck && npm test && npm run test:e2e`
Expected: all PASS

- [ ] **Step 11: Commit**

```bash
git add JS/wysiwyg-engine/playwright.config.ts JS/wysiwyg-engine/e2e/ JS/wysiwyg-engine/package.json \
  JS/wysiwyg-engine/package-lock.json
git commit -m "feat(#1223): add Playwright goldens against the fixture host"
```

---

### Task 10: CI wiring

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `wysiwyg-engine` job name pattern established by the existing `edit-overlay` job (lines ~105–126 as of this plan).

- [ ] **Step 1: Add a `wysiwyg` path-change output to the `changes` job**

In `.github/workflows/ci.yml`, in the `changes` job's `outputs:` block, change:

```yaml
    outputs:
      swift: ${{ steps.filter.outputs.swift }}
      js: ${{ steps.filter.outputs.js }}
      template: ${{ steps.filter.outputs.template }}
      helpBook: ${{ steps.filter.outputs.helpBook }}
```

to:

```yaml
    outputs:
      swift: ${{ steps.filter.outputs.swift }}
      js: ${{ steps.filter.outputs.js }}
      wysiwyg: ${{ steps.filter.outputs.wysiwyg }}
      template: ${{ steps.filter.outputs.template }}
      helpBook: ${{ steps.filter.outputs.helpBook }}
```

- [ ] **Step 2: Add the path filter and output line**

In the same job's filter step, change:

```bash
          swift=false; js=false; template=false; helpBook=false
          matches 'Package.swift' 'Package.resolved' 'project.yml' 'Sources/**' 'Tests/**' 'Resources/Template/**' 'Resources/Attributions/**' 'scripts/**' '.github/workflows/ci.yml' && swift=true
          matches 'JS/edit-overlay/**' 'scripts/node-version.txt' '.github/workflows/ci.yml' && js=true
          matches 'Resources/Template/**' 'scripts/node-version.txt' 'scripts/generate-npm-attributions.mjs' 'scripts/attributions-overrides.json' '.github/workflows/ci.yml' && template=true
          matches 'Resources/Anglesite.help/**' 'scripts/check-help-links.sh' '.github/workflows/ci.yml' && helpBook=true

          echo "swift=$swift" >> "$GITHUB_OUTPUT"
          echo "js=$js" >> "$GITHUB_OUTPUT"
          echo "template=$template" >> "$GITHUB_OUTPUT"
          echo "helpBook=$helpBook" >> "$GITHUB_OUTPUT"
```

to:

```bash
          swift=false; js=false; wysiwyg=false; template=false; helpBook=false
          matches 'Package.swift' 'Package.resolved' 'project.yml' 'Sources/**' 'Tests/**' 'Resources/Template/**' 'Resources/Attributions/**' 'scripts/**' '.github/workflows/ci.yml' && swift=true
          matches 'JS/edit-overlay/**' 'scripts/node-version.txt' '.github/workflows/ci.yml' && js=true
          matches 'JS/wysiwyg-engine/**' 'scripts/node-version.txt' '.github/workflows/ci.yml' && wysiwyg=true
          matches 'Resources/Template/**' 'scripts/node-version.txt' 'scripts/generate-npm-attributions.mjs' 'scripts/attributions-overrides.json' '.github/workflows/ci.yml' && template=true
          matches 'Resources/Anglesite.help/**' 'scripts/check-help-links.sh' '.github/workflows/ci.yml' && helpBook=true

          echo "swift=$swift" >> "$GITHUB_OUTPUT"
          echo "js=$js" >> "$GITHUB_OUTPUT"
          echo "wysiwyg=$wysiwyg" >> "$GITHUB_OUTPUT"
          echo "template=$template" >> "$GITHUB_OUTPUT"
          echo "helpBook=$helpBook" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: Add the `wysiwyg-engine` job**

Immediately after the `edit-overlay` job (which ends right before the `template-worker` job), insert:

```yaml
  wysiwyg-engine:
    name: JS wysiwyg-engine (lint/typecheck/test/e2e)
    needs: changes
    if: needs.changes.outputs.wysiwyg == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: JS/wysiwyg-engine
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: scripts/node-version.txt
          cache: npm
          cache-dependency-path: JS/wysiwyg-engine/package-lock.json
      - run: npm ci --no-audit --no-fund
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

- [ ] **Step 4: Add the job to the required-checks aggregation**

In the `ci` job's `needs:` list, change:

```yaml
    needs:
      - changes
      - edit-overlay
      - help-book-links
```

to:

```yaml
    needs:
      - changes
      - edit-overlay
      - wysiwyg-engine
      - help-book-links
```

- [ ] **Step 5: Verify the YAML is well-formed**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: no output (parses cleanly). If `pyyaml` isn't available, visually diff against the `edit-overlay` job's structure instead.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(#1223): gate JS/wysiwyg-engine with its own CI job"
```

---

## Self-Review

**Spec coverage** (docs/superpowers/specs/2026-08-03-modern-wysiwyg-editor-design.md, cross-checked against issue #1223's bullet list):

- "Model sync (content-hash staleness detection)" → Task 3 (`ModelSync`).
- "block selection + handles" → Task 5 (`SelectionState`, `computeHandleRect`).
- "hit-testing service for host context menus" → Task 4 (`hitTest`/`blockIdForElement`).
- "Every gesture becomes a semantic op — the engine never mutates the DOM as an act of editing" → Task 2 (`Op` union + `invertOp`) and Task 8 (`WysiwygEngine.submit`); enforced structurally (`fixture-page.ts` only ever mutates the DOM inside `render()`, called from `onEvent`, never from the click handler directly) and demonstrated in Task 9's `gestures.spec.ts`.
- "Op rejection handling: on version mismatch, replay or drop visibly" → Task 7 (`OpQueue`'s `rejected` event + `retry()`), golden-tested in Task 9's `rejection.spec.ts`.
- "Headless Playwright tests against a fixture host: golden gesture → ops and model → chrome rendering" → Task 6 (`FixtureHost`) + Task 9 (`gestures.spec.ts`/`rejection.spec.ts` for gesture→ops, `rendering.spec.ts` for model→chrome rendering).
- Spec §3.2 "every op is invertible" → Task 2's `invertOp`, unit-tested per op kind plus a round-trip test.
- Spec §3.2 "content-hash version" / §9 "every op carries the model version it targeted" → `OpEnvelope.targetVersion` (Task 2) + `OpQueue.submit` (Task 7).
- Out of scope for this slice (confirmed against the epic #1221 slice list, not gaps): drag-to-rearrange UI, the block palette, breakpoint views, quality-gate chips, collaborator presence (canvas chrome, #1224); Mac host menus/NSUndoManager/inspector (#1225); AI services (#1227); CRDT collaboration (#1228). This plan builds the ops/model/selection/hit-test/rejection core only, matching #1223's own scope statement.

**Placeholder scan:** no TBD/TODO markers; every step has literal code, not a description of code.

**Type consistency:** `BlockId`, `BlockModel`, `BlockNode`, `Op`, `OpEnvelope`, `OpResult`, `OpRejectionReason`, `HostTransport`, `ROOT_PARENT_ID`/`ParentRef`, `EngineEvent` are all defined once in `src/types.ts` (Tasks 2 and 8) and referenced identically (name and shape) by every later task — `ModelSync`, `FixtureHost`, `OpQueue`, and `WysiwygEngine` all import from that one file rather than redeclaring.
