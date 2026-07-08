import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  applyEditInputShape,
  elementInfoSchema,
  editOps,
  createEditFailedContent,
  createEditAppliedContent,
} from "../server/apply-edit-schema.mjs";

// `server.tool(name, description, shape, handler)` validates against `z.object(shape)` internally;
// reconstruct the same composition here so we can drive the validator directly.
const applyEditSchema = z.object(applyEditInputShape);

const validSelector = {
  tag: "P",
  classes: [],
  nthChild: 2,
  ancestors: [
    { tag: "BODY", nthChild: 2 },
    { tag: "MAIN", nthChild: 1 },
  ],
};

const validPayload = {
  id: "e-1",
  type: "anglesite:apply-edit",
  path: "/about/",
  selector: validSelector,
  op: "replace-text",
  value: "Hello, world.",
};

describe("applyEditInputShape", () => {
  it("accepts the agreed-upon wire format", () => {
    const result = applyEditSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("treats `type` as optional and accepts the namespaced WKWebView tag", () => {
    const { type: _t, ...sansType } = validPayload;
    expect(applyEditSchema.safeParse(sansType).success).toBe(true);
    expect(
      applyEditSchema.safeParse({ ...validPayload, type: "anything-the-app-sends" }).success,
    ).toBe(true);
  });

  it("requires id, path, and op", () => {
    // `selector` is optional as of the Component Editor's style ops (#496): those ops carry
    // their payload in `component` instead — see apply-edit-schema-component.test.ts.
    for (const field of ["id", "path", "op"]) {
      const { [field]: _omitted, ...rest } = validPayload;
      expect(
        applyEditSchema.safeParse(rest).success,
        `${field} should be required`,
      ).toBe(false);
    }
  });

  it("accepts op=apply-instruction (Foundation Models chat forward)", () => {
    expect(
      applyEditSchema.safeParse({ ...validPayload, op: "apply-instruction" }).success,
    ).toBe(true);
  });

  it("rejects op values outside the enum", () => {
    expect(applyEditSchema.safeParse({ ...validPayload, op: "set-text" }).success).toBe(false);
    expect(applyEditSchema.safeParse({ ...validPayload, op: "delete" }).success).toBe(false);
  });

  it("accepts every enum op", () => {
    for (const op of editOps) {
      expect(applyEditSchema.safeParse({ ...validPayload, op }).success).toBe(true);
    }
  });
});

describe("elementInfoSchema", () => {
  it("requires tag, classes, and nthChild", () => {
    expect(elementInfoSchema.safeParse(validSelector).success).toBe(true);
    expect(elementInfoSchema.safeParse({ classes: [], nthChild: 1 }).success).toBe(false);
    expect(elementInfoSchema.safeParse({ tag: "P", nthChild: 1 }).success).toBe(false);
    expect(elementInfoSchema.safeParse({ tag: "P", classes: [] }).success).toBe(false);
  });

  it("accepts the optional id / data-* / role / aria-label / textContent fields", () => {
    const richer = {
      tag: "DIV",
      id: "hero",
      classes: ["card", "primary", "astro-abc123"],
      nthChild: 1,
      dataAnglesiteId: "home:hero",
      dataTestId: "hero-card",
      role: "region",
      ariaLabel: "Hero section",
      textContent: "Welcome to our shop",
      ancestors: [],
    };
    expect(elementInfoSchema.safeParse(richer).success).toBe(true);
  });

  it("rejects nthChild that isn't an integer", () => {
    expect(elementInfoSchema.safeParse({ ...validSelector, nthChild: 1.5 }).success).toBe(false);
    expect(elementInfoSchema.safeParse({ ...validSelector, nthChild: "2" }).success).toBe(false);
  });

  it("rejects ancestor entries missing the required tag", () => {
    const bad = { ...validSelector, ancestors: [{ nthChild: 1 }] };
    expect(elementInfoSchema.safeParse(bad).success).toBe(false);
  });
});

describe("createEditFailedContent", () => {
  it("produces an MCP text content entry with type/id/reason in the JSON body", () => {
    const content = createEditFailedContent("e-9", "no-match", "selector did not resolve");
    expect(content.type).toBe("text");
    const body = JSON.parse(content.text);
    expect(body).toEqual({
      type: "anglesite:edit-failed",
      id: "e-9",
      reason: "no-match",
      detail: "selector did not resolve",
    });
  });

  it("omits `detail` when not provided", () => {
    const content = createEditFailedContent("e-9", "ambiguous");
    const body = JSON.parse(content.text);
    expect(body.detail).toBeUndefined();
  });
});

describe("createEditAppliedContent", () => {
  it("produces an MCP text content entry with file/range/commit in the JSON body", () => {
    const content = createEditAppliedContent(
      "e-1",
      "src/pages/about.astro",
      { start: 120, end: 145 },
      "abc1234",
    );
    const body = JSON.parse(content.text);
    expect(body).toEqual({
      type: "anglesite:edit-applied",
      id: "e-1",
      file: "src/pages/about.astro",
      range: { start: 120, end: 145 },
      commit: "abc1234",
    });
  });

  it("omits `commit` when not provided (edit-history hasn't landed yet)", () => {
    const content = createEditAppliedContent("e-1", "src/pages/about.astro", { start: 0, end: 1 });
    const body = JSON.parse(content.text);
    expect(body.commit).toBeUndefined();
  });
});
