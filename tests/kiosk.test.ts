import { describe, it, expect } from "vitest";
import {
  buildKioskUrl,
  buildKioskManifest,
  groupItemsBySection,
  filterByDietary,
  buildSectionNav,
  type KioskUrlOptions,
  type KioskManifestConfig,
  type MenuItem,
  type MenuSection,
} from "../template/scripts/kiosk.js";

// ---------------------------------------------------------------------------
// buildKioskUrl — QR/NFC-friendly kiosk URLs with UTM params
// ---------------------------------------------------------------------------

describe("buildKioskUrl", () => {
  it("returns the base kiosk path with no options", () => {
    expect(buildKioskUrl("/menu/kiosk")).toBe(
      "/menu/kiosk?utm_source=qr&utm_medium=table-card",
    );
  });

  it("appends table number as utm_content", () => {
    const url = buildKioskUrl("/menu/kiosk", { table: 12 });
    expect(url).toContain("utm_content=table-12");
  });

  it("appends custom campaign", () => {
    const url = buildKioskUrl("/menu/kiosk", { campaign: "summer-menu" });
    expect(url).toContain("utm_campaign=summer-menu");
  });

  it("includes all params together", () => {
    const url = buildKioskUrl("/menu/kiosk", {
      table: 5,
      campaign: "lunch-special",
    });
    expect(url).toContain("utm_source=qr");
    expect(url).toContain("utm_medium=table-card");
    expect(url).toContain("utm_content=table-5");
    expect(url).toContain("utm_campaign=lunch-special");
  });

  it("omits utm_content when no table is specified", () => {
    const url = buildKioskUrl("/menu/kiosk");
    expect(url).not.toContain("utm_content");
  });

  it("omits utm_campaign when no campaign is specified", () => {
    const url = buildKioskUrl("/menu/kiosk");
    expect(url).not.toContain("utm_campaign");
  });

  it("allows custom source override", () => {
    const url = buildKioskUrl("/menu/kiosk", { source: "nfc" });
    expect(url).toContain("utm_source=nfc");
    expect(url).not.toContain("utm_source=qr");
  });

  it("allows custom medium override", () => {
    const url = buildKioskUrl("/menu/kiosk", { medium: "nfc-tag" });
    expect(url).toContain("utm_medium=nfc-tag");
    expect(url).not.toContain("utm_medium=table-card");
  });
});

// ---------------------------------------------------------------------------
// buildKioskManifest — PWA manifest for "Add to Home Screen"
// ---------------------------------------------------------------------------

describe("buildKioskManifest", () => {
  const baseConfig: KioskManifestConfig = {
    name: "Joe's Diner",
    themeColor: "#1a1a2e",
  };

  it("returns valid manifest JSON structure", () => {
    const manifest = buildKioskManifest(baseConfig);
    expect(manifest.name).toBe("Joe's Diner");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/menu/kiosk");
  });

  it("uses theme color for both theme_color and background_color", () => {
    const manifest = buildKioskManifest(baseConfig);
    expect(manifest.theme_color).toBe("#1a1a2e");
    expect(manifest.background_color).toBe("#1a1a2e");
  });

  it("generates short_name from name (truncated to 12 chars)", () => {
    const manifest = buildKioskManifest({
      name: "The Very Long Restaurant Name",
      themeColor: "#000",
    });
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it("uses provided shortName when given", () => {
    const manifest = buildKioskManifest({
      ...baseConfig,
      shortName: "Joe's",
    });
    expect(manifest.short_name).toBe("Joe's");
  });

  it("includes icon when iconPath is provided", () => {
    const manifest = buildKioskManifest({
      ...baseConfig,
      iconPath: "/apple-touch-icon.png",
    });
    expect(manifest.icons).toHaveLength(1);
    expect(manifest.icons[0].src).toBe("/apple-touch-icon.png");
  });

  it("defaults to empty icons array when no iconPath", () => {
    const manifest = buildKioskManifest(baseConfig);
    expect(manifest.icons).toEqual([]);
  });

  it("allows custom start_url", () => {
    const manifest = buildKioskManifest({
      ...baseConfig,
      startUrl: "/menu/kiosk?menu=dinner",
    });
    expect(manifest.start_url).toBe("/menu/kiosk?menu=dinner");
  });
});

// ---------------------------------------------------------------------------
// groupItemsBySection — organize menu items into their sections
// ---------------------------------------------------------------------------

describe("groupItemsBySection", () => {
  const sections: MenuSection[] = [
    { slug: "appetizers", name: "Appetizers", order: 0 },
    { slug: "entrees", name: "Entrées", order: 1 },
    { slug: "desserts", name: "Desserts", order: 2 },
  ];

  const items: MenuItem[] = [
    { slug: "bruschetta", name: "Bruschetta", section: "appetizers", price: "$8", dietary: [], available: true, order: 0 },
    { slug: "tiramisu", name: "Tiramisu", section: "desserts", price: "$10", dietary: [], available: true, order: 0 },
    { slug: "pasta", name: "Pasta Primavera", section: "entrees", price: "$16", dietary: ["vegetarian"], available: true, order: 0 },
    { slug: "salad", name: "Caesar Salad", section: "appetizers", price: "$10", dietary: ["vegetarian"], available: true, order: 1 },
  ];

  it("groups items by their section slug", () => {
    const groups = groupItemsBySection(items, sections);
    expect(groups).toHaveLength(3);
    expect(groups[0].section.slug).toBe("appetizers");
    expect(groups[0].items).toHaveLength(2);
  });

  it("sorts sections by order", () => {
    const groups = groupItemsBySection(items, sections);
    expect(groups[0].section.name).toBe("Appetizers");
    expect(groups[1].section.name).toBe("Entrées");
    expect(groups[2].section.name).toBe("Desserts");
  });

  it("sorts items within sections by order", () => {
    const groups = groupItemsBySection(items, sections);
    const appetizers = groups[0].items;
    expect(appetizers[0].name).toBe("Bruschetta");
    expect(appetizers[1].name).toBe("Caesar Salad");
  });

  it("excludes unavailable items", () => {
    const itemsWithUnavailable = [
      ...items,
      { slug: "soup", name: "Seasonal Soup", section: "appetizers", price: "$7", dietary: [], available: false, order: 2 },
    ];
    const groups = groupItemsBySection(itemsWithUnavailable, sections);
    const appetizers = groups[0].items;
    expect(appetizers).toHaveLength(2);
    expect(appetizers.every((i) => i.name !== "Seasonal Soup")).toBe(true);
  });

  it("omits sections with no available items", () => {
    const onlyAppetizers = items.filter((i) => i.section === "appetizers");
    const groups = groupItemsBySection(onlyAppetizers, sections);
    expect(groups).toHaveLength(1);
    expect(groups[0].section.slug).toBe("appetizers");
  });

  it("handles empty items array", () => {
    const groups = groupItemsBySection([], sections);
    expect(groups).toEqual([]);
  });

  it("handles empty sections array", () => {
    const groups = groupItemsBySection(items, []);
    expect(groups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterByDietary — filter menu items by dietary tags
// ---------------------------------------------------------------------------

describe("filterByDietary", () => {
  const items: MenuItem[] = [
    { slug: "burger", name: "Burger", section: "entrees", price: "$14", dietary: [], available: true, order: 0 },
    { slug: "salad", name: "Garden Salad", section: "appetizers", price: "$9", dietary: ["vegetarian", "gluten-free"], available: true, order: 0 },
    { slug: "pasta", name: "GF Pasta", section: "entrees", price: "$15", dietary: ["gluten-free"], available: true, order: 1 },
    { slug: "cake", name: "Chocolate Cake", section: "desserts", price: "$8", dietary: ["vegetarian"], available: true, order: 0 },
  ];

  it("returns all items when no filters", () => {
    expect(filterByDietary(items, [])).toHaveLength(4);
  });

  it("filters by a single dietary tag", () => {
    const result = filterByDietary(items, ["gluten-free"]);
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.dietary.includes("gluten-free"))).toBe(true);
  });

  it("filters by multiple tags (intersection — item must match ALL)", () => {
    const result = filterByDietary(items, ["vegetarian", "gluten-free"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Garden Salad");
  });

  it("returns empty array when no items match", () => {
    expect(filterByDietary(items, ["vegan"])).toEqual([]);
  });

  it("is case-insensitive", () => {
    const result = filterByDietary(items, ["Gluten-Free"]);
    expect(result).toHaveLength(2);
  });

  it("handles items with empty dietary arrays", () => {
    const result = filterByDietary(items, ["vegetarian"]);
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.dietary.includes("vegetarian"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSectionNav — generate navigation tab data
// ---------------------------------------------------------------------------

describe("buildSectionNav", () => {
  const sections: MenuSection[] = [
    { slug: "appetizers", name: "Appetizers", order: 0 },
    { slug: "entrees", name: "Entrées", order: 1 },
    { slug: "desserts", name: "Desserts", order: 2 },
  ];

  it("returns tab objects with id, label, and href", () => {
    const tabs = buildSectionNav(sections);
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toEqual({
      id: "appetizers",
      label: "Appetizers",
      href: "#appetizers",
    });
  });

  it("sorts tabs by section order", () => {
    const reversed = [...sections].reverse();
    const tabs = buildSectionNav(reversed);
    expect(tabs[0].id).toBe("appetizers");
    expect(tabs[1].id).toBe("entrees");
    expect(tabs[2].id).toBe("desserts");
  });

  it("returns empty array for empty sections", () => {
    expect(buildSectionNav([])).toEqual([]);
  });
});
