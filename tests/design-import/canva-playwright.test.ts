import { describe, it, expect } from "vitest";
import { buildSectionData } from "../../scripts/design-import/canva-playwright.mjs";

// ---------------------------------------------------------------------------
// buildSectionData
// ---------------------------------------------------------------------------

describe("buildSectionData", () => {
  it("transforms raw browser data: IMG tag → type image, DIV → type text", () => {
    const raw = [
      {
        id: "section-1",
        bounds: { x: 0, y: 0, width: 1280, height: 600 },
        elements: [
          {
            tagName: "DIV",
            textContent: "Hello World",
            style: {
              fontSize: "48px",
              fontFamily: "Arimo",
              color: "rgb(255, 255, 255)",
            },
            bounds: { x: 100, y: 200, width: 500, height: 60 },
            src: null,
          },
          {
            tagName: "IMG",
            textContent: "",
            style: {},
            bounds: { x: 600, y: 100, width: 580, height: 400 },
            src: "media/abc123.png",
          },
        ],
      },
    ];

    const result = buildSectionData(raw);

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
    expect(result[0].bounds).toEqual({ x: 0, y: 0, width: 1280, height: 600 });
    expect(result[0].elements).toHaveLength(2);

    // text element
    const textEl = result[0].elements[0];
    expect(textEl.type).toBe("text");
    expect(textEl.content).toBe("Hello World");
    expect(textEl.style.fontSize).toBe(48);
    expect(textEl.style.fontFamily).toBe("Arimo");
    expect(textEl.style.color).toBe("rgb(255, 255, 255)");
    expect(textEl.bounds).toEqual({ x: 100, y: 200, width: 500, height: 60 });

    // image element
    const imgEl = result[0].elements[1];
    expect(imgEl.type).toBe("image");
    expect(imgEl.content).toBe("media/abc123.png");
    expect(imgEl.style.fontSize).toBeUndefined();
    expect(imgEl.style.fontFamily).toBeUndefined();
    expect(imgEl.style.color).toBeUndefined();
    expect(imgEl.bounds).toEqual({ x: 600, y: 100, width: 580, height: 400 });
  });

  it("detects image type when src is set (non-IMG tagName)", () => {
    const raw = [
      {
        id: "section-1",
        bounds: { x: 0, y: 0, width: 1280, height: 400 },
        elements: [
          {
            tagName: "DIV",
            textContent: "",
            style: { fontSize: "16px", fontFamily: "Arial", color: "rgb(0,0,0)" },
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            src: "media/bg.jpg",
          },
        ],
      },
    ];

    const result = buildSectionData(raw);
    expect(result[0].elements[0].type).toBe("image");
    expect(result[0].elements[0].content).toBe("media/bg.jpg");
  });

  it("assigns index from array position", () => {
    const raw = [
      {
        id: "section-1",
        bounds: { x: 0, y: 0, width: 1280, height: 400 },
        elements: [],
      },
      {
        id: "section-2",
        bounds: { x: 0, y: 400, width: 1280, height: 400 },
        elements: [],
      },
      {
        id: "section-3",
        bounds: { x: 0, y: 800, width: 1280, height: 400 },
        elements: [],
      },
    ];

    const result = buildSectionData(raw);
    expect(result[0].index).toBe(0);
    expect(result[1].index).toBe(1);
    expect(result[2].index).toBe(2);
  });

  it("parses fontSize string to number", () => {
    const raw = [
      {
        id: "section-1",
        bounds: { x: 0, y: 0, width: 1280, height: 400 },
        elements: [
          {
            tagName: "H1",
            textContent: "Title",
            style: { fontSize: "72px", fontFamily: "Georgia", color: "rgb(0, 0, 0)" },
            bounds: { x: 0, y: 0, width: 800, height: 80 },
            src: null,
          },
        ],
      },
    ];

    const result = buildSectionData(raw);
    expect(result[0].elements[0].style.fontSize).toBe(72);
    expect(typeof result[0].elements[0].style.fontSize).toBe("number");
  });

  it("trims whitespace from text content", () => {
    const raw = [
      {
        id: "section-1",
        bounds: { x: 0, y: 0, width: 1280, height: 400 },
        elements: [
          {
            tagName: "P",
            textContent: "  padded text  ",
            style: { fontSize: "16px", fontFamily: "Arial", color: "rgb(0,0,0)" },
            bounds: { x: 0, y: 0, width: 400, height: 40 },
            src: null,
          },
        ],
      },
    ];

    const result = buildSectionData(raw);
    expect(result[0].elements[0].content).toBe("padded text");
  });

  it("handles empty elements array in a section", () => {
    const raw = [
      {
        id: "section-empty",
        bounds: { x: 0, y: 0, width: 1280, height: 400 },
        elements: [],
      },
    ];

    const result = buildSectionData(raw);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
    expect(result[0].elements).toEqual([]);
  });

  it("handles empty array input", () => {
    const result = buildSectionData([]);
    expect(result).toEqual([]);
  });
});
