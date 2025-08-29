import { AnglesiteWebsiteConfiguration } from './website.js';

/**
 * @file Eleventy template context type definitions
 * @module context
 * @description Type definitions for the template context object ('this')
 * available in Eleventy template functions, providing access to page,
 * site, and website data.
 */

/**
 * @interface EleventyContext
 * @description The 'this' context object available in Eleventy template functions,
 * containing page metadata, site configuration, and website data
 */
export interface EleventyContext {
  /**
   * @property {string} [lang] Language code for the current page (e.g., 'en', 'es', 'fr')
   */
  lang?: string;
  /**
   * @property {string} [title] Title of the current page
   */
  title?: string;
  /**
   * @property {AnglesiteWebsiteConfiguration} website Website configuration data loaded from website.json
   */
  website: AnglesiteWebsiteConfiguration;
  /**
   * @property {object} [site] Global site configuration object
   */
  site?: {
    /**
     * @property {string} [lang] Default language for the site
     */
    lang?: string;
    /**
     * @property {string} [title] Global site title
     */
    title?: string;
    /**
     * @property {string} [url] Base URL of the site
     */
    url?: string;
  };
  /**
   * @property {object} page Current page metadata
   */
  page: {
    /**
     * @property {string} [outputPath] File system path where the page will be written
     */
    outputPath?: string;
    /**
     * @property {string} [url] URL path of the current page
     */
    url?: string;
  };
}
