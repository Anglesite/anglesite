import { describe, it, expect } from "vitest";
import { isSimpleSelector, selectorMatchesNode } from "../server/style-selector-match.mjs";

describe("isSimpleSelector", () => {
  it("accepts a bare tag, a bare class, a compound tag.class, an id, and multiple classes", () => {
    expect(isSimpleSelector("div")).toBe(true);
    expect(isSimpleSelector(".card")).toBe(true);
    expect(isSimpleSelector("div.card")).toBe(true);
    expect(isSimpleSelector("#hero")).toBe(true);
    expect(isSimpleSelector("div.card.featured")).toBe(true);
  });

  it("rejects combinators, pseudo-classes, :global(), and attribute selectors", () => {
    expect(isSimpleSelector(".card > h2")).toBe(false);
    expect(isSimpleSelector(".card:hover")).toBe(false);
    expect(isSimpleSelector(".parent .child")).toBe(false);
    expect(isSimpleSelector(":global(.card)")).toBe(false);
    expect(isSimpleSelector('[data-foo="bar"]')).toBe(false);
    expect(isSimpleSelector("")).toBe(false);
  });
});

describe("selectorMatchesNode", () => {
  const div = { tag: "div", attrs: [{ name: "class", value: "card featured" }] };
  const bareDiv = { tag: "div", attrs: [] };
  const withId = { tag: "section", attrs: [{ name: "id", value: "hero" }] };

  it("matches a bare tag selector against the node's own tag", () => {
    expect(selectorMatchesNode("div", div)).toBe(true);
    expect(selectorMatchesNode("section", div)).toBe(false);
  });

  it("matches a class selector when the node carries that class", () => {
    expect(selectorMatchesNode(".card", div)).toBe(true);
    expect(selectorMatchesNode(".missing", div)).toBe(false);
    expect(selectorMatchesNode(".card", bareDiv)).toBe(false);
  });

  it("requires every class in a compound selector to be present", () => {
    expect(selectorMatchesNode("div.card.featured", div)).toBe(true);
    expect(selectorMatchesNode("div.card.other", div)).toBe(false);
  });

  it("matches an id selector against the node's id attribute", () => {
    expect(selectorMatchesNode("#hero", withId)).toBe(true);
    expect(selectorMatchesNode("#other", withId)).toBe(false);
    expect(selectorMatchesNode("#hero", div)).toBe(false);
  });
});
