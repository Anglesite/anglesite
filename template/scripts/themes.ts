/**
 * Pre-built visual themes for the design interview.
 *
 * Each theme is a complete set of CSS custom property values.
 * Used by the themes skill and the design-interview skill.
 */

export interface Theme {
  displayName: string;
  description: string;
  bestFor: string[];
  vars: Record<string, string>;
}

export const THEMES: Record<string, Theme> = {
  classic: {
    displayName: "Classic",
    description: "Traditional, trustworthy, professional",
    bestFor: ["legal", "finance", "insurance", "accounting", "real-estate"],
    vars: {
      "color-primary": "#1e3a5f",
      "color-accent": "#c8a951",
      "color-bg": "#ffffff",
      "color-text": "#1a1a1a",
      "color-muted": "#6b6b6b",
      "color-surface": "#f5f5f0",
      "color-border": "#d4d4c8",
      "font-heading": "Georgia, 'Times New Roman', serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  fresh: {
    displayName: "Fresh",
    description: "Clean, modern, health-conscious",
    bestFor: ["healthcare", "wellness", "grocery", "pharmacy", "cleaning"],
    vars: {
      "color-primary": "#16a34a",
      "color-accent": "#0ea5e9",
      "color-bg": "#ffffff",
      "color-text": "#1a1a1a",
      "color-muted": "#6b7280",
      "color-surface": "#f0fdf4",
      "color-border": "#d1fae5",
      "font-heading": "system-ui, -apple-system, sans-serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  warm: {
    displayName: "Warm",
    description: "Welcoming, cozy, inviting",
    bestFor: ["restaurant", "bakery", "brewery", "hospitality", "campground"],
    vars: {
      "color-primary": "#b45309",
      "color-accent": "#dc2626",
      "color-bg": "#fffbf5",
      "color-text": "#292524",
      "color-muted": "#78716c",
      "color-surface": "#fef3c7",
      "color-border": "#e7e0d5",
      "font-heading": "Georgia, 'Times New Roman', serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  bold: {
    displayName: "Bold",
    description: "Energetic, confident, strong",
    bestFor: ["fitness", "trades", "auto-dealer", "car-wash", "equipment-rental"],
    vars: {
      "color-primary": "#2563eb",
      "color-accent": "#f59e0b",
      "color-bg": "#0f172a",
      "color-text": "#f1f5f9",
      "color-muted": "#94a3b8",
      "color-surface": "#1e293b",
      "color-border": "#334155",
      "font-heading": "system-ui, -apple-system, sans-serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  earthy: {
    displayName: "Earthy",
    description: "Natural, grounded, organic",
    bestFor: ["farm", "florist", "hardware", "campground", "veterinarian"],
    vars: {
      "color-primary": "#65793e",
      "color-accent": "#92400e",
      "color-bg": "#fefdf8",
      "color-text": "#292524",
      "color-muted": "#78716c",
      "color-surface": "#f5f0e8",
      "color-border": "#d6cfc2",
      "font-heading": "Georgia, 'Times New Roman', serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  playful: {
    displayName: "Playful",
    description: "Fun, approachable, creative",
    bestFor: ["childcare", "pet-services", "dance-studio", "youth-org", "entertainment"],
    vars: {
      "color-primary": "#7c3aed",
      "color-accent": "#f43f5e",
      "color-bg": "#ffffff",
      "color-text": "#1e1b4b",
      "color-muted": "#6b7280",
      "color-surface": "#faf5ff",
      "color-border": "#e9d5ff",
      "font-heading": "system-ui, -apple-system, sans-serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  elegant: {
    displayName: "Elegant",
    description: "Refined, upscale, sophisticated",
    bestFor: ["salon", "photography", "jewelry", "community-theater", "hotel"],
    vars: {
      "color-primary": "#374151",
      "color-accent": "#be185d",
      "color-bg": "#ffffff",
      "color-text": "#111827",
      "color-muted": "#6b7280",
      "color-surface": "#fdf2f8",
      "color-border": "#e5e7eb",
      "font-heading": "Georgia, 'Times New Roman', serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
  community: {
    displayName: "Community",
    description: "Open, inclusive, welcoming",
    bestFor: ["nonprofit", "house-of-worship", "social-services", "food-bank", "animal-shelter"],
    vars: {
      "color-primary": "#0d9488",
      "color-accent": "#ea580c",
      "color-bg": "#ffffff",
      "color-text": "#1a1a1a",
      "color-muted": "#6b7280",
      "color-surface": "#f0fdfa",
      "color-border": "#ccfbf1",
      "font-heading": "system-ui, -apple-system, sans-serif",
      "font-body": "system-ui, -apple-system, sans-serif",
    },
  },
};

/**
 * List all available theme names.
 */
export function themeNames(): string[] {
  return Object.keys(THEMES);
}

/**
 * Business type to recommended theme mapping.
 */
const BUSINESS_TYPE_MAP: Record<string, string> = {
  // Classic
  accounting: "classic",
  insurance: "classic",
  "credit-union": "classic",
  "real-estate": "classic",
  // Fresh
  healthcare: "fresh",
  pharmacy: "fresh",
  cleaning: "fresh",
  grocery: "fresh",
  // Warm
  restaurant: "warm",
  bakery: "warm",
  brewery: "warm",
  hospitality: "warm",
  campground: "warm",
  // Bold
  fitness: "bold",
  trades: "bold",
  "auto-dealer": "bold",
  "car-wash": "bold",
  "equipment-rental": "bold",
  plumber: "bold",
  electrician: "bold",
  // Earthy
  farm: "earthy",
  florist: "earthy",
  hardware: "earthy",
  veterinarian: "earthy",
  // Playful
  childcare: "playful",
  "pet-services": "playful",
  "dance-studio": "playful",
  "youth-org": "playful",
  entertainment: "playful",
  // Elegant
  salon: "elegant",
  photography: "elegant",
  jewelry: "elegant",
  "community-theater": "elegant",
  hotel: "elegant",
  // Community
  nonprofit: "community",
  "house-of-worship": "community",
  "social-services": "community",
  "food-bank": "community",
  "animal-shelter": "community",
};

/**
 * Get the recommended theme for a business type.
 */
export function themeForBusinessType(businessType: string): string {
  if (!businessType) return "classic";
  const type = businessType.toLowerCase().split(",")[0].trim();
  return BUSINESS_TYPE_MAP[type] || "classic";
}

/**
 * Generate CSS custom property declarations from a theme.
 */
export function themeToCss(theme: Theme): string {
  return Object.entries(theme.vars)
    .map(([prop, value]) => `  --${prop}: ${value};`)
    .join("\n");
}
