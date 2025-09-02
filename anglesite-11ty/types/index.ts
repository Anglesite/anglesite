/**
 * @file Central export for anglesite-11ty type definitions
 * @module index
 * @description Centralized exports for all types used in the anglesite-11ty package,
 * providing a single import point for TypeScript type definitions.
 */
export * from './website.js';
export * from './context.js';
export * from './config.js';
export * from './page-data.js';

/**
 * @interface WebCOptions
 * @description Configuration options for the WebC plugin
 */
export interface WebCOptions {
  /** Paths to component directories or files */
  components?: string[];
  /** Path(s) to layout templates */
  layouts?: string | string[];
  /** Enable bundler mode for CSS and JavaScript */
  bundlerMode?: boolean;
}
