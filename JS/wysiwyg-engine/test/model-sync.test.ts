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
