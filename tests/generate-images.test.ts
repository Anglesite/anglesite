import { describe, it, expect, vi } from "vitest";

// Mock template devDependencies not available at the plugin root
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("satori", () => ({ default: vi.fn() }));
vi.mock("@resvg/resvg-js", () => ({
  Resvg: vi.fn().mockImplementation(() => ({
    render: vi.fn().mockReturnValue({ asPng: () => new Uint8Array() }),
  })),
}));

import { readCssVar, escapeXml } from "../template/scripts/generate-images.js";

// ---------------------------------------------------------------------------
// readCssVar — extract CSS custom property values
// ---------------------------------------------------------------------------

describe("readCssVar", () => {
  const sampleCss = `
    :root {
      --color-primary: #2563eb;
      --color-bg: #ffffff;
      --font-body: "Inter", sans-serif;
      --spacing-lg: 2rem;
    }
  `;

  it("extracts a color value", () => {
    expect(readCssVar(sampleCss, "--color-primary")).toBe("#2563eb");
  });

  it("extracts a different color value", () => {
    expect(readCssVar(sampleCss, "--color-bg")).toBe("#ffffff");
  });

  it("extracts a font-family value", () => {
    expect(readCssVar(sampleCss, "--font-body")).toBe('"Inter", sans-serif');
  });

  it("extracts a spacing value", () => {
    expect(readCssVar(sampleCss, "--spacing-lg")).toBe("2rem");
  });

  it("returns undefined for a missing variable", () => {
    expect(readCssVar(sampleCss, "--color-accent")).toBeUndefined();
  });

  it("returns undefined for empty CSS", () => {
    expect(readCssVar("", "--color-primary")).toBeUndefined();
  });

  it("handles values with extra spaces", () => {
    const css = "--color-test:   hsl(200, 50%, 50%)  ;";
    expect(readCssVar(css, "--color-test")).toBe("hsl(200, 50%, 50%)");
  });
});

// ---------------------------------------------------------------------------
// escapeXml — XML/SVG entity escaping
// ---------------------------------------------------------------------------

describe("escapeXml", () => {
  it("escapes ampersands", () => {
    expect(escapeXml("A & B")).toBe("A &amp; B");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("handles multiple entities in one string", () => {
    expect(escapeXml('<a href="x&y">')).toBe("&lt;a href=&quot;x&amp;y&quot;&gt;");
  });

  it("leaves clean strings unchanged", () => {
    expect(escapeXml("Hello World")).toBe("Hello World");
  });

  it("handles empty string", () => {
    expect(escapeXml("")).toBe("");
  });

  it("handles string with only special characters", () => {
    expect(escapeXml('&<>"')).toBe("&amp;&lt;&gt;&quot;");
  });
});
