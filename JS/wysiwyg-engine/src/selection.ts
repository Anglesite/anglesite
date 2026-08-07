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
