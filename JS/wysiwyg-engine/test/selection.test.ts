// @vitest-environment jsdom
//
// jsdom's `getBoundingClientRect` always returns zeros (no layout engine), so
// `computeHandleRect` here only proves the wiring (present block -> a rect shape, missing block ->
// null); real handle geometry is covered against a real browser layout engine by
// e2e/geometry.spec.ts ("computeHandleRect() reports the selected block's real on-screen
// geometry"), which asserts non-zero dimensions matching the element's own bounding box.
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
