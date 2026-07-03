/**
 * Text hierarchy mapper for Canva design imports.
 *
 * Canva uses absolute positioning with explicit font sizes — no semantic HTML.
 * This module maps font sizes to HTML heading levels and identifies button-like
 * text elements so the page generator can emit semantic markup.
 */

/**
 * Assign HTML heading levels to a flat list of text elements based on font size.
 *
 * Mapping rules:
 * - fontSize <= 12  → `small`
 * - fontSize <= 20  → `p`
 * - fontSize > 20   → heading territory:
 *   - Unique sizes sorted descending; sizeRank 0 (largest):
 *     - h1Used false → `h1`
 *     - h1Used true  → `h2`
 *   - sizeRank 1 → `h2`
 *   - sizeRank 2+ → `h3`
 *
 * @param {Array<{content: string, style: {fontSize?: number}}>} elements
 * @param {{h1Used?: boolean}} [options]
 * @returns {Array<{content: string, tag: string}>}
 */
export function assignHeadingLevels(elements, options = {}) {
  if (elements.length === 0) return [];

  const { h1Used = false } = options;
  const DEFAULT_FONT_SIZE = 16;
  const HEADING_THRESHOLD = 20;

  // Collect unique heading-territory font sizes, sorted descending
  const headingSizes = [
    ...new Set(
      elements
        .map((el) => el.style?.fontSize ?? DEFAULT_FONT_SIZE)
        .filter((size) => size > HEADING_THRESHOLD)
    ),
  ].sort((a, b) => b - a);

  return elements.map((el) => {
    const fontSize = el.style?.fontSize ?? DEFAULT_FONT_SIZE;

    if (fontSize <= 12) {
      return { content: el.content, tag: "small" };
    }

    if (fontSize <= HEADING_THRESHOLD) {
      return { content: el.content, tag: "p" };
    }

    // Heading territory
    const sizeRank = headingSizes.indexOf(fontSize);

    let tag;
    if (sizeRank === 0 && !h1Used) {
      tag = "h1";
    } else if (sizeRank <= 1) {
      tag = "h2";
    } else {
      tag = "h3";
    }

    return { content: el.content, tag };
  });
}

/**
 * Detect button-like text elements by shape and content length.
 *
 * An element is considered button-like when ALL of:
 * - type is 'text'
 * - content.length <= 30
 * - bounds.height <= 60
 * - bounds.width <= 250
 *
 * @param {Array<{type: string, content: string, bounds: {width: number, height: number}}>} elements
 * @returns {number[]} Indices of button-like elements
 */
export function detectButtons(elements) {
  const indices = [];
  for (let i = 0; i < elements.length; i++) {
    const { type, content, bounds } = elements[i];
    if (
      type === "text" &&
      content.length <= 30 &&
      bounds.height <= 60 &&
      bounds.width <= 250
    ) {
      indices.push(i);
    }
  }
  return indices;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const { readFileSync } = await import("node:fs");
  const [file] = process.argv.slice(2);

  if (!file) {
    console.error("Usage: node text-hierarchy.mjs <extraction.json>");
    console.error("  extraction.json is the saved output of canva-playwright.mjs");
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(readFileSync(file, "utf8"));
  // Accept both extractCanvaSite ({pages: [...]}) and extractCanvaPage output
  const pages = data.pages ?? [data];

  const result = pages.map((page) => {
    let h1Used = false;
    return {
      url: page.url ?? null,
      sections: (page.sections ?? []).map((section) => {
        const elements = section.elements ?? [];
        const textElements = elements.filter((el) => el.type === "text");
        const tagged = assignHeadingLevels(textElements, { h1Used });
        if (tagged.some((t) => t.tag === "h1")) h1Used = true;
        return {
          index: section.index,
          text: tagged,
          buttonIndices: detectButtons(elements),
        };
      }),
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

// Only run CLI when executed directly
if (process.argv[1]?.endsWith("text-hierarchy.mjs")) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
