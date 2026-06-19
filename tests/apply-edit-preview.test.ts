import { describe, it, expect } from "vitest";
import { createEditPreviewContent } from "../server/apply-edit-schema.mjs";

describe("createEditPreviewContent", () => {
  it("builds an edit-preview body with before/after", () => {
    const entry = createEditPreviewContent(
      "abc", "src/pages/about.astro", { start: 10, end: 17 },
      "replace-text", "Welcome", "Hello",
    );
    expect(entry.type).toBe("text");
    const body = JSON.parse(entry.text);
    expect(body).toEqual({
      type: "anglesite:edit-preview",
      id: "abc",
      file: "src/pages/about.astro",
      range: { start: 10, end: 17 },
      op: "replace-text",
      before: "Welcome",
      after: "Hello",
    });
  });
});
