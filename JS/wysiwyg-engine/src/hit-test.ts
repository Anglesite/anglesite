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
