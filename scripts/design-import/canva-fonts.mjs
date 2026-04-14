// Font extraction utilities for Canva design import.
//
// Canva loads custom web fonts via @font-face declarations, but also injects
// its own system fonts. These functions filter out Canva system fonts and map
// user-chosen web fonts to the closest Anglesite system font stack (ADR-0005).

// ---------------------------------------------------------------------------
// Canva system fonts to filter out
// ---------------------------------------------------------------------------

const CANVA_SYSTEM_FONTS = new Set([
  "canva sans",
  "canva sans text",
  "canva sans display",
  "noto sans",
  "noto serif",
  "noto color emoji",
]);

// ---------------------------------------------------------------------------
// System font stack definitions
// ---------------------------------------------------------------------------

const STACKS = {
  "geometric-sans": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  "humanist-sans": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  "slab-serif": 'Georgia, "Rockwell", "Times New Roman", serif',
  monospace: '"SFMono-Regular", "Cascadia Code", "Fira Code", monospace',
  "default-sans": 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

// ---------------------------------------------------------------------------
// Font-to-category map
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const FONT_CATEGORIES = {};

/** @param {string[]} fonts @param {string} category */
function register(fonts, category) {
  for (const font of fonts) {
    FONT_CATEGORIES[font.toLowerCase()] = category;
  }
}

register(
  [
    "Montserrat",
    "Poppins",
    "Raleway",
    "Josefin Sans",
    "Quicksand",
    "Comfortaa",
    "Nunito",
    "Nunito Sans",
    "Outfit",
    "Space Grotesk",
    "DM Sans",
    "Lexend",
  ],
  "geometric-sans",
);

register(
  [
    "Open Sans",
    "Lato",
    "Roboto",
    "Inter",
    "Arimo",
    "Source Sans Pro",
    "Source Sans 3",
    "Work Sans",
    "Barlow",
    "Cabin",
    "Ubuntu",
    "Fira Sans",
    "Karla",
    "Rubik",
    "Manrope",
    "Plus Jakarta Sans",
    "Be Vietnam Pro",
  ],
  "humanist-sans",
);

register(
  [
    "Playfair Display",
    "Merriweather",
    "Lora",
    "EB Garamond",
    "Libre Baskerville",
    "Cormorant Garamond",
    "Crimson Text",
    "Bitter",
    "Frank Ruhl Libre",
    "DM Serif Display",
    "DM Serif Text",
    "Source Serif Pro",
    "Source Serif 4",
    "PT Serif",
    "Spectral",
    "Vollkorn",
  ],
  "serif",
);

register(
  [
    "Roboto Slab",
    "Arvo",
    "Zilla Slab",
    "Crete Round",
    "Rokkitt",
    "Josefin Slab",
    "Slabo 27px",
  ],
  "slab-serif",
);

register(
  [
    "Fira Code",
    "Fira Mono",
    "Source Code Pro",
    "JetBrains Mono",
    "Roboto Mono",
    "IBM Plex Mono",
    "Space Mono",
    "Courier Prime",
    "DM Mono",
  ],
  "monospace",
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter @font-face rules to remove Canva system fonts, deduplicate, and
 * return user-chosen font family names.
 *
 * @param {{ family: string }[]} fontFaceRules - Array of objects with a `family` property.
 * @returns {string[]} Deduplicated user font family names.
 */
export function parseCanvaFonts(fontFaceRules) {
  const seen = new Set();
  const result = [];

  for (const rule of fontFaceRules) {
    const family = rule.family;
    if (CANVA_SYSTEM_FONTS.has(family.toLowerCase())) continue;
    if (seen.has(family)) continue;
    seen.add(family);
    result.push(family);
  }

  return result;
}

/**
 * Map a web font family name to the closest system font stack.
 *
 * @param {string} fontFamily - The web font family name (e.g. "Montserrat").
 * @returns {{ stack: string, category: string, original: string }}
 */
export function mapToSystemStack(fontFamily) {
  const category = FONT_CATEGORIES[fontFamily.toLowerCase()] ?? "default-sans";
  return {
    stack: STACKS[category],
    category,
    original: fontFamily,
  };
}
