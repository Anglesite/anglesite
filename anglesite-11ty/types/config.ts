/**
 * @file Eleventy configuration type definitions
 * @module config
 * @description Type definitions for the Eleventy configuration API,
 * defining the methods available on the eleventyConfig parameter passed
 * to plugins and configuration functions.
 */
/**
 * @interface EleventyConfig
 * @description Configuration object passed to Eleventy plugins and configuration functions,
 * providing methods to customize the build process
 */
export interface EleventyConfig {
  /**
   * @function addJavaScriptFunction
   * @description Register a JavaScript function that can be called from templates
   * @param {string} name - Name of the function as it will be used in templates
   * @param {Function} fn - The function implementation
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addJavaScriptFunction(name: string, fn: (...args: any[]) => any): void;
  /**
   * @function addShortcode
   * @description Register a shortcode for use in templates
   * @param {string} name - Name of the shortcode
   * @param {Function} fn - Function that returns the shortcode output
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addShortcode(name: string, fn: (...args: any[]) => any): void;
  /**
   * @function addFilter
   * @description Add a filter for transforming values in templates
   * @param {string} name - Name of the filter
   * @param {Function} fn - Filter function that transforms the input value
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFilter(name: string, fn: (...args: any[]) => any): void;
  /**
   * @function addTransform
   * @description Add a transform to modify output content before writing
   * @param {string} name - Name of the transform
   * @param {Function} fn - Transform function that modifies the content
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addTransform(name: string, fn: (...args: any[]) => any): void;
  /**
   * @function addPlugin
   * @description Add an Eleventy plugin with optional configuration
   * @param {any} plugin - The plugin function or module
   * @param {any} [options] - Optional configuration for the plugin
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addPlugin(plugin: any, options?: any): void;
  /**
   * @function setDataFileBaseName
   * @description Set the base name for data files (without extension)
   * @param {string} name - The base name to use for data files
   */
  setDataFileBaseName(name: string): void;
}

/**
 * @interface PluginReturn
 * @description Standard return value for Eleventy plugins,
 * allowing Eleventy to identify the plugin
 */
export interface PluginReturn {
  /**
   * @property {string} name Unique identifier name for the plugin
   */
  name: string;
}
