import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  editOps,
  componentEditSchema,
  applyEditInputShape,
  COMPONENT_EXTRACT_OPS,
  COMPONENT_OPS,
  createEditAppliedContent,
} from "../server/apply-edit-schema.mjs";

describe("extract-component op schema", () => {
  it("registers the op name in editOps, COMPONENT_EXTRACT_OPS, and the COMPONENT_OPS union", () => {
    expect(editOps).toContain("extract-component");
    expect(COMPONENT_EXTRACT_OPS.has("extract-component")).toBe(true);
    expect(COMPONENT_OPS.has("extract-component")).toBe(true);
    // Sibling component-op families are still in the union too.
    expect(COMPONENT_OPS.has("insert-node")).toBe(true);
    expect(COMPONENT_OPS.has("set-style-property")).toBe(true);
    expect(COMPONENT_OPS.has("set-props-interface")).toBe(true);
  });

  it("accepts an extract-component payload (nodeId + newName)", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "src/components/Hero.astro",
      op: "extract-component",
      component: {
        path: "src/components/Hero.astro",
        baseVersion: "sha256:abc123456789",
        nodeId: "n2",
        newName: "CardTitle",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a component payload missing baseVersion, same as every other component op", () => {
    const result = componentEditSchema.safeParse({ path: "src/components/Hero.astro", nodeId: "n2", newName: "CardTitle" });
    expect(result.success).toBe(false);
  });

  it("still parses without newName (the field is optional at the schema layer; the resolver enforces it's required for this op)", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Hero.astro",
      baseVersion: "sha256:abc123456789",
      nodeId: "n2",
    });
    expect(result.success).toBe(true);
  });
});

describe("createEditAppliedContent — additive newFile field", () => {
  it("omits newFile when not passed (every existing single-file op's reply shape is unchanged)", () => {
    const content = createEditAppliedContent("1", "src/pages/index.astro", { start: 0, end: 5 }, "deadbeef");
    const body = JSON.parse(content.text);
    expect(body).not.toHaveProperty("newFile");
    expect(body.file).toBe("src/pages/index.astro");
  });

  it("includes newFile when passed (extract-component's reply)", () => {
    const content = createEditAppliedContent(
      "1",
      "src/components/Hero.astro",
      { start: 0, end: 40 },
      "deadbeef",
      undefined,
      undefined,
      "src/components/CardTitle.astro",
    );
    const body = JSON.parse(content.text);
    expect(body.newFile).toBe("src/components/CardTitle.astro");
    expect(body.file).toBe("src/components/Hero.astro");
  });
});
