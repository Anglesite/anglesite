import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapDietaryTag,
  buildMenuItemJsonLd,
  buildMenuSectionJsonLd,
  generateMenuJsonLd,
  generateMenuPageJsonLd,
  type MenuItemData,
  type MenuSectionData,
  type MenuData,
} from "../template/scripts/menu.js";

// ---------------------------------------------------------------------------
// mapDietaryTag
// ---------------------------------------------------------------------------

describe("mapDietaryTag", () => {
  it("maps vegetarian to VegetarianDiet", () => {
    expect(mapDietaryTag("vegetarian")).toBe(
      "https://schema.org/VegetarianDiet",
    );
  });

  it("maps vegan to VeganDiet", () => {
    expect(mapDietaryTag("vegan")).toBe("https://schema.org/VeganDiet");
  });

  it("maps gluten-free to GlutenFreeDiet", () => {
    expect(mapDietaryTag("gluten-free")).toBe(
      "https://schema.org/GlutenFreeDiet",
    );
  });

  it("maps halal to HalalDiet", () => {
    expect(mapDietaryTag("halal")).toBe("https://schema.org/HalalDiet");
  });

  it("maps kosher to KosherDiet", () => {
    expect(mapDietaryTag("kosher")).toBe("https://schema.org/KosherDiet");
  });

  it("is case-insensitive", () => {
    expect(mapDietaryTag("Vegetarian")).toBe(
      "https://schema.org/VegetarianDiet",
    );
  });

  it("returns undefined for tags without schema.org mapping", () => {
    expect(mapDietaryTag("spicy")).toBeUndefined();
    expect(mapDietaryTag("raw")).toBeUndefined();
    expect(mapDietaryTag("nut-free")).toBeUndefined();
    expect(mapDietaryTag("contains-alcohol")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildMenuItemJsonLd
// ---------------------------------------------------------------------------

describe("buildMenuItemJsonLd", () => {
  const baseItem: MenuItemData = {
    name: "Margherita Pizza",
    description: "Fresh mozzarella, tomato, basil",
    price: "$14",
    dietary: ["vegetarian"],
    customTags: [],
    available: true,
    order: 0,
  };

  it("sets @type to MenuItem", () => {
    const ld = buildMenuItemJsonLd(baseItem);
    expect(ld["@type"]).toBe("MenuItem");
  });

  it("includes name", () => {
    const ld = buildMenuItemJsonLd(baseItem);
    expect(ld.name).toBe("Margherita Pizza");
  });

  it("includes description", () => {
    const ld = buildMenuItemJsonLd(baseItem);
    expect(ld.description).toBe("Fresh mozzarella, tomato, basil");
  });

  it("omits description when not set", () => {
    const noDesc = { ...baseItem, description: undefined };
    const ld = buildMenuItemJsonLd(noDesc);
    expect(ld.description).toBeUndefined();
  });

  it("includes offers with price", () => {
    const ld = buildMenuItemJsonLd(baseItem);
    const offers = ld.offers as Record<string, unknown>;
    expect(offers["@type"]).toBe("Offer");
    expect(offers.price).toBe("$14");
  });

  it("omits offers when no price", () => {
    const noPrice = { ...baseItem, price: undefined };
    const ld = buildMenuItemJsonLd(noPrice);
    expect(ld.offers).toBeUndefined();
  });

  it("includes suitableForDiet for recognized tags", () => {
    const ld = buildMenuItemJsonLd(baseItem);
    expect(ld.suitableForDiet).toEqual([
      "https://schema.org/VegetarianDiet",
    ]);
  });

  it("includes multiple dietary tags", () => {
    const multi = { ...baseItem, dietary: ["vegan", "gluten-free"] };
    const ld = buildMenuItemJsonLd(multi);
    expect(ld.suitableForDiet).toEqual([
      "https://schema.org/VeganDiet",
      "https://schema.org/GlutenFreeDiet",
    ]);
  });

  it("omits suitableForDiet when no recognized tags", () => {
    const noMatch = { ...baseItem, dietary: ["spicy", "raw"] };
    const ld = buildMenuItemJsonLd(noMatch);
    expect(ld.suitableForDiet).toBeUndefined();
  });

  it("omits suitableForDiet when dietary is empty", () => {
    const empty = { ...baseItem, dietary: [] };
    const ld = buildMenuItemJsonLd(empty);
    expect(ld.suitableForDiet).toBeUndefined();
  });

  it("includes image as absolute URL when siteUrl provided", () => {
    const withImage = { ...baseItem, image: "/images/menu/pizza.webp" };
    const ld = buildMenuItemJsonLd(withImage, "https://example.com");
    expect(ld.image).toBe("https://example.com/images/menu/pizza.webp");
  });

  it("omits image when no siteUrl", () => {
    const withImage = { ...baseItem, image: "/images/menu/pizza.webp" };
    const ld = buildMenuItemJsonLd(withImage);
    expect(ld.image).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildMenuSectionJsonLd
// ---------------------------------------------------------------------------

describe("buildMenuSectionJsonLd", () => {
  const section: MenuSectionData = {
    name: "Appetizers",
    description: "Start your meal right",
    order: 0,
  };

  const items: MenuItemData[] = [
    {
      name: "Bruschetta",
      section: "appetizers",
      description: "Toasted bread with tomatoes",
      price: "$8",
      dietary: ["vegetarian"],
      customTags: [],
      available: true,
      order: 1,
    },
    {
      name: "Calamari",
      section: "appetizers",
      price: "$12",
      dietary: [],
      customTags: [],
      available: true,
      order: 0,
    },
  ];

  it("sets @type to MenuSection", () => {
    const ld = buildMenuSectionJsonLd(section, items);
    expect(ld["@type"]).toBe("MenuSection");
  });

  it("includes section name", () => {
    const ld = buildMenuSectionJsonLd(section, items);
    expect(ld.name).toBe("Appetizers");
  });

  it("includes description", () => {
    const ld = buildMenuSectionJsonLd(section, items);
    expect(ld.description).toBe("Start your meal right");
  });

  it("omits description when not set", () => {
    const noDesc = { ...section, description: undefined };
    const ld = buildMenuSectionJsonLd(noDesc, items);
    expect(ld.description).toBeUndefined();
  });

  it("includes hasMenuItem with items sorted by order", () => {
    const ld = buildMenuSectionJsonLd(section, items);
    const menuItems = ld.hasMenuItem as Record<string, unknown>[];
    expect(menuItems).toHaveLength(2);
    expect(menuItems[0].name).toBe("Calamari"); // order 0
    expect(menuItems[1].name).toBe("Bruschetta"); // order 1
  });

  it("filters out unavailable items", () => {
    const withUnavailable = [
      ...items,
      {
        name: "Seasonal Salad",
        section: "appetizers",
        dietary: [],
        customTags: [],
        available: false,
        order: 2,
      },
    ];
    const ld = buildMenuSectionJsonLd(section, withUnavailable);
    const menuItems = ld.hasMenuItem as Record<string, unknown>[];
    expect(menuItems).toHaveLength(2);
  });

  it("omits hasMenuItem when no available items", () => {
    const unavailable = items.map((i) => ({ ...i, available: false }));
    const ld = buildMenuSectionJsonLd(section, unavailable);
    expect(ld.hasMenuItem).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateMenuJsonLd
// ---------------------------------------------------------------------------

describe("generateMenuJsonLd", () => {
  const menu: MenuData = {
    name: "Dinner",
    description: "Available 5pm–10pm",
    order: 0,
  };

  const sections: MenuSectionData[] = [
    { name: "Entrees", order: 1 },
    { name: "Appetizers", order: 0 },
  ];

  const items: MenuItemData[] = [
    {
      name: "Steak",
      section: "entrees",
      price: "$28",
      dietary: [],
      customTags: [],
      available: true,
      order: 0,
    },
    {
      name: "Bruschetta",
      section: "appetizers",
      price: "$8",
      dietary: ["vegetarian"],
      customTags: [],
      available: true,
      order: 0,
    },
  ];

  it("includes @context and @type Menu", () => {
    const ld = generateMenuJsonLd(menu, sections, items);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Menu");
  });

  it("includes menu name", () => {
    const ld = generateMenuJsonLd(menu, sections, items);
    expect(ld.name).toBe("Dinner");
  });

  it("includes menu description", () => {
    const ld = generateMenuJsonLd(menu, sections, items);
    expect(ld.description).toBe("Available 5pm–10pm");
  });

  it("omits description when not set", () => {
    const noDesc = { ...menu, description: undefined };
    const ld = generateMenuJsonLd(noDesc, sections, items);
    expect(ld.description).toBeUndefined();
  });

  it("includes hasMenuSection sorted by order", () => {
    const ld = generateMenuJsonLd(menu, sections, items);
    const secs = ld.hasMenuSection as Record<string, unknown>[];
    expect(secs).toHaveLength(2);
    expect(secs[0].name).toBe("Appetizers"); // order 0
    expect(secs[1].name).toBe("Entrees"); // order 1
  });

  it("nests items under their section", () => {
    const ld = generateMenuJsonLd(menu, sections, items);
    const secs = ld.hasMenuSection as Record<string, unknown>[];
    const appetizers = secs[0];
    const entrees = secs[1];
    const appItems = appetizers.hasMenuItem as Record<string, unknown>[];
    const entItems = entrees.hasMenuItem as Record<string, unknown>[];
    expect(appItems).toHaveLength(1);
    expect(appItems[0].name).toBe("Bruschetta");
    expect(entItems).toHaveLength(1);
    expect(entItems[0].name).toBe("Steak");
  });

  it("omits hasMenuSection when no sections", () => {
    const ld = generateMenuJsonLd(menu, [], items);
    expect(ld.hasMenuSection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateMenuPageJsonLd
// ---------------------------------------------------------------------------

describe("generateMenuPageJsonLd", () => {
  const menus = [
    { id: "dinner", data: { name: "Dinner", order: 1 } as MenuData },
    { id: "lunch", data: { name: "Lunch", order: 0 } as MenuData },
  ];

  const sections = [
    {
      id: "salads",
      data: { name: "Salads", menu: "lunch", order: 0 } as MenuSectionData,
    },
    {
      id: "mains",
      data: { name: "Mains", menu: "dinner", order: 0 } as MenuSectionData,
    },
  ];

  const items = [
    {
      id: "caesar",
      data: {
        name: "Caesar Salad",
        section: "salads",
        price: "$10",
        dietary: ["vegetarian"],
        customTags: [],
        available: true,
        order: 0,
      } as MenuItemData,
    },
  ];

  it("wraps multiple menus in @graph", () => {
    const ld = generateMenuPageJsonLd(menus, sections, items);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@graph"]).toBeInstanceOf(Array);
  });

  it("sorts menus by order", () => {
    const ld = generateMenuPageJsonLd(menus, sections, items);
    const graph = ld["@graph"] as Record<string, unknown>[];
    expect(graph[0].name).toBe("Lunch"); // order 0
    expect(graph[1].name).toBe("Dinner"); // order 1
  });

  it("does not include @context on individual menus", () => {
    const ld = generateMenuPageJsonLd(menus, sections, items);
    const graph = ld["@graph"] as Record<string, unknown>[];
    expect(graph[0]["@context"]).toBeUndefined();
  });

  it("associates sections with correct menu", () => {
    const ld = generateMenuPageJsonLd(menus, sections, items);
    const graph = ld["@graph"] as Record<string, unknown>[];
    const lunch = graph[0];
    const lunchSections = lunch.hasMenuSection as Record<string, unknown>[];
    expect(lunchSections).toHaveLength(1);
    expect(lunchSections[0].name).toBe("Salads");
  });
});

// ---------------------------------------------------------------------------
// Template file existence and structure
// ---------------------------------------------------------------------------

describe("menu page template", () => {
  const menuPagePath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "menu.astro",
  );

  it("exists", () => {
    expect(existsSync(menuPagePath)).toBe(true);
  });

  it("uses BaseLayout", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("BaseLayout");
  });

  it("fetches all three menu collections", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain('"menus"');
    expect(html).toContain('"menuSections"');
    expect(html).toContain('"menuItems"');
  });

  it("includes JSON-LD structured data", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("jsonLd");
  });

  it("uses semantic section elements", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("<section");
  });

  it("uses article elements for menu items", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("<article");
  });

  it("includes dietary aria-labels", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("aria-label");
  });

  it("includes skip/jump navigation for sections", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("menu-nav");
  });

  it("imports menu.css", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("menu.css");
  });
});

describe("individual menu page template", () => {
  const slugPagePath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "menu",
    "[slug].astro",
  );

  it("exists", () => {
    expect(existsSync(slugPagePath)).toBe(true);
  });

  it("uses BaseLayout", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("BaseLayout");
  });

  it("exports getStaticPaths", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("getStaticPaths");
  });

  it("includes JSON-LD structured data", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("jsonLd");
  });

  it("imports menu.css", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("menu.css");
  });
});

// ---------------------------------------------------------------------------
// SVG dietary icons
// ---------------------------------------------------------------------------

describe("dietary SVG icons", () => {
  const iconsDir = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "public",
    "images",
    "dietary",
  );

  const expectedIcons = [
    "vegetarian",
    "vegan",
    "gluten-free",
    "dairy-free",
    "nut-free",
    "halal",
    "kosher",
    "spicy",
    "raw",
    "contains-alcohol",
  ];

  for (const icon of expectedIcons) {
    it(`${icon}.svg exists`, () => {
      expect(existsSync(resolve(iconsDir, `${icon}.svg`))).toBe(true);
    });
  }

  for (const icon of expectedIcons) {
    it(`${icon}.svg uses currentColor for theme inheritance`, () => {
      const svg = readFileSync(resolve(iconsDir, `${icon}.svg`), "utf-8");
      expect(svg).toContain("currentColor");
    });
  }

  for (const icon of expectedIcons) {
    it(`${icon}.svg is under 1KB`, () => {
      const stat = readFileSync(resolve(iconsDir, `${icon}.svg`));
      expect(stat.byteLength).toBeLessThan(1024);
    });
  }

  for (const icon of expectedIcons) {
    it(`${icon}.svg has aria-label and role="img"`, () => {
      const svg = readFileSync(resolve(iconsDir, `${icon}.svg`), "utf-8");
      expect(svg).toContain('role="img"');
      expect(svg).toContain("aria-label");
    });
  }
});

// ---------------------------------------------------------------------------
// Allergen disclaimer on menu pages
// ---------------------------------------------------------------------------

describe("allergen disclaimer", () => {
  const menuPagePath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "menu.astro",
  );
  const slugPagePath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "menu",
    "[slug].astro",
  );

  it("menu.astro includes allergen disclaimer text", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("allergen");
    expect(html).toContain("inform your server");
  });

  it("[slug].astro includes allergen disclaimer text", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("allergen");
    expect(html).toContain("inform your server");
  });

  it("menu.astro disclaimer has the allergen-disclaimer class", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("allergen-disclaimer");
  });

  it("[slug].astro disclaimer has the allergen-disclaimer class", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("allergen-disclaimer");
  });
});

// ---------------------------------------------------------------------------
// Dietary icon references in menu pages
// ---------------------------------------------------------------------------

describe("dietary icon rendering in menu pages", () => {
  const menuPagePath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "menu.astro",
  );
  const slugPagePath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "pages",
    "menu",
    "[slug].astro",
  );

  it("menu.astro references dietary icon path", () => {
    const html = readFileSync(menuPagePath, "utf-8");
    expect(html).toContain("/images/dietary/");
  });

  it("[slug].astro references dietary icon path", () => {
    const html = readFileSync(slugPagePath, "utf-8");
    expect(html).toContain("/images/dietary/");
  });
});

describe("menu.css", () => {
  const cssPath = resolve(
    import.meta.dirname!,
    "..",
    "template",
    "src",
    "styles",
    "menu.css",
  );

  it("exists", () => {
    expect(existsSync(cssPath)).toBe(true);
  });

  it("defines menu custom properties", () => {
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("--menu-");
  });

  it("includes responsive breakpoints", () => {
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("@media");
  });

  it("includes print styles", () => {
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("@media print");
  });

  it("styles dietary badges", () => {
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("dietary");
  });

  const allDietaryTags = [
    "vegetarian",
    "vegan",
    "gluten-free",
    "dairy-free",
    "nut-free",
    "halal",
    "kosher",
    "spicy",
    "raw",
    "contains-alcohol",
  ];

  for (const tag of allDietaryTags) {
    it(`has color variant for data-diet="${tag}"`, () => {
      const css = readFileSync(cssPath, "utf-8");
      expect(css).toContain(`[data-diet="${tag}"]`);
    });
  }

  it("styles allergen-disclaimer", () => {
    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("allergen-disclaimer");
  });
});
