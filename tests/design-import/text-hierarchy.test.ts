import { describe, it, expect } from "vitest";
import { assignHeadingLevels, detectButtons } from "../../scripts/design-import/text-hierarchy.mjs";

// Helper builders
function textEl(content: string, fontSize: number) {
  return { content, style: { fontSize } };
}

function buttonCandidate(
  content: string,
  width: number,
  height: number,
  type = "text"
) {
  return { type, content, bounds: { width, height } };
}

describe("assignHeadingLevels", () => {
  it("returns empty array for empty input", () => {
    expect(assignHeadingLevels([])).toEqual([]);
  });

  it("maps largest size to h1, second to h2, body text to p", () => {
    const elements = [
      textEl("Big Headline", 48),
      textEl("Subheading", 24),
      textEl("Body copy", 16),
    ];
    const result = assignHeadingLevels(elements);
    expect(result).toEqual([
      { content: "Big Headline", tag: "h1" },
      { content: "Subheading", tag: "h2" },
      { content: "Body copy", tag: "p" },
    ]);
  });

  it("maps largest to h2 when h1Used is true", () => {
    const elements = [
      textEl("Section Title", 48),
      textEl("Subheading", 24),
    ];
    const result = assignHeadingLevels(elements, { h1Used: true });
    expect(result[0]).toEqual({ content: "Section Title", tag: "h2" });
    expect(result[1]).toEqual({ content: "Subheading", tag: "h2" });
  });

  it("maps small text (10px) to small tag", () => {
    const elements = [textEl("Fine print", 10)];
    const result = assignHeadingLevels(elements);
    expect(result).toEqual([{ content: "Fine print", tag: "small" }]);
  });

  it("maps fontSize <= 12 to small", () => {
    const elements = [textEl("Tiny text", 12)];
    expect(assignHeadingLevels(elements)).toEqual([
      { content: "Tiny text", tag: "small" },
    ]);
  });

  it("maps fontSize <= 20 (but > 12) to p", () => {
    const elements = [textEl("Paragraph text", 16)];
    expect(assignHeadingLevels(elements)).toEqual([
      { content: "Paragraph text", tag: "p" },
    ]);
  });

  it("maps fontSize exactly 20 to p", () => {
    const elements = [textEl("Medium text", 20)];
    expect(assignHeadingLevels(elements)).toEqual([
      { content: "Medium text", tag: "p" },
    ]);
  });

  it("maps third-largest heading size to h3", () => {
    const elements = [
      textEl("Level 1", 48),
      textEl("Level 2", 32),
      textEl("Level 3", 24),
      textEl("Body", 16),
    ];
    const result = assignHeadingLevels(elements);
    expect(result[0]).toEqual({ content: "Level 1", tag: "h1" });
    expect(result[1]).toEqual({ content: "Level 2", tag: "h2" });
    expect(result[2]).toEqual({ content: "Level 3", tag: "h3" });
    expect(result[3]).toEqual({ content: "Body", tag: "p" });
  });

  it("uses default fontSize of 16 when fontSize is undefined", () => {
    const elements = [{ content: "No size", style: {} }];
    const result = assignHeadingLevels(elements);
    expect(result).toEqual([{ content: "No size", tag: "p" }]);
  });

  it("all elements at same large size get h1 (only one unique heading size)", () => {
    const elements = [
      textEl("Title A", 36),
      textEl("Title B", 36),
    ];
    const result = assignHeadingLevels(elements);
    expect(result[0]).toEqual({ content: "Title A", tag: "h1" });
    expect(result[1]).toEqual({ content: "Title B", tag: "h1" });
  });

  it("two heading sizes: largest is h1, second is h2", () => {
    const elements = [
      textEl("Big", 40),
      textEl("Medium", 28),
    ];
    const result = assignHeadingLevels(elements);
    expect(result[0]).toEqual({ content: "Big", tag: "h1" });
    expect(result[1]).toEqual({ content: "Medium", tag: "h2" });
  });
});

describe("detectButtons", () => {
  it("returns empty array for empty input", () => {
    expect(detectButtons([])).toEqual([]);
  });

  it("detects short text with compact bounds as button", () => {
    const elements = [
      buttonCandidate("Get Started", 150, 50),
    ];
    expect(detectButtons(elements)).toEqual([0]);
  });

  it("does not detect long text as button", () => {
    const elements = [
      buttonCandidate("This is a very long piece of text that exceeds thirty characters", 200, 50),
    ];
    expect(detectButtons(elements)).toEqual([]);
  });

  it("does not detect element with large height as button", () => {
    const elements = [
      buttonCandidate("Click me", 200, 61),
    ];
    expect(detectButtons(elements)).toEqual([]);
  });

  it("does not detect element with large width as button", () => {
    const elements = [
      buttonCandidate("Click me", 251, 50),
    ];
    expect(detectButtons(elements)).toEqual([]);
  });

  it("does not detect non-text type as button", () => {
    const elements = [
      buttonCandidate("Click me", 150, 50, "image"),
    ];
    expect(detectButtons(elements)).toEqual([]);
  });

  it("returns correct indices when mixed elements present", () => {
    const elements = [
      buttonCandidate("Not a button at all since it has too much text here for a button", 300, 70, "text"),
      buttonCandidate("Buy Now", 120, 45, "text"),
      buttonCandidate("Learn More", 140, 50, "text"),
    ];
    expect(detectButtons(elements)).toEqual([1, 2]);
  });

  it("detects button with content.length exactly 30", () => {
    // Exactly 30 chars
    const content = "a".repeat(30);
    const elements = [buttonCandidate(content, 200, 50)];
    expect(detectButtons(elements)).toEqual([0]);
  });

  it("does not detect button with content.length 31", () => {
    const content = "a".repeat(31);
    const elements = [buttonCandidate(content, 200, 50)];
    expect(detectButtons(elements)).toEqual([]);
  });

  it("detects button with bounds exactly at limits (height 60, width 250)", () => {
    const elements = [buttonCandidate("Submit", 250, 60)];
    expect(detectButtons(elements)).toEqual([0]);
  });
});
