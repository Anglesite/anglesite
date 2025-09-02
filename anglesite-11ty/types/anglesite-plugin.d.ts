/**
 * @file Type definitions for the @dwk/anglesite-11ty plugin
 * @module anglesite-plugin
 * @description Provides TypeScript type definitions for the Anglesite 11ty plugin,
 * including Eleventy configuration interfaces, plugin options, and template data structures.
 */

/**
 * @namespace AnglesitePlugin
 * @description Contains all type definitions for the Anglesite 11ty plugin ecosystem
 */
declare namespace AnglesitePlugin {
  /**
   * @interface EleventyConfig
   * @description Configuration object provided by Eleventy to plugins for registering
   * custom functions, shortcodes, filters, and transforms
   */
  interface EleventyConfig {
    /**
     * @function addJavaScriptFunction
     * @description Adds a JavaScript function that can be called from templates
     * @param {string} name - The name of the function to register
     * @param {Function} fn - The function implementation
     */
    addJavaScriptFunction(name: string, fn: (...args: any[]) => any): void;
    /**
     * @function addShortcode
     * @description Registers a shortcode that can be used in templates
     * @param {string} name - The name of the shortcode
     * @param {Function} fn - The shortcode implementation function
     */
    addShortcode(name: string, fn: (...args: any[]) => any): void;
    /**
     * @function addFilter
     * @description Adds a filter that can be applied to template values
     * @param {string} name - The name of the filter
     * @param {Function} fn - The filter function implementation
     */
    addFilter(name: string, fn: (...args: any[]) => any): void;
    /**
     * @function addTransform
     * @description Registers a transform to modify output content
     * @param {string} name - The name of the transform
     * @param {Function} fn - The transform function implementation
     */
    addTransform(name: string, fn: (...args: any[]) => any): void;
  }

  /**
   * @interface PluginOptions
   * @description Configuration options for the Anglesite plugin
   */
  interface PluginOptions {
    /**
     * @property {string} [defaultLanguage] Default language code for the site (e.g., 'en', 'es', 'fr')
     * @default 'en'
     */
    defaultLanguage?: string;
    /**
     * @property {string} [defaultSiteTitle] Default title to use when no site title is specified
     */
    defaultSiteTitle?: string;
  }

  /**
   * @interface PluginReturn
   * @description Return value from the plugin initialization function
   */
  interface PluginReturn {
    /**
     * @property {string} name The name identifier of the plugin
     */
    name: string;
  }

  /**
   * @interface TemplateData
   * @description Data structure available to templates during rendering
   */
  interface TemplateData {
    /**
     * @property {string} [title] Page title for the current template
     */
    title?: string;
    /**
     * @property {string} [lang] Language code for the current page
     */
    lang?: string;
    /**
     * @property {object} [site] Global site configuration data
     */
    site?: {
      /**
       * @property {string} [title] Global site title
       */
      title?: string;
      /**
       * @property {string} [url] Base URL of the site
       */
      url?: string;
      /**
       * @property {string} [lang] Default language for the site
       */
      lang?: string;
    };
    /**
     * @property {object} [page] Current page metadata
     */
    page?: {
      /**
       * @property {string} [url] URL path of the current page
       */
      url?: string;
      /**
       * @property {string} [outputPath] File system path where the page will be written
       */
      outputPath?: string;
    };
  }

  /**
   * @interface ImageMetadata
   * @description Metadata for processed images, including different formats and sizes
   */
  interface ImageMetadata {
    /**
     * @property {Array} jpeg Array of JPEG image variants with different sizes
     */
    jpeg: Array<{
      /**
       * @property {string} url URL path to the image variant
       */
      url: string;
      /**
       * @property {number} width Width of the image variant in pixels
       */
      width: number;
      /**
       * @property {number} height Height of the image variant in pixels
       */
      height: number;
    }>;
  }

  /**
   * @interface SchemaValidationError
   * @description Error details from structured data schema validation
   */
  interface SchemaValidationError {
    /**
     * @property {string} path JSON path to the location of the error
     */
    path: string;
    /**
     * @property {string} message Human-readable error message
     */
    message: string;
    /**
     * @property {number} line Line number where the error occurred
     */
    line: number;
    /**
     * @property {number} column Column number where the error occurred
     */
    column: number;
  }
}

declare module '@11ty/eleventy-img' {
  interface ImageOptions {
    widths?: number[];
    formats?: string[];
    outputDir?: string;
    urlPath?: string;
    filenameFormat?: (id: string, src: string, width: number, format: string) => string;
  }

  function Image(src: string, options: ImageOptions): Promise<AnglesitePlugin.ImageMetadata>;
  export = Image;
}

declare module 'html-minifier-terser' {
  interface MinifyOptions {
    useShortDoctype?: boolean;
    removeComments?: boolean;
    collapseWhitespace?: boolean;
  }

  interface HtmlMinifier {
    minify(content: string, options: MinifyOptions): string;
  }

  const htmlMinifier: HtmlMinifier;
  export = htmlMinifier;
}

declare module 'structured-data-linter' {
  function lint(jsonSchema: string): Promise<AnglesitePlugin.SchemaValidationError[]>;
  export { lint };
}

export {};
