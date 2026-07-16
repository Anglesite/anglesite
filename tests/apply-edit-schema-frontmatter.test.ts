import { describe, it, expect } from "vitest";
import { z } from "zod";
import { editOps, componentEditSchema, applyEditInputShape, COMPONENT_FRONTMATTER_OPS, COMPONENT_OPS } from "../server/apply-edit-schema.mjs";

describe("component-frontmatter op schema", () => {
  it("registers the two new op names", () => {
    for (const op of ["set-props-interface", "set-script-zone"]) {
      expect(editOps).toContain(op);
      expect(COMPONENT_FRONTMATTER_OPS.has(op)).toBe(true);
      expect(COMPONENT_OPS.has(op)).toBe(true);
    }
  });

  it("accepts a set-props-interface component payload", () => {
    const schema = z.object(applyEditInputShape);
    const result = schema.safeParse({
      id: "1",
      path: "src/components/Card.astro",
      op: "set-props-interface",
      component: {
        path: "src/components/Card.astro",
        baseVersion: "sha256:abc123456789",
        props: [{ name: "title", type: "string", optional: false, default: null }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty props array (removal)", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Card.astro",
      baseVersion: "sha256:abc123456789",
      props: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a prop entry missing required fields", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Card.astro",
      baseVersion: "sha256:abc123456789",
      props: [{ name: "title" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a set-script-zone component payload for both zones", () => {
    const schema = z.object(applyEditInputShape);
    for (const zone of ["frontmatter", "client"]) {
      const result = schema.safeParse({
        id: "1",
        path: "src/components/Card.astro",
        op: "set-script-zone",
        component: { path: "src/components/Card.astro", baseVersion: "sha256:abc123456789", zone, source: "const x = 1;" },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown zone value", () => {
    const result = componentEditSchema.safeParse({
      path: "src/components/Card.astro",
      baseVersion: "sha256:abc123456789",
      zone: "bogus",
      source: "x",
    });
    expect(result.success).toBe(false);
  });
});
