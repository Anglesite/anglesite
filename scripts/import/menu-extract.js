/**
 * Menu extraction utilities for PDF/image → structured Keystatic data.
 *
 * Pure functions that normalize Claude vision output into the three-level
 * menu hierarchy (menus → menuSections → menuItems) used by Keystatic.
 */

// ---------------------------------------------------------------------------
// normalizePrice
// ---------------------------------------------------------------------------

const MARKET_PRICE_RE = /^market\s+price$/i;
const BARE_NUMBER_RE = /^\d+(\.\d+)?$/;
const TRAILING_ZEROES_RE = /\.00$/;

/**
 * Normalize a price string for Keystatic's text-based price field.
 * Preserves human-readable formats; adds "$" to bare numbers; strips ".00".
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalizePrice(raw) {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (trimmed === "") return "";

  if (MARKET_PRICE_RE.test(trimmed)) return "Market Price";

  // Bare number → add dollar sign
  if (BARE_NUMBER_RE.test(trimmed)) {
    return "$" + trimmed.replace(TRAILING_ZEROES_RE, "");
  }

  // Already has $ — just clean up trailing .00
  if (trimmed.startsWith("$")) {
    return trimmed.replace(TRAILING_ZEROES_RE, "");
  }

  // Price ranges like "$12-$18" — clean each half
  if (trimmed.includes("-") && trimmed.includes("$")) {
    return trimmed;
  }

  // Non-numeric text like "Seasonal"
  return trimmed;
}

// ---------------------------------------------------------------------------
// parseDietaryIndicators
// ---------------------------------------------------------------------------

/** Known dietary abbreviations (uppercase canonical forms). */
const DIETARY_ABBREVS = new Set(["V", "VG", "GF", "DF", "NF", "SF", "K", "H", "CA"]);

/** Emoji → dietary code mapping. */
const EMOJI_DIETARY = new Map([
  ["🌿", "V"],   // vegetarian / plant
  ["🌱", "V"],   // seedling → vegetarian
  ["🌾", "GF"],  // sheaf → gluten-free (crossed grain is rare in Unicode)
  ["🥜", "NF"],  // peanut → contains nuts (inverse, but commonly used)
  ["🔥", "SPICY"],
  ["🍷", "CA"],  // wine glass → contains alcohol
  ["🍸", "CA"],  // cocktail glass → contains alcohol
]);

const FOOTNOTE_RE = /[*†‡§]+$/;
const DIETARY_PARENS_RE = /\(([A-Za-z]{1,3}(?:\s*,\s*[A-Za-z]{1,3})*)\)\s*$/;

/**
 * Parse dietary indicators and footnote markers from a menu item name.
 *
 * @param {string} text  Raw item name, possibly with trailing (V, GF)* markers
 * @returns {{ cleanName: string, dietary: string[], footnotes: string[] }}
 */
export function parseDietaryIndicators(text) {
  let cleanName = text;
  const dietary = [];
  const footnotes = [];

  // 1. Extract footnote markers from the end
  const fnMatch = cleanName.match(FOOTNOTE_RE);
  if (fnMatch) {
    for (const ch of fnMatch[0]) {
      footnotes.push(ch);
    }
    cleanName = cleanName.slice(0, fnMatch.index).trimEnd();
  }

  // 2. Extract parenthetical dietary abbreviations
  const parenMatch = cleanName.match(DIETARY_PARENS_RE);
  if (parenMatch) {
    const abbrevs = parenMatch[1].split(/\s*,\s*/);
    const allDietary = abbrevs.every((a) =>
      DIETARY_ABBREVS.has(a.toUpperCase())
    );
    if (allDietary) {
      for (const a of abbrevs) dietary.push(a.toUpperCase());
      cleanName = cleanName.slice(0, parenMatch.index).trimEnd();
    }
  }

  // 3. Extract emoji dietary markers
  for (const [emoji, code] of EMOJI_DIETARY) {
    if (cleanName.includes(emoji)) {
      dietary.push(code);
      cleanName = cleanName.replaceAll(emoji, "");
    }
  }
  cleanName = cleanName.trimEnd();

  return { cleanName, dietary, footnotes };
}

// ---------------------------------------------------------------------------
// buildMenuHierarchy
// ---------------------------------------------------------------------------

/**
 * Convert a string to a URL-safe slug.
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a 3-level Keystatic hierarchy from a flat list of extracted items.
 *
 * Each input item should have: { menuName?, sectionName, name, description, price }
 * Output: { menus: [...], sections: [...], items: [...] } with slugs and relationships.
 *
 * @param {Array<{menuName?: string, sectionName: string, name: string, description: string, price: string}>} flatItems
 * @returns {{ menus: object[], sections: object[], items: object[] }}
 */
export function buildMenuHierarchy(flatItems) {
  const menuMap = new Map();   // menuSlug → { name, slug, order }
  const sectionMap = new Map(); // "menuSlug/sectionSlug" → { name, slug, menu, order }
  const items = [];

  // Track ordering per group
  let menuOrder = 0;
  const sectionOrderByMenu = new Map();  // menuSlug → counter
  const itemOrderBySection = new Map();  // sectionSlug → counter

  for (const raw of flatItems) {
    const menuName = raw.menuName || "Menu";
    const menuSlug = slugify(menuName);

    // Ensure menu exists
    if (!menuMap.has(menuSlug)) {
      menuOrder++;
      menuMap.set(menuSlug, { name: menuName, slug: menuSlug, order: menuOrder });
      sectionOrderByMenu.set(menuSlug, 0);
    }

    // Ensure section exists
    const sectionSlug = slugify(raw.sectionName);
    const sectionKey = `${menuSlug}/${sectionSlug}`;
    if (!sectionMap.has(sectionKey)) {
      const counter = sectionOrderByMenu.get(menuSlug) + 1;
      sectionOrderByMenu.set(menuSlug, counter);
      sectionMap.set(sectionKey, {
        name: raw.sectionName,
        slug: sectionSlug,
        menu: menuSlug,
        order: counter,
      });
      itemOrderBySection.set(sectionKey, 0);
    }

    // Parse dietary from name
    const { cleanName, dietary } = parseDietaryIndicators(raw.name);

    const itemCounter = itemOrderBySection.get(sectionKey) + 1;
    itemOrderBySection.set(sectionKey, itemCounter);

    items.push({
      name: cleanName,
      slug: slugify(cleanName),
      section: sectionSlug,
      description: raw.description || "",
      price: normalizePrice(raw.price),
      dietary,
      available: true,
      order: itemCounter,
    });
  }

  return {
    menus: [...menuMap.values()],
    sections: [...sectionMap.values()],
    items,
  };
}

// ---------------------------------------------------------------------------
// extractDesignTokens
// ---------------------------------------------------------------------------

/** Well-known serif font families for fallback classification. */
const SERIF_FONTS = new Set([
  "georgia", "times", "times new roman", "garamond", "palatino",
  "book antiqua", "baskerville", "cambria", "didot", "bodoni",
  "playfair display", "merriweather", "lora", "libre baskerville",
  "cormorant", "crimson text", "eb garamond", "spectral",
]);

/**
 * Classify a font name as serif or sans-serif for CSS fallback.
 * @param {string} name
 * @returns {string}
 */
function fontFallback(name) {
  const lower = name.toLowerCase();
  if (lower.includes("serif") && !lower.includes("sans")) return "serif";
  if (lower.includes("sans")) return "sans-serif";
  if (lower.includes("script") || lower.includes("cursive")) return "cursive";
  if (lower.includes("mono")) return "monospace";
  if (SERIF_FONTS.has(lower)) return "serif";
  return "sans-serif";
}

/**
 * Extract design tokens from Claude vision's description of the menu's
 * visual style. Maps colors, fonts, and layout to CSS custom properties.
 *
 * @param {{ colors?: { primary?: string, accent?: string, background?: string, text?: string }, fonts?: { heading?: string, body?: string }, layout?: string }} raw
 * @returns {Record<string, string>}
 */
export function extractDesignTokens(raw) {
  const tokens = {};

  // Colors
  if (raw.colors) {
    if (raw.colors.primary) tokens["--menu-color-primary"] = raw.colors.primary;
    if (raw.colors.accent) tokens["--menu-color-accent"] = raw.colors.accent;
    if (raw.colors.background) tokens["--menu-color-bg"] = raw.colors.background;
    if (raw.colors.text) tokens["--menu-color-text"] = raw.colors.text;
  }

  // Fonts
  if (raw.fonts) {
    if (raw.fonts.heading) {
      tokens["--menu-font-heading"] = `"${raw.fonts.heading}", ${fontFallback(raw.fonts.heading)}`;
    }
    if (raw.fonts.body) {
      tokens["--menu-font-body"] = `"${raw.fonts.body}", ${fontFallback(raw.fonts.body)}`;
    }
  }

  // Layout
  tokens["--menu-layout"] = raw.layout || "single-column";

  return tokens;
}

// ---------------------------------------------------------------------------
// stitchMenuPages
// ---------------------------------------------------------------------------

/**
 * Deep-merge two plain objects (one level deep — sufficient for design tokens).
 * @param {object} a
 * @param {object} b
 * @returns {object}
 */
function shallowDeepMerge(a, b) {
  const result = { ...a };
  for (const [key, val] of Object.entries(b)) {
    if (val && typeof val === "object" && !Array.isArray(val) && result[key]) {
      result[key] = { ...result[key], ...val };
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Stitch multiple page extractions into a single unified menu.
 *
 * Handles section continuations across page breaks, merges design tokens,
 * and concatenates image lists.
 *
 * @param {Array<{ items?: object[], designTokens?: object, images?: object[] }>} pages
 * @returns {{ items: object[], designTokens: object, images: object[] }}
 */
export function stitchMenuPages(pages) {
  if (pages.length === 0) return { items: [], designTokens: {}, images: [] };

  const allItems = [];
  let mergedTokens = {};
  const allImages = [];

  for (const page of pages) {
    if (page.items) {
      allItems.push(...page.items);
    }
    if (page.designTokens) {
      mergedTokens = shallowDeepMerge(mergedTokens, page.designTokens);
    }
    if (page.images) {
      allImages.push(...page.images);
    }
  }

  return { items: allItems, designTokens: mergedTokens, images: allImages };
}

// ---------------------------------------------------------------------------
// toKeystatic
// ---------------------------------------------------------------------------

/**
 * Convert a menu hierarchy into Keystatic-compatible file descriptors.
 *
 * Each entry has: { slug, path, frontmatter, content }
 * ready for writing as .mdoc files.
 *
 * @param {{ menus: object[], sections: object[], items: object[] }} hierarchy
 * @returns {{ menus: object[], sections: object[], items: object[] }}
 */
export function toKeystatic(hierarchy) {
  const menus = hierarchy.menus.map((m) => ({
    slug: m.slug,
    path: `src/content/menus/${m.slug}.mdoc`,
    frontmatter: {
      name: m.name,
      description: m.description || "",
      order: m.order,
    },
    content: "",
  }));

  const sections = hierarchy.sections.map((s) => ({
    slug: s.slug,
    path: `src/content/menuSections/${s.slug}.mdoc`,
    frontmatter: {
      name: s.name,
      menu: s.menu,
      description: s.description || "",
      order: s.order,
    },
    content: "",
  }));

  const items = hierarchy.items.map((i) => ({
    slug: i.slug,
    path: `src/content/menuItems/${i.slug}.mdoc`,
    frontmatter: {
      name: i.name,
      section: i.section,
      price: i.price,
      dietary: i.dietary || [],
      available: i.available !== false,
      order: i.order,
    },
    content: i.description || "",
  }));

  return { menus, sections, items };
}

// ---------------------------------------------------------------------------
// generateMenuCSS
// ---------------------------------------------------------------------------

/** Tokens that are hints, not CSS custom properties. */
const NON_CSS_TOKENS = new Set(["--menu-layout"]);

/**
 * Generate a CSS stylesheet from extracted design tokens.
 *
 * @param {Record<string, string>} tokens  Output from extractDesignTokens()
 * @returns {string}  CSS text, or empty string if no tokens
 */
export function generateMenuCSS(tokens) {
  const entries = Object.entries(tokens).filter(
    ([key]) => !NON_CSS_TOKENS.has(key)
  );
  if (entries.length === 0) return "";

  const props = entries.map(([key, val]) => `  ${key}: ${val};`).join("\n");
  return `/* Menu design tokens — extracted from imported menu */\n:root {\n${props}\n}\n`;
}
