/**
 * @file Anglesite 11ty constants
 * @description Centralized constants for the Anglesite 11ty package to reduce
 * magic strings and improve maintainability.
 */

/**
 * File paths and configuration constants for 11ty builds
 */
export const PATHS = {
  /** Standard path to website configuration data */
  WEBSITE_DATA: './src/_data/website.json',
} as const;

/**
 * Internationalization constants for content generation
 */
export const I18N = {
  /** Default language code for new websites and fallback scenarios */
  DEFAULT_LANGUAGE: 'en',
} as const;

/**
 * Re-export all constants for convenience
 */
export const CONSTANTS = {
  PATHS,
  I18N,
} as const;
