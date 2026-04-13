import { describe, it, expect } from "vitest";
import {
  normalizePrice,
  parseDietaryIndicators,
  buildMenuHierarchy,
  extractDesignTokens,
  stitchMenuPages,
  toKeystatic,
  generateMenuCSS,
} from "../scripts/import/menu-extract.mjs";

// ---------------------------------------------------------------------------
// normalizePrice
// ---------------------------------------------------------------------------

describe("normalizePrice", () => {
  it("preserves dollar amount with cents", () => {
    expect(normalizePrice("$12.50")).toBe("$12.50");
  });

  it("preserves dollar amount without cents", () => {
    expect(normalizePrice("$12")).toBe("$12");
  });

  it("adds dollar sign to bare number", () => {
    expect(normalizePrice("12")).toBe("$12");
  });

  it("adds dollar sign to bare decimal", () => {
    expect(normalizePrice("12.50")).toBe("$12.50");
  });

  it("preserves 'Market Price' as-is", () => {
    expect(normalizePrice("Market Price")).toBe("Market Price");
  });

  it("preserves 'market price' case-insensitively", () => {
    expect(normalizePrice("market price")).toBe("Market Price");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizePrice(null)).toBe("");
    expect(normalizePrice(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(normalizePrice("")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizePrice("  $14.00  ")).toBe("$14");
  });

  it("handles price ranges", () => {
    expect(normalizePrice("$12-$18")).toBe("$12-$18");
  });

  it("preserves 'Seasonal' or other text prices", () => {
    expect(normalizePrice("Seasonal")).toBe("Seasonal");
  });

  it("strips trailing zeroes only when .00", () => {
    expect(normalizePrice("$12.00")).toBe("$12");
    expect(normalizePrice("$12.50")).toBe("$12.50");
    expect(normalizePrice("$12.10")).toBe("$12.10");
  });
});

// ---------------------------------------------------------------------------
// parseDietaryIndicators
// ---------------------------------------------------------------------------

describe("parseDietaryIndicators", () => {
  it("extracts parenthetical abbreviations (V, GF)", () => {
    const result = parseDietaryIndicators("Caesar Salad (V, GF)");
    expect(result.dietary).toEqual(["V", "GF"]);
    expect(result.cleanName).toBe("Caesar Salad");
  });

  it("extracts single abbreviation in parens", () => {
    const result = parseDietaryIndicators("Pad Thai (VG)");
    expect(result.dietary).toEqual(["VG"]);
    expect(result.cleanName).toBe("Pad Thai");
  });

  it("handles lowercase indicators", () => {
    const result = parseDietaryIndicators("Soup (v, gf, df)");
    expect(result.dietary).toEqual(["V", "GF", "DF"]);
  });

  it("extracts trailing asterisk footnotes", () => {
    const result = parseDietaryIndicators("Grilled Chicken*");
    expect(result.footnotes).toEqual(["*"]);
    expect(result.cleanName).toBe("Grilled Chicken");
  });

  it("extracts dagger footnote markers", () => {
    const result = parseDietaryIndicators("Fish Tacos†");
    expect(result.footnotes).toEqual(["†"]);
    expect(result.cleanName).toBe("Fish Tacos");
  });

  it("extracts multiple footnote markers", () => {
    const result = parseDietaryIndicators("Risotto*†");
    expect(result.footnotes).toEqual(["*", "†"]);
    expect(result.cleanName).toBe("Risotto");
  });

  it("returns empty arrays for plain item names", () => {
    const result = parseDietaryIndicators("Burger");
    expect(result.dietary).toEqual([]);
    expect(result.footnotes).toEqual([]);
    expect(result.cleanName).toBe("Burger");
  });

  it("handles combined parens and footnotes", () => {
    const result = parseDietaryIndicators("Tofu Bowl (V, GF)*");
    expect(result.dietary).toEqual(["V", "GF"]);
    expect(result.footnotes).toEqual(["*"]);
    expect(result.cleanName).toBe("Tofu Bowl");
  });

  it("does not treat non-dietary parens as indicators", () => {
    const result = parseDietaryIndicators("Chicken Wings (6 pcs)");
    expect(result.dietary).toEqual([]);
    expect(result.cleanName).toBe("Chicken Wings (6 pcs)");
  });

  it("handles emoji dietary markers", () => {
    const result = parseDietaryIndicators("Salad 🌿🌾");
    expect(result.dietary).toEqual(["V", "GF"]);
    expect(result.cleanName).toBe("Salad");
  });

  it("extracts contains-alcohol abbreviation (CA)", () => {
    const result = parseDietaryIndicators("Tiramisu (CA)");
    expect(result.dietary).toEqual(["CA"]);
    expect(result.cleanName).toBe("Tiramisu");
  });

  it("extracts wine glass emoji as contains-alcohol", () => {
    const result = parseDietaryIndicators("Red Wine Risotto 🍷");
    expect(result.dietary).toEqual(["CA"]);
    expect(result.cleanName).toBe("Red Wine Risotto");
  });

  it("extracts cocktail glass emoji as contains-alcohol", () => {
    const result = parseDietaryIndicators("Rum Cake 🍸");
    expect(result.dietary).toEqual(["CA"]);
    expect(result.cleanName).toBe("Rum Cake");
  });
});

// ---------------------------------------------------------------------------
// buildMenuHierarchy
// ---------------------------------------------------------------------------

describe("buildMenuHierarchy", () => {
  const flatItems = [
    {
      menuName: "Dinner",
      sectionName: "Appetizers",
      name: "Caesar Salad (V, GF)",
      description: "Romaine, parmesan, croutons",
      price: "$14",
    },
    {
      menuName: "Dinner",
      sectionName: "Appetizers",
      name: "Bruschetta",
      description: "Tomato, basil, garlic",
      price: "$12",
    },
    {
      menuName: "Dinner",
      sectionName: "Entrees",
      name: "Grilled Salmon*",
      description: "Wild-caught, lemon butter",
      price: "$28",
    },
    {
      menuName: "Lunch",
      sectionName: "Sandwiches",
      name: "Club Sandwich",
      description: "Turkey, bacon, avocado",
      price: "$16",
    },
  ];

  it("creates menus from unique menuName values", () => {
    const result = buildMenuHierarchy(flatItems);
    expect(result.menus).toHaveLength(2);
    expect(result.menus.map((m) => m.name)).toEqual(["Dinner", "Lunch"]);
  });

  it("generates URL-safe slugs", () => {
    const result = buildMenuHierarchy(flatItems);
    expect(result.menus[0].slug).toBe("dinner");
    expect(result.sections[0].slug).toBe("appetizers");
    expect(result.items[0].slug).toBe("caesar-salad");
  });

  it("creates sections with menu relationship", () => {
    const result = buildMenuHierarchy(flatItems);
    const appetizers = result.sections.find((s) => s.name === "Appetizers");
    expect(appetizers.menu).toBe("dinner");
  });

  it("creates items with section relationship", () => {
    const result = buildMenuHierarchy(flatItems);
    const caesar = result.items.find((i) => i.name === "Caesar Salad");
    expect(caesar.section).toBe("appetizers");
  });

  it("parses dietary indicators from item names", () => {
    const result = buildMenuHierarchy(flatItems);
    const caesar = result.items.find((i) => i.name === "Caesar Salad");
    expect(caesar.dietary).toEqual(["V", "GF"]);
  });

  it("normalizes prices", () => {
    const result = buildMenuHierarchy(flatItems);
    expect(result.items[0].price).toBe("$14");
  });

  it("assigns sequential order within each group", () => {
    const result = buildMenuHierarchy(flatItems);
    const dinnerSections = result.sections.filter(
      (s) => s.menu === "dinner"
    );
    expect(dinnerSections[0].order).toBe(1);
    expect(dinnerSections[1].order).toBe(2);

    const appetizerItems = result.items.filter(
      (i) => i.section === "appetizers"
    );
    expect(appetizerItems[0].order).toBe(1);
    expect(appetizerItems[1].order).toBe(2);
  });

  it("handles items without a menu name (default menu)", () => {
    const noMenu = [
      { sectionName: "Sides", name: "Fries", description: "", price: "$5" },
    ];
    const result = buildMenuHierarchy(noMenu);
    expect(result.menus).toHaveLength(1);
    expect(result.menus[0].name).toBe("Menu");
    expect(result.menus[0].slug).toBe("menu");
  });

  it("deduplicates identical section names within same menu", () => {
    const dupes = [
      { menuName: "Dinner", sectionName: "Apps", name: "A", description: "", price: "" },
      { menuName: "Dinner", sectionName: "Apps", name: "B", description: "", price: "" },
    ];
    const result = buildMenuHierarchy(dupes);
    expect(result.sections).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractDesignTokens
// ---------------------------------------------------------------------------

describe("extractDesignTokens", () => {
  it("maps hex colors to CSS custom properties", () => {
    const tokens = extractDesignTokens({
      colors: { primary: "#8B0000", accent: "#DAA520", background: "#FFF8F0", text: "#2C1810" },
    });
    expect(tokens["--menu-color-primary"]).toBe("#8B0000");
    expect(tokens["--menu-color-accent"]).toBe("#DAA520");
    expect(tokens["--menu-color-bg"]).toBe("#FFF8F0");
    expect(tokens["--menu-color-text"]).toBe("#2C1810");
  });

  it("maps font descriptions to CSS font properties", () => {
    const tokens = extractDesignTokens({
      fonts: { heading: "Playfair Display", body: "Lato" },
    });
    expect(tokens["--menu-font-heading"]).toBe('"Playfair Display", serif');
    expect(tokens["--menu-font-body"]).toBe('"Lato", sans-serif');
  });

  it("classifies serif vs sans-serif font families", () => {
    const tokens = extractDesignTokens({
      fonts: { heading: "Georgia", body: "Arial" },
    });
    expect(tokens["--menu-font-heading"]).toBe('"Georgia", serif');
    expect(tokens["--menu-font-body"]).toBe('"Arial", sans-serif');
  });

  it("maps layout pattern to a token", () => {
    const tokens = extractDesignTokens({ layout: "two-column" });
    expect(tokens["--menu-layout"]).toBe("two-column");
  });

  it("defaults layout to single-column", () => {
    const tokens = extractDesignTokens({});
    expect(tokens["--menu-layout"]).toBe("single-column");
  });

  it("handles missing colors gracefully", () => {
    const tokens = extractDesignTokens({ fonts: { heading: "Georgia" } });
    expect(tokens["--menu-color-primary"]).toBeUndefined();
  });

  it("handles missing fonts gracefully", () => {
    const tokens = extractDesignTokens({ colors: { primary: "#000" } });
    expect(tokens["--menu-font-heading"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stitchMenuPages
// ---------------------------------------------------------------------------

describe("stitchMenuPages", () => {
  it("concatenates items from multiple pages", () => {
    const pages = [
      {
        items: [
          { menuName: "Dinner", sectionName: "Appetizers", name: "Salad", description: "", price: "$10" },
        ],
      },
      {
        items: [
          { menuName: "Dinner", sectionName: "Entrees", name: "Steak", description: "", price: "$30" },
        ],
      },
    ];
    const result = stitchMenuPages(pages);
    expect(result.items).toHaveLength(2);
  });

  it("merges sections that continue across page breaks", () => {
    const pages = [
      {
        items: [
          { menuName: "Dinner", sectionName: "Appetizers", name: "Salad", description: "", price: "$10" },
          { menuName: "Dinner", sectionName: "Entrees", name: "Salmon", description: "", price: "$28" },
        ],
      },
      {
        items: [
          // Same section continues on next page
          { menuName: "Dinner", sectionName: "Entrees", name: "Steak", description: "", price: "$32" },
          { menuName: "Dinner", sectionName: "Desserts", name: "Cake", description: "", price: "$12" },
        ],
      },
    ];
    const result = stitchMenuPages(pages);
    expect(result.items).toHaveLength(4);
    // All items should be present in order
    expect(result.items.map((i) => i.name)).toEqual(["Salad", "Salmon", "Steak", "Cake"]);
  });

  it("merges design tokens from first page that has them", () => {
    const pages = [
      { items: [], designTokens: { colors: { primary: "#8B0000" } } },
      { items: [], designTokens: { colors: { accent: "#DAA520" } } },
    ];
    const result = stitchMenuPages(pages);
    expect(result.designTokens.colors.primary).toBe("#8B0000");
    expect(result.designTokens.colors.accent).toBe("#DAA520");
  });

  it("handles single page input", () => {
    const pages = [
      {
        items: [{ menuName: "Lunch", sectionName: "Soups", name: "Tomato", description: "", price: "$8" }],
      },
    ];
    const result = stitchMenuPages(pages);
    expect(result.items).toHaveLength(1);
  });

  it("handles empty pages array", () => {
    const result = stitchMenuPages([]);
    expect(result.items).toEqual([]);
    expect(result.designTokens).toEqual({});
  });

  it("collects images from all pages", () => {
    const pages = [
      { items: [], images: [{ src: "page1.jpg", alt: "dish1" }] },
      { items: [], images: [{ src: "page2.jpg", alt: "dish2" }] },
    ];
    const result = stitchMenuPages(pages);
    expect(result.images).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// toKeystatic
// ---------------------------------------------------------------------------

describe("toKeystatic", () => {
  const hierarchy = {
    menus: [{ name: "Dinner", slug: "dinner", order: 1 }],
    sections: [
      { name: "Appetizers", slug: "appetizers", menu: "dinner", order: 1 },
    ],
    items: [
      {
        name: "Caesar Salad",
        slug: "caesar-salad",
        section: "appetizers",
        description: "Romaine, parmesan, croutons",
        price: "$14",
        dietary: ["V", "GF"],
        available: true,
        order: 1,
      },
    ],
  };

  it("generates menu .mdoc frontmatter", () => {
    const result = toKeystatic(hierarchy);
    expect(result.menus).toHaveLength(1);
    const menu = result.menus[0];
    expect(menu.slug).toBe("dinner");
    expect(menu.frontmatter.name).toBe("Dinner");
    expect(menu.frontmatter.order).toBe(1);
  });

  it("generates section .mdoc frontmatter with menu relationship", () => {
    const result = toKeystatic(hierarchy);
    const section = result.sections[0];
    expect(section.slug).toBe("appetizers");
    expect(section.frontmatter.name).toBe("Appetizers");
    expect(section.frontmatter.menu).toBe("dinner");
  });

  it("generates item .mdoc frontmatter with all fields", () => {
    const result = toKeystatic(hierarchy);
    const item = result.items[0];
    expect(item.slug).toBe("caesar-salad");
    expect(item.frontmatter.name).toBe("Caesar Salad");
    expect(item.frontmatter.section).toBe("appetizers");
    expect(item.frontmatter.price).toBe("$14");
    expect(item.frontmatter.dietary).toEqual(["V", "GF"]);
    expect(item.frontmatter.available).toBe(true);
    expect(item.frontmatter.order).toBe(1);
  });

  it("includes description as content body", () => {
    const result = toKeystatic(hierarchy);
    const item = result.items[0];
    expect(item.content).toBe("Romaine, parmesan, croutons");
  });

  it("generates file paths for each collection", () => {
    const result = toKeystatic(hierarchy);
    expect(result.menus[0].path).toBe("src/content/menus/dinner.mdoc");
    expect(result.sections[0].path).toBe("src/content/menuSections/appetizers.mdoc");
    expect(result.items[0].path).toBe("src/content/menuItems/caesar-salad.mdoc");
  });
});

// ---------------------------------------------------------------------------
// generateMenuCSS
// ---------------------------------------------------------------------------

describe("generateMenuCSS", () => {
  it("generates CSS with custom properties", () => {
    const tokens = {
      "--menu-color-primary": "#8B0000",
      "--menu-color-accent": "#DAA520",
      "--menu-color-bg": "#FFF8F0",
      "--menu-color-text": "#2C1810",
      "--menu-font-heading": '"Playfair Display", serif',
      "--menu-font-body": '"Lato", sans-serif',
      "--menu-layout": "two-column",
    };
    const css = generateMenuCSS(tokens);
    expect(css).toContain("--menu-color-primary: #8B0000");
    expect(css).toContain("--menu-font-heading:");
    expect(css).toContain(":root");
  });

  it("generates empty string for empty tokens", () => {
    const css = generateMenuCSS({});
    expect(css).toBe("");
  });

  it("excludes layout token from CSS custom properties", () => {
    const css = generateMenuCSS({ "--menu-layout": "two-column" });
    // Layout is a hint for the template, not a CSS property
    expect(css).not.toContain("--menu-layout");
  });

  it("includes a comment header", () => {
    const css = generateMenuCSS({ "--menu-color-primary": "#000" });
    expect(css).toContain("/* Menu design tokens");
  });
});
