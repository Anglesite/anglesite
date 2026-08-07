import { WysiwygEngine } from "../src/engine.js";
import { FixtureHost } from "../src/testing/fixture-host.js";
import { computeHandleRect } from "../src/selection.js";
import { ROOT_PARENT_ID } from "../src/types.js";
import type { HandleRect } from "../src/selection.js";
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
  // A rejection carrying a model adopted the host's fresh one — that is a model swap the canvas
  // must follow, exactly like "applied"/"model-updated", or the DOM silently drifts from the host.
  if (event.type === "model-updated" || event.type === "applied" || (event.type === "rejected" && event.model)) {
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
    __computeHandleRect: (blockId: string) => HandleRect | null;
  }
}

window.__engine = engine;
window.__host = host;
// Bridged onto `window` (unlike `hitTest`, which the engine already exposes as a method) so
// e2e/geometry.spec.ts can exercise it against a real layout engine — jsdom's
// getBoundingClientRect is all zeros, so unit tests can only prove the wiring.
window.__computeHandleRect = (blockId) => computeHandleRect(blockId);
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
