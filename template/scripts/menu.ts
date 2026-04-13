/**
 * Menu page utilities — Schema.org JSON-LD generation for Menu,
 * MenuSection, and MenuItem structured data.
 *
 * Used by the menu page templates and tested in tests/menu.test.ts.
 */

/** Minimal menu item shape matching the content collection schema. */
export interface MenuItemData {
  name: string;
  section?: string;
  description?: string;
  price?: string;
  image?: string;
  imageAlt?: string;
  dietary: string[];
  customTags: { label: string; icon?: string; color?: string }[];
  available: boolean;
  order: number;
}

/** Minimal menu section shape matching the content collection schema. */
export interface MenuSectionData {
  name: string;
  menu?: string;
  description?: string;
  order: number;
}

/** How multiple menus are displayed on the site. */
export type MenuLayout = "scroll" | "tabs" | "pages";

/**
 * Menu type — affects styling hints and semantic context.
 * - `standard` — default restaurant menu
 * - `daily-specials` — highlighted, potentially auto-dated
 * - `seasonal` — can be toggled on/off via `available`
 * - `kids` — simpler layout, larger text
 * - `catering` — may include package deals, minimum orders
 * - `wine-cocktails` — organized by varietal/spirit, tasting notes
 */
export type MenuType =
  | "standard"
  | "daily-specials"
  | "seasonal"
  | "kids"
  | "catering"
  | "wine-cocktails";

/** Minimal menu shape matching the content collection schema. */
export interface MenuData {
  name: string;
  description?: string;
  order: number;
  /** Layout preference — if unset, inferred from menu count. */
  layout?: MenuLayout;
  /** Menu type — affects styling and semantic hints. */
  menuType?: MenuType;
}

/**
 * Map from lowercase dietary tag strings to Schema.org RestrictedDiet values.
 * @see https://schema.org/RestrictedDiet
 */
const DIETARY_MAP: Record<string, string> = {
  vegetarian: "https://schema.org/VegetarianDiet",
  vegan: "https://schema.org/VeganDiet",
  "gluten-free": "https://schema.org/GlutenFreeDiet",
  "dairy-free": "https://schema.org/DairyFree",
  halal: "https://schema.org/HalalDiet",
  kosher: "https://schema.org/KosherDiet",
  "low-calorie": "https://schema.org/LowCalorieDiet",
  "low-fat": "https://schema.org/LowFatDiet",
  "low-lactose": "https://schema.org/LowLactoseDiet",
  "low-salt": "https://schema.org/LowSaltDiet",
  diabetic: "https://schema.org/DiabeticDiet",
};

/**
 * Map a dietary tag string to its Schema.org RestrictedDiet URL.
 * Returns undefined for unrecognized tags (e.g. "spicy", "raw").
 */
export function mapDietaryTag(tag: string): string | undefined {
  return DIETARY_MAP[tag.toLowerCase()];
}

/**
 * Build a Schema.org MenuItem object for a single menu item.
 * Omits `offers` when no price is set. Omits `suitableForDiet`
 * when no recognized dietary tags are present.
 */
export function buildMenuItemJsonLd(
  item: MenuItemData,
  siteUrl?: string,
): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@type": "MenuItem",
    name: item.name,
  };

  if (item.description) {
    ld.description = item.description;
  }

  if (item.price) {
    ld.offers = {
      "@type": "Offer",
      price: item.price,
    };
  }

  if (item.image && siteUrl) {
    ld.image = new URL(item.image, siteUrl).toString();
  }

  const diets = item.dietary
    .map(mapDietaryTag)
    .filter((d): d is string => d !== undefined);

  if (diets.length > 0) {
    ld.suitableForDiet = diets;
  }

  return ld;
}

/**
 * Build a Schema.org MenuSection object with nested MenuItems.
 */
export function buildMenuSectionJsonLd(
  section: MenuSectionData,
  items: MenuItemData[],
  siteUrl?: string,
): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@type": "MenuSection",
    name: section.name,
  };

  if (section.description) {
    ld.description = section.description;
  }

  const available = items
    .filter((i) => i.available)
    .sort((a, b) => a.order - b.order);

  if (available.length > 0) {
    ld.hasMenuItem = available.map((i) => buildMenuItemJsonLd(i, siteUrl));
  }

  return ld;
}

/**
 * Generate the full Schema.org Menu JSON-LD for a single menu,
 * including all its sections and items.
 */
export function generateMenuJsonLd(
  menu: MenuData,
  sections: MenuSectionData[],
  items: MenuItemData[],
  siteUrl?: string,
): Record<string, unknown> {
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  const hasMenuSection = sorted.map((sec) => {
    const sectionItems = items.filter((i) => i.section === slugify(sec.name));
    return buildMenuSectionJsonLd(sec, sectionItems, siteUrl);
  });

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Menu",
    name: menu.name,
  };

  if (menu.description) {
    ld.description = menu.description;
  }

  if (hasMenuSection.length > 0) {
    ld.hasMenuSection = hasMenuSection;
  }

  return ld;
}

/**
 * Generate JSON-LD for the menu index page when multiple menus exist.
 * Returns an array of Menu objects wrapped in a @graph.
 */
export function generateMenuPageJsonLd(
  menus: { data: MenuData; id: string }[],
  sections: { data: MenuSectionData; id: string }[],
  items: { data: MenuItemData; id: string }[],
  siteUrl?: string,
): Record<string, unknown> {
  const sorted = [...menus].sort((a, b) => a.data.order - b.data.order);

  const menuObjects = sorted.map((m) => {
    const menuSections = sections
      .filter((s) => s.data.menu === m.id)
      .map((s) => s.data);
    const allItems = items.map((i) => i.data);
    const ld = generateMenuJsonLd(m.data, menuSections, allItems, siteUrl);
    // Remove @context from individual entries — it goes on the wrapper
    delete ld["@context"];
    return ld;
  });

  return {
    "@context": "https://schema.org",
    "@graph": menuObjects,
  };
}

/**
 * Infer the best menu layout based on the number of menus.
 * - 0–1 menus → scroll (everything on one page)
 * - 2–4 menus → tabs (tabbed navigation on one page)
 * - 5+ menus → pages (separate page per menu with index)
 */
export function inferMenuLayout(menuCount: number): MenuLayout {
  if (menuCount <= 1) return "scroll";
  if (menuCount <= 4) return "tabs";
  return "pages";
}

/**
 * Generate Schema.org JSON-LD wrapping menus in a Restaurant entity.
 * Uses `hasMenu` (array) per https://schema.org/Restaurant.
 */
export function generateRestaurantMenusJsonLd(
  restaurantName: string,
  menus: { data: MenuData; id: string }[],
  sections: { data: MenuSectionData; id: string }[],
  items: { data: MenuItemData; id: string }[],
  siteUrl?: string,
): Record<string, unknown> {
  const sorted = [...menus].sort((a, b) => a.data.order - b.data.order);

  const menuObjects = sorted.map((m) => {
    const menuSections = sections
      .filter((s) => s.data.menu === m.id)
      .map((s) => s.data);
    const allItems = items.map((i) => i.data);
    const ld = generateMenuJsonLd(m.data, menuSections, allItems, siteUrl);
    delete ld["@context"];
    return ld;
  });

  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurantName,
    hasMenu: menuObjects,
  };
}

/** Simple slug helper matching Keystatic's default slug behavior. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
