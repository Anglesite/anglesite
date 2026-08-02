// Theme DATA lives in themes.json — the single shared source of truth. The app's
// AnglesiteCore/ThemeCatalog decodes the same file, so edits there flow to both sides.
// This module just re-exposes it with the historical typed `THEMES` record shape.
import themesData from "./themes.json";

export interface ThemeCredit {
  name: string;
  url: string;
  license: string;
}

export type ThemeCategory = "business" | "personal" | "blog" | "portfolio" | "organization";

export interface Theme {
  displayName: string;
  description: string;
  bestFor: string[];
  vars: Record<string, string>;
  /** Chooser category; absent = Blank (base chassis). Pack entries must set one. */
  category?: ThemeCategory;
  /** Pack directory name under packs/; absent = plain CSS-var theme. */
  pack?: string;
  /** Template-root-relative path to the committed thumbnail (pack entries only). */
  thumbnail?: string;
  /** Original-theme attribution (pack entries only). */
  credit?: ThemeCredit;
}

export type ThemeRecord = Theme & { id: string };

/** The catalog in JSON order (order is load-bearing: first entry = fallback default). */
export const THEME_RECORDS: ThemeRecord[] = themesData;

export const THEMES: Record<string, Theme> = Object.fromEntries(
  THEME_RECORDS.map(({ id, ...theme }) => [id, theme]),
);
