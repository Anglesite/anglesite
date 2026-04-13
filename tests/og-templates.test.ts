import { describe, it, expect } from "vitest";
import {
  textOnlyTemplate,
  textLogoTemplate,
  OG_WIDTH,
  OG_HEIGHT,
  type OgColors,
} from "../template/scripts/og-templates.js";

const colors: OgColors = {
  primary: "#2563eb",
  bg: "#ffffff",
  text: "#1a1a1a",
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("OG image constants", () => {
  it("exports standard OG dimensions", () => {
    expect(OG_WIDTH).toBe(1200);
    expect(OG_HEIGHT).toBe(630);
  });
});

// ---------------------------------------------------------------------------
// textOnlyTemplate
// ---------------------------------------------------------------------------

describe("textOnlyTemplate", () => {
  it("returns a root element with correct dimensions", () => {
    const tree = textOnlyTemplate("Hello World", "My Site", colors);
    expect(tree.type).toBe("div");
    expect(tree.props.style.width).toBe(OG_WIDTH);
    expect(tree.props.style.height).toBe(OG_HEIGHT);
  });

  it("uses primary color as background", () => {
    const tree = textOnlyTemplate("Hello", "Site", colors);
    expect(tree.props.style.backgroundColor).toBe("#2563eb");
  });

  it("includes the page title", () => {
    const tree = textOnlyTemplate("About Us", "My Site", colors);
    const texts = flattenText(tree);
    expect(texts).toContain("About Us");
  });

  it("includes the site name", () => {
    const tree = textOnlyTemplate("About Us", "My Site", colors);
    const texts = flattenText(tree);
    expect(texts).toContain("My Site");
  });

  it("uses bg color for text", () => {
    const tree = textOnlyTemplate("Title", "Site", colors);
    // The title element should use bg color for contrast against primary bg
    const titleNode = findByText(tree, "Title");
    expect(titleNode?.props.style.color).toBe("#ffffff");
  });

  it("handles long titles without crashing", () => {
    const longTitle = "A".repeat(200);
    const tree = textOnlyTemplate(longTitle, "Site", colors);
    expect(tree.type).toBe("div");
    const texts = flattenText(tree);
    expect(texts).toContain(longTitle);
  });

  it("handles empty title", () => {
    const tree = textOnlyTemplate("", "Site", colors);
    expect(tree.type).toBe("div");
  });
});

// ---------------------------------------------------------------------------
// textLogoTemplate
// ---------------------------------------------------------------------------

describe("textLogoTemplate", () => {
  const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle r="16" cx="16" cy="16" fill="red"/></svg>';

  it("returns a root element with correct dimensions", () => {
    const tree = textLogoTemplate("Hello", "Site", colors, logoSvg);
    expect(tree.type).toBe("div");
    expect(tree.props.style.width).toBe(OG_WIDTH);
    expect(tree.props.style.height).toBe(OG_HEIGHT);
  });

  it("includes the page title", () => {
    const tree = textLogoTemplate("Services", "My Biz", colors, logoSvg);
    const texts = flattenText(tree);
    expect(texts).toContain("Services");
  });

  it("includes the site name", () => {
    const tree = textLogoTemplate("Services", "My Biz", colors, logoSvg);
    const texts = flattenText(tree);
    expect(texts).toContain("My Biz");
  });

  it("includes an img element for the logo", () => {
    const tree = textLogoTemplate("Title", "Site", colors, logoSvg);
    const img = findByType(tree, "img");
    expect(img).toBeDefined();
    expect(img?.props.src).toContain("data:image/svg+xml");
  });

  it("falls back gracefully when logoSvg is empty", () => {
    const tree = textLogoTemplate("Title", "Site", colors, "");
    // Should still render without an img element
    const img = findByType(tree, "img");
    expect(img).toBeUndefined();
    const texts = flattenText(tree);
    expect(texts).toContain("Title");
  });
});

// ---------------------------------------------------------------------------
// Helpers — walk the Satori element tree
// ---------------------------------------------------------------------------

interface SatoriNode {
  type: string;
  props: {
    style?: Record<string, unknown>;
    src?: string;
    children?: (SatoriNode | string)[];
    [key: string]: unknown;
  };
}

/** Collect all text strings from the tree */
function flattenText(node: SatoriNode | string): string[] {
  if (typeof node === "string") return [node];
  const results: string[] = [];
  for (const child of node.props.children ?? []) {
    results.push(...flattenText(child));
  }
  return results;
}

/** Find the first node whose direct text child matches */
function findByText(
  node: SatoriNode | string,
  text: string,
): SatoriNode | undefined {
  if (typeof node === "string") return undefined;
  for (const child of node.props.children ?? []) {
    if (typeof child === "string" && child === text) return node;
    if (typeof child !== "string") {
      const found = findByText(child, text);
      if (found) return found;
    }
  }
  return undefined;
}

/** Find the first node with a given element type */
function findByType(
  node: SatoriNode | string,
  type: string,
): SatoriNode | undefined {
  if (typeof node === "string") return undefined;
  if (node.type === type) return node;
  for (const child of node.props.children ?? []) {
    if (typeof child !== "string") {
      const found = findByType(child, type);
      if (found) return found;
    }
  }
  return undefined;
}
