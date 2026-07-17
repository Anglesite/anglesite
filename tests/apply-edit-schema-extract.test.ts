import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  editOps,
  componentEditSchema,
  applyEditInputShape,
  COMPONENT_EXTRACT_OPS,
  COMPONENT_OPS,
  createEditPreviewContent,
} from "../server/apply-edit-schema.mjs";

describe("extract-component schema", () => {
  it("registers extract-component in editOps, COMPONENT_EXTRACT_OPS, and COMPONENT_OPS", () => {
    expect(editOps).toContain("extract-component");
    expect(COMPONENT_EXTRACT_OPS.has("extract-component")).toBe(true);
    expect(COMPONENT_OPS.has("extract-component")).toBe(true);
  });

  it("accepts an extract-component payload with nodeId and newComponentPath", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Page.astro",
      baseVersion: "sha256:abc123456789",
      nodeId: "n3",
      newComponentPath: "src/components/Hero.astro",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full apply_edit input for extract-component", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "src/components/Page.astro",
      op: "extract-component",
      component: { path: "src/components/Page.astro", baseVersion: "sha256:abc123456789", nodeId: "n3", newComponentPath: "src/components/Hero.astro" },
    });
    expect(result.success).toBe(true);
  });

  it("createEditPreviewContent includes newFile when provided, omits it otherwise", () => {
    const withNewFile = JSON.parse(createEditPreviewContent("1", "a.astro", { start: 0, end: 1 }, "extract-component", "before", "after", { path: "b.astro", after: "content" }).text);
    expect(withNewFile.newFile).toEqual({ path: "b.astro", after: "content" });

    const without = JSON.parse(createEditPreviewContent("1", "a.astro", { start: 0, end: 1 }, "set-attr", "before", "after").text);
    expect(without.newFile).toBeUndefined();
  });
});
