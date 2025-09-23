/**
 * @file Application constants
 * @description Centralized constants for the Anglesite application to reduce
 * magic strings and improve maintainability across the codebase.
 */

/**
 * File paths and configuration constants
 */
export const PATHS = {
  /** Standard path to website configuration data */
  WEBSITE_DATA: 'src/_data/website.json',
} as const;

/**
 * Internationalization and localization constants
 */
export const I18N = {
  /** Default language code for new websites and fallback scenarios */
  DEFAULT_LANGUAGE: 'en',
  /** Default language examples for UI and schemas */
  LANGUAGE_EXAMPLES: ['en', 'en-US', 'fr', 'de', 'es'],
} as const;

/**
 * Component names for error reporting and debugging
 */
export const COMPONENT_NAMES = {
  /** Main application component */
  MAIN: 'Main',
  /** Sidebar navigation component */
  SIDEBAR: 'Sidebar',
  /** Website configuration editor */
  WEBSITE_CONFIG_EDITOR: 'WebsiteConfigEditor',
  /** File explorer component */
  FILE_EXPLORER: 'FileExplorer',
} as const;

/**
 * Re-export all constants for convenience
 */
export const CONSTANTS = {
  PATHS,
  I18N,
  COMPONENT_NAMES,
} as const;
