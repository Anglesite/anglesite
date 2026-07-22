import { describe, it, expect } from "vitest";
import { z } from "zod";
import { editOps, componentEditSchema, applyEditInputShape, COMPONENT_STYLE_OPS } from "../server/apply-edit-schema.mjs";

describe("component-style op schema", () => {
  it("registers the four new op names", () => {
    for (const op of ["set-style-property", "remove-style-property", "add-style-rule", "set-rule-selector"]) {
      expect(editOps).toContain(op);
      expect(COMPONENT_STYLE_OPS.has(op)).toBe(true);
    }
  });

  it("accepts a set-style-property component payload", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "src/components/Card.astro",
      op: "set-style-property",
      component: { path: "src/components/Card.astro", baseVersion: "sha256:abc123456789", ruleSpan: [10, 40], property: "color", value: "red" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a component payload missing baseVersion", () => {
    const result = componentEditSchema.safeParse({ path: "src/components/Card.astro", property: "color", value: "red" });
    expect(result.success).toBe(false);
  });

  it("still accepts a legacy replace-attr edit with selector and no component", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "/about/",
      op: "replace-attr",
      selector: { tag: "h1", classes: [], nthChild: 1 },
      value: { name: "class", value: "big" },
    });
    expect(result.success).toBe(true);
  });
});
