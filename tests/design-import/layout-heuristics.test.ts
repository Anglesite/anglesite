import { describe, it, expect } from "vitest";
import { classifySection, classifyAllSections } from "../../scripts/design-import/layout-heuristics.mjs";

// Helper builders
function makeSection(overrides: Record<string, unknown> = {}) {
  return {
    index: 1,
    bounds: { x: 0, y: 0, width: 1200, height: 600 },
    elements: [],
    ...overrides,
  };
}

function textEl(content: string, fontSize: number, x = 0, y = 0) {
  return {
    type: "text" as const,
    content,
    style: { fontSize },
    bounds: { x, y, width: 200, height: 40 },
  };
}

function imageEl(x = 0, y = 0) {
  return {
    type: "image" as const,
    content: "",
    style: {},
    bounds: { x, y, width: 200, height: 200 },
  };
}

function buttonEl(content = "Click me", x = 0, y = 0) {
  return {
    type: "button" as const,
    content,
    style: {},
    bounds: { x, y, width: 150, height: 50 },
  };
}

describe("classifySection", () => {
  describe("gallery", () => {
    it("classifies section with 3+ images as gallery", () => {
      const section = makeSection({
        elements: [imageEl(0), imageEl(200), imageEl(400)],
      });
      expect(classifySection(section)).toBe("gallery");
    });

    it("classifies section with 4 images as gallery", () => {
      const section = makeSection({
        elements: [imageEl(0), imageEl(200), imageEl(400), imageEl(600)],
      });
      expect(classifySection(section)).toBe("gallery");
    });

    it("does not classify 2 images as gallery", () => {
      const section = makeSection({
        elements: [imageEl(0), imageEl(200)],
      });
      expect(classifySection(section)).not.toBe("gallery");
    });
  });

  describe("hero", () => {
    it("classifies first section with large text as hero", () => {
      const section = makeSection({
        index: 0,
        elements: [textEl("Welcome to our site", 48)],
      });
      expect(classifySection(section)).toBe("hero");
    });

    it("classifies first section with large text and image as hero", () => {
      const section = makeSection({
        index: 0,
        elements: [textEl("Big Headline", 36), imageEl(600)],
      });
      expect(classifySection(section)).toBe("hero");
    });

    it("requires index 0 for hero classification", () => {
      const section = makeSection({
        index: 1,
        elements: [textEl("Big Headline", 48)],
      });
      expect(classifySection(section)).not.toBe("hero");
    });

    it("requires fontSize >= 32 for hero", () => {
      const section = makeSection({
        index: 0,
        elements: [textEl("Small text", 24)],
      });
      expect(classifySection(section)).not.toBe("hero");
    });

    it("classifies first section with exactly 32px text as hero", () => {
      const section = makeSection({
        index: 0,
        elements: [textEl("Heading", 32)],
      });
      expect(classifySection(section)).toBe("hero");
    });
  });

  describe("footer", () => {
    it("classifies section with small text and 'rights reserved' as footer", () => {
      const section = makeSection({
        elements: [
          textEl("© 2024 Acme Inc. All rights reserved.", 12),
          textEl("Privacy Policy", 12),
        ],
      });
      expect(classifySection(section)).toBe("footer");
    });

    it("classifies section with small text and 'privacy' as footer", () => {
      const section = makeSection({
        elements: [textEl("Privacy Policy | Terms of Service", 12)],
      });
      expect(classifySection(section)).toBe("footer");
    });

    it("classifies section with small text and 'terms' as footer", () => {
      const section = makeSection({
        elements: [textEl("Terms of Service", 11)],
      });
      expect(classifySection(section)).toBe("footer");
    });

    it("classifies section with small text and 'copyright' as footer", () => {
      const section = makeSection({
        elements: [textEl("Copyright 2024", 10)],
      });
      expect(classifySection(section)).toBe("footer");
    });

    it("classifies section with small text and copyright symbol as footer", () => {
      const section = makeSection({
        elements: [textEl("© 2024 Acme Inc.", 12)],
      });
      expect(classifySection(section)).toBe("footer");
    });

    it("does not classify footer if any text is large", () => {
      const section = makeSection({
        elements: [
          textEl("All rights reserved", 12),
          textEl("Big Header", 20),
        ],
      });
      expect(classifySection(section)).not.toBe("footer");
    });

    it("does not classify footer without footer keywords", () => {
      const section = makeSection({
        elements: [textEl("Some small text here", 12)],
      });
      expect(classifySection(section)).not.toBe("footer");
    });

    it("classifies with 'Privacy' capitalized as footer", () => {
      const section = makeSection({
        elements: [textEl("Privacy | Terms", 13)],
      });
      expect(classifySection(section)).toBe("footer");
    });
  });

  describe("testimonial", () => {
    it("classifies section with quoted text and dash attribution as testimonial", () => {
      const section = makeSection({
        elements: [
          textEl('"This product changed my life!"', 16),
          textEl("- Jane Doe", 14),
        ],
      });
      expect(classifySection(section)).toBe("testimonial");
    });

    it("classifies with curly open quote as testimonial", () => {
      const section = makeSection({
        elements: [
          textEl("\u201cAmazing service\u201d", 16),
          textEl("- John Smith", 14),
        ],
      });
      expect(classifySection(section)).toBe("testimonial");
    });

    it("classifies with em-dash attribution as testimonial", () => {
      const section = makeSection({
        elements: [
          textEl('"Great experience"', 16),
          textEl("\u2014 Mary Johnson", 14),
        ],
      });
      expect(classifySection(section)).toBe("testimonial");
    });

    it("classifies with en-dash attribution as testimonial", () => {
      const section = makeSection({
        elements: [
          textEl('"Excellent!"', 16),
          textEl("\u2013 Bob Wilson", 14),
        ],
      });
      expect(classifySection(section)).toBe("testimonial");
    });

    it("does not classify without dash attribution as testimonial", () => {
      const section = makeSection({
        elements: [
          textEl('"This is great"', 16),
          textEl("Jane Doe", 14),
        ],
      });
      expect(classifySection(section)).not.toBe("testimonial");
    });

    it("does not classify without quote marks as testimonial", () => {
      const section = makeSection({
        elements: [
          textEl("This is great", 16),
          textEl("- Jane Doe", 14),
        ],
      });
      expect(classifySection(section)).not.toBe("testimonial");
    });
  });

  describe("feature-grid", () => {
    it("classifies section with 4+ texts in evenly-spaced x clusters as feature-grid", () => {
      // 6 elements in 3 clusters: x≈50, x≈460, x≈870 (gap ~410, within 20% of average)
      const section = makeSection({
        elements: [
          textEl("Feature 1 title", 18, 50),
          textEl("Feature 1 desc", 14, 60),
          textEl("Feature 2 title", 18, 460),
          textEl("Feature 2 desc", 14, 455),
          textEl("Feature 3 title", 18, 870),
          textEl("Feature 3 desc", 14, 865),
        ],
      });
      expect(classifySection(section)).toBe("feature-grid");
    });

    it("classifies section with 4 texts in 2 evenly-spaced clusters as feature-grid", () => {
      const section = makeSection({
        elements: [
          textEl("Left title", 18, 50),
          textEl("Left desc", 14, 55),
          textEl("Right title", 18, 650),
          textEl("Right desc", 14, 645),
        ],
      });
      expect(classifySection(section)).toBe("feature-grid");
    });

    it("does not classify fewer than 4 text elements as feature-grid", () => {
      const section = makeSection({
        elements: [
          textEl("Title", 18, 50),
          textEl("Title", 18, 460),
          textEl("Title", 18, 870),
        ],
      });
      expect(classifySection(section)).not.toBe("feature-grid");
    });
  });

  describe("cta", () => {
    it("classifies section with button and <= 3 text elements as cta", () => {
      const section = makeSection({
        elements: [
          textEl("Ready to get started?", 24),
          textEl("Join thousands of happy customers.", 16),
          buttonEl("Sign Up Now"),
        ],
      });
      expect(classifySection(section)).toBe("cta");
    });

    it("classifies section with button and 0 text elements as cta", () => {
      const section = makeSection({
        elements: [buttonEl("Buy Now")],
      });
      expect(classifySection(section)).toBe("cta");
    });

    it("classifies section with button and exactly 3 text elements as cta", () => {
      const section = makeSection({
        elements: [
          textEl("Headline", 24),
          textEl("Subheadline", 18),
          textEl("Supporting copy", 14),
          buttonEl("Get Started"),
        ],
      });
      expect(classifySection(section)).toBe("cta");
    });

    it("does not classify button with 4+ text elements as cta", () => {
      const section = makeSection({
        elements: [
          textEl("Text 1", 16),
          textEl("Text 2", 16),
          textEl("Text 3", 16),
          textEl("Text 4", 16),
          buttonEl("Click"),
        ],
      });
      expect(classifySection(section)).not.toBe("cta");
    });

    it("does not classify section without button as cta", () => {
      const section = makeSection({
        elements: [textEl("No button here", 16)],
      });
      expect(classifySection(section)).not.toBe("cta");
    });
  });

  describe("content", () => {
    it("classifies section with exactly 1 small text element with long content as content", () => {
      const section = makeSection({
        elements: [
          textEl(
            "This is a long paragraph of text that has more than one hundred characters in it to trigger the content classification rule correctly.",
            16
          ),
        ],
      });
      expect(classifySection(section)).toBe("content");
    });

    it("does not classify content if fontSize > 18", () => {
      const section = makeSection({
        elements: [
          textEl(
            "This is a long paragraph of text that has more than one hundred characters in it to trigger the content classification rule correctly.",
            20
          ),
        ],
      });
      expect(classifySection(section)).not.toBe("content");
    });

    it("does not classify content if text length <= 100", () => {
      const section = makeSection({
        elements: [textEl("Short text", 16)],
      });
      expect(classifySection(section)).not.toBe("content");
    });

    it("does not classify content if more than 1 text element", () => {
      const longText =
        "This is a long paragraph of text that has more than one hundred characters in it to trigger it.";
      const section = makeSection({
        elements: [textEl(longText, 16), textEl("Another text", 14)],
      });
      expect(classifySection(section)).not.toBe("content");
    });
  });

  describe("generic", () => {
    it("classifies unrecognized pattern as generic", () => {
      const section = makeSection({
        elements: [],
      });
      expect(classifySection(section)).toBe("generic");
    });

    it("classifies section with a single image as generic", () => {
      const section = makeSection({
        elements: [imageEl()],
      });
      expect(classifySection(section)).toBe("generic");
    });
  });
});

describe("classifyAllSections", () => {
  it("returns array of { type, section } pairs", () => {
    const sections = [
      makeSection({ index: 0, elements: [textEl("Hero Heading", 48)] }),
      makeSection({ index: 1, elements: [imageEl(0), imageEl(200), imageEl(400)] }),
      makeSection({ index: 2, elements: [] }),
    ];
    const result = classifyAllSections(sections);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "hero", section: sections[0] });
    expect(result[1]).toEqual({ type: "gallery", section: sections[1] });
    expect(result[2]).toEqual({ type: "generic", section: sections[2] });
  });

  it("handles empty array", () => {
    expect(classifyAllSections([])).toEqual([]);
  });

  it("preserves the original section object in the result", () => {
    const section = makeSection({
      index: 0,
      elements: [textEl("Hello", 40)],
    });
    const result = classifyAllSections([section]);
    expect(result[0].section).toBe(section);
  });
});
