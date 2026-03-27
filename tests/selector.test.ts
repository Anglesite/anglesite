import { describe, it, expect } from "vitest";
import { buildSelector } from "../server/selector.mjs";

// ---------------------------------------------------------------------------
// buildSelector — generate a unique CSS selector from element metadata
// ---------------------------------------------------------------------------

describe("buildSelector", () => {
  it("returns id selector when element has an id", () => {
    expect(buildSelector({ id: "hero", tag: "h1", classes: [], nthChild: 1 })).toBe(
      "#hero",
    );
  });

  it("returns tag + class selector when classes are present", () => {
    expect(
      buildSelector({ tag: "h1", classes: ["hero", "large"], nthChild: 1 }),
    ).toBe("h1.hero.large");
  });

  it("returns tag + nth-child when no id or classes", () => {
    expect(buildSelector({ tag: "div", classes: [], nthChild: 3 })).toBe(
      "div:nth-child(3)",
    );
  });

  it("builds a path from ancestors", () => {
    expect(
      buildSelector({
        tag: "p",
        classes: ["intro"],
        nthChild: 1,
        ancestors: [
          { tag: "main", id: "content" },
          { tag: "section", classes: ["about"] },
        ],
      }),
    ).toBe("#content > section.about > p.intro");
  });

  it("stops ancestor chain at an id", () => {
    expect(
      buildSelector({
        tag: "span",
        classes: [],
        nthChild: 2,
        ancestors: [
          { tag: "body" },
          { tag: "div", id: "app" },
          { tag: "p", classes: ["text"] },
        ],
      }),
    ).toBe("#app > p.text > span:nth-child(2)");
  });

  it("uses data-anglesite-id when present", () => {
    expect(
      buildSelector({
        tag: "div",
        classes: [],
        nthChild: 1,
        dataAnglesiteId: "cta-banner",
      }),
    ).toBe('[data-anglesite-id="cta-banner"]');
  });

  it("prefers data-anglesite-id over id", () => {
    expect(
      buildSelector({
        tag: "div",
        id: "banner",
        classes: [],
        nthChild: 1,
        dataAnglesiteId: "cta-banner",
      }),
    ).toBe('[data-anglesite-id="cta-banner"]');
  });

  it("handles tag-only elements with nth-child 1", () => {
    expect(buildSelector({ tag: "header", classes: [], nthChild: 1 })).toBe(
      "header:nth-child(1)",
    );
  });

  it("lowercases tag names", () => {
    expect(buildSelector({ tag: "DIV", classes: ["Foo"], nthChild: 1 })).toBe(
      "div.Foo",
    );
  });
});
