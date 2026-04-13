/**
 * Kiosk mode utilities for QR/NFC table-access menus.
 *
 * Pure functions for building kiosk URLs, PWA manifests,
 * menu grouping, dietary filtering, and section navigation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KioskUrlOptions {
  /** Table number for UTM content tracking (e.g., 12 → "table-12"). */
  table?: number;
  /** Campaign name for UTM tracking. */
  campaign?: string;
  /** Override default "qr" source (e.g., "nfc"). */
  source?: string;
  /** Override default "table-card" medium (e.g., "nfc-tag"). */
  medium?: string;
}

export interface KioskManifestConfig {
  /** Restaurant or business name. */
  name: string;
  /** Theme color hex (e.g., "#1a1a2e"). */
  themeColor: string;
  /** Short name for home screen (max 12 chars). Derived from name if omitted. */
  shortName?: string;
  /** Path to the app icon (e.g., "/apple-touch-icon.png"). */
  iconPath?: string;
  /** Custom start URL. Defaults to "/menu/kiosk". */
  startUrl?: string;
}

export interface KioskManifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Array<{ src: string; sizes: string }>;
}

export interface MenuItem {
  slug: string;
  name: string;
  section?: string;
  description?: string;
  price?: string;
  image?: string;
  imageAlt?: string;
  dietary: string[];
  available: boolean;
  order: number;
}

export interface MenuSection {
  slug: string;
  name: string;
  description?: string;
  menu?: string;
  order: number;
}

export interface SectionGroup {
  section: MenuSection;
  items: MenuItem[];
}

export interface SectionTab {
  id: string;
  label: string;
  href: string;
}

// ---------------------------------------------------------------------------
// buildKioskUrl
// ---------------------------------------------------------------------------

/**
 * Build a kiosk URL with QR/NFC UTM tracking parameters.
 *
 * Default UTM: `utm_source=qr&utm_medium=table-card`.
 * Optional table number appends `utm_content=table-{n}`.
 */
export function buildKioskUrl(
  basePath: string,
  options: KioskUrlOptions = {},
): string {
  const params = new URLSearchParams();
  params.set("utm_source", options.source ?? "qr");
  params.set("utm_medium", options.medium ?? "table-card");

  if (options.table !== undefined) {
    params.set("utm_content", `table-${options.table}`);
  }
  if (options.campaign) {
    params.set("utm_campaign", options.campaign);
  }

  return `${basePath}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// buildKioskManifest
// ---------------------------------------------------------------------------

/**
 * Generate a PWA web app manifest object for kiosk "Add to Home Screen".
 */
export function buildKioskManifest(config: KioskManifestConfig): KioskManifest {
  const shortName =
    config.shortName ?? config.name.slice(0, 12).replace(/\s+$/, "");

  const icons: Array<{ src: string; sizes: string }> = [];
  if (config.iconPath) {
    icons.push({ src: config.iconPath, sizes: "180x180" });
  }

  return {
    name: config.name,
    short_name: shortName,
    start_url: config.startUrl ?? "/menu/kiosk",
    display: "standalone",
    theme_color: config.themeColor,
    background_color: config.themeColor,
    icons,
  };
}

// ---------------------------------------------------------------------------
// groupItemsBySection
// ---------------------------------------------------------------------------

/**
 * Group available menu items into their sections, sorted by `order`.
 * Sections with no available items are omitted.
 */
export function groupItemsBySection(
  items: MenuItem[],
  sections: MenuSection[],
): SectionGroup[] {
  if (items.length === 0 || sections.length === 0) return [];

  const available = items.filter((item) => item.available);

  const sortedSections = [...sections].sort((a, b) => a.order - b.order);

  const groups: SectionGroup[] = [];
  for (const section of sortedSections) {
    const sectionItems = available
      .filter((item) => item.section === section.slug)
      .sort((a, b) => a.order - b.order);

    if (sectionItems.length > 0) {
      groups.push({ section, items: sectionItems });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// filterByDietary
// ---------------------------------------------------------------------------

/**
 * Filter menu items to those matching ALL given dietary tags.
 * Case-insensitive comparison. Returns all items when tags is empty.
 */
export function filterByDietary(
  items: MenuItem[],
  tags: string[],
): MenuItem[] {
  if (tags.length === 0) return items;

  const lowerTags = tags.map((t) => t.toLowerCase());

  return items.filter((item) => {
    const itemTags = item.dietary.map((d) => d.toLowerCase());
    return lowerTags.every((tag) => itemTags.includes(tag));
  });
}

// ---------------------------------------------------------------------------
// buildSectionNav
// ---------------------------------------------------------------------------

/**
 * Build navigation tab data from menu sections for the fixed kiosk nav bar.
 */
export function buildSectionNav(sections: MenuSection[]): SectionTab[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.slug,
      label: s.name,
      href: `#${s.slug}`,
    }));
}
