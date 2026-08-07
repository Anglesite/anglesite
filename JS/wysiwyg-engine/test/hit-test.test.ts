// @vitest-environment jsdom
//
// jsdom has no layout engine, so `Document#elementFromPoint` is stubbed to always return null —
// there is no way to unit-test `hitTest()`'s point-based lookup here. This file covers the pure
// DOM-traversal half (`blockIdForElement`); `hitTest()`'s point resolution is covered against a
// real browser layout engine by e2e/geometry.spec.ts ("hitTest() resolves a real viewport point to
// the block rendered under it").
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
