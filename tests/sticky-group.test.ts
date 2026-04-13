import { describe, it, expect } from "vitest";
import { groupAnnotationsBySelector } from "../template/src/toolbar/sticky-group.js";

interface Annotation {
  id: string;
  path: string;
  selector: string;
  text: string;
  resolved: boolean;
  createdAt: string;
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    path: "/",
    selector: "#hero h1",
    text: "Make this bolder",
    resolved: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupAnnotationsBySelector", () => {
  it("returns empty array for empty input", () => {
    expect(groupAnnotationsBySelector([])).toEqual([]);
  });

  it("groups a single annotation into a group of one", () => {
    const groups = groupAnnotationsBySelector([makeAnnotation()]);
    expect(groups).toHaveLength(1);
    expect(groups[0].selector).toBe("#hero h1");
    expect(groups[0].annotations).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });

  it("groups multiple annotations with the same selector", () => {
    const annotations = [
      makeAnnotation({ id: "a1", text: "Make bolder" }),
      makeAnnotation({ id: "a2", text: "Change color" }),
      makeAnnotation({ id: "a3", text: "Add underline" }),
    ];
    const groups = groupAnnotationsBySelector(annotations);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].annotations.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("creates separate groups for different selectors", () => {
    const annotations = [
      makeAnnotation({ id: "a1", selector: "#hero h1" }),
      makeAnnotation({ id: "a2", selector: ".nav-link" }),
      makeAnnotation({ id: "a3", selector: "#hero h1" }),
    ];
    const groups = groupAnnotationsBySelector(annotations);
    expect(groups).toHaveLength(2);

    const heroGroup = groups.find((g) => g.selector === "#hero h1");
    const navGroup = groups.find((g) => g.selector === ".nav-link");
    expect(heroGroup!.count).toBe(2);
    expect(navGroup!.count).toBe(1);
  });

  it("preserves insertion order of first occurrence", () => {
    const annotations = [
      makeAnnotation({ id: "a1", selector: ".footer" }),
      makeAnnotation({ id: "a2", selector: "#hero" }),
      makeAnnotation({ id: "a3", selector: ".footer" }),
    ];
    const groups = groupAnnotationsBySelector(annotations);
    expect(groups[0].selector).toBe(".footer");
    expect(groups[1].selector).toBe("#hero");
  });

  it("uses the selector as the group key", () => {
    const annotations = [makeAnnotation({ selector: '[data-anglesite-id="home:cta"]' })];
    const groups = groupAnnotationsBySelector(annotations);
    expect(groups[0].selector).toBe('[data-anglesite-id="home:cta"]');
  });
});
