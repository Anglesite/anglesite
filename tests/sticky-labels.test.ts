import { describe, it, expect } from "vitest";
import { badgeAriaLabel, badgeLabelText } from "../template/src/toolbar/sticky-labels.js";

describe("badgeAriaLabel", () => {
  it("returns annotation preview for a single note", () => {
    const annotations = [{ text: "Make this bolder" }];
    expect(badgeAriaLabel(1, annotations)).toBe("Annotation: Make this bolder");
  });

  it("truncates long annotation text to 60 characters", () => {
    const longText = "A".repeat(80);
    const annotations = [{ text: longText }];
    const label = badgeAriaLabel(1, annotations);
    expect(label).toBe(`Annotation: ${"A".repeat(60)}`);
    expect(label.length).toBe(72); // "Annotation: " (12) + 60
  });

  it("returns count message for multiple annotations", () => {
    const annotations = [{ text: "Note 1" }, { text: "Note 2" }];
    expect(badgeAriaLabel(2, annotations)).toBe("2 annotations on this element");
  });

  it("returns count message for three annotations", () => {
    const annotations = [{ text: "A" }, { text: "B" }, { text: "C" }];
    expect(badgeAriaLabel(3, annotations)).toBe("3 annotations on this element");
  });

  it("uses first annotation text for single-count label", () => {
    const annotations = [{ text: "First note" }, { text: "Second note" }];
    // count=1 but array has multiple — uses first annotation's text
    expect(badgeAriaLabel(1, annotations)).toBe("Annotation: First note");
  });
});

describe("badgeLabelText", () => {
  it("returns '1' for a single annotation", () => {
    expect(badgeLabelText(1)).toBe("1");
  });

  it("returns count as string for multiple annotations", () => {
    expect(badgeLabelText(2)).toBe("2");
    expect(badgeLabelText(5)).toBe("5");
    expect(badgeLabelText(99)).toBe("99");
  });
});
