import { describe, it, expect } from "vitest";
import { z } from "zod";
import { editOps, componentEditSchema, applyEditInputShape, COMPONENT_STRUCTURE_OPS, COMPONENT_OPS } from "../server/apply-edit-schema.mjs";

describe("component-structure op schema", () => {
  it("registers the four new op names in both sets", () => {
    for (const op of ["insert-node", "move-node", "remove-node", "set-attr"]) {
      expect(editOps).toContain(op);
      expect(COMPONENT_STRUCTURE_OPS.has(op)).toBe(true);
      expect(COMPONENT_OPS.has(op)).toBe(true);
    }
    // style ops still in the union too
    expect(COMPONENT_OPS.has("set-style-property")).toBe(true);
  });

  it("accepts a set-attr payload with a null value (removal)", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "src/components/Card.astro",
      op: "set-attr",
      component: { path: "src/components/Card.astro", baseVersion: "sha256:abc123456789", nodeId: "n1", name: "class", value: null },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an insert-node payload with a component node spec", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Card.astro",
      baseVersion: "sha256:abc123456789",
      parentId: "n0",
      index: 0,
      node: { kind: "component", tag: "Badge", componentPath: "src/components/Badge.astro" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a move-node payload", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Card.astro",
      baseVersion: "sha256:abc123456789",
      nodeId: "n2",
      newParentId: "n0",
      newIndex: 1,
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a legacy set-style-property payload (value stays a plain string there)", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Card.astro",
      baseVersion: "sha256:abc123456789",
      ruleSpan: [1, 2],
      property: "color",
      value: "red",
    });
    expect(result.success).toBe(true);
  });
});
