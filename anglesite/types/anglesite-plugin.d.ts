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
     * @param name The name of the function to register
     * @param fn The function implementation
     */
    addJavaScriptFunction(name: string, fn: (...args: unknown[]) => unknown): void;

    /**
     * @function addShortcode
     * @description Registers a shortcode that can be used in templates
     * @param name The name of the shortcode
     * @param fn The shortcode implementation function
     */
    addShortcode(name: string, fn: (...args: unknown[]) => unknown): void;

    /**
     * @function addFilter
     * @description Adds a filter that can be applied to template values
     * @param name The name of the filter
     * @param fn The filter function implementation
     */
    addFilter(name: string, fn: (...args: unknown[]) => unknown): void;

    /**
     * @function addTransform
     * @description Registers a transform to modify output content
     * @param name The name of the transform
     * @param fn The transform function implementation
     */
    addTransform(name: string, fn: (...args: unknown[]) => unknown): void;
  }

  /**
   * @interface PluginOptions
   * @description Configuration options for the Anglesite plugin
   */
  interface PluginOptions {
    /**
     * @property {string} [defaultLanguage]
     * @description Default language code for the site (e.g., 'en', 'es', 'fr')
     * @default 'en'
     */
    defaultLanguage?: string;

    /**
     * @property {string} [defaultSiteTitle]
     * @description Default title to use when no site title is specified
     */
    defaultSiteTitle?: string;
  }

  /**
   * @interface PluginReturn
   * @description Return value from the plugin initialization function
   */
  interface PluginReturn {
    /**
     * @property {string} name
     * @description The name identifier of the plugin
     */
    name: string;
  }

  /**
   * @interface TemplateData
   * @description Data structure available to templates during rendering
   */
  interface TemplateData {
    /**
     * @property {string} [title]
     * @description Page title for the current template
     */
    title?: string;

    /**
     * @property {string} [lang]
     * @description Language code for the current page
     */
    lang?: string;

    /**
     * @property {object} [site]
     * @description Global site configuration data
     */
    site?: {
      /**
       * @property {string} [title]
       * @description Global site title
       */
      title?: string;

      /**
       * @property {string} [url]
       * @description Base URL of the site
       */
      url?: string;

      /**
       * @property {string} [lang]
       * @description Default language for the site
       */
      lang?: string;
    };

    /**
     * @property {object} [page]
     * @description Current page metadata
     */
    page?: {
      /**
       * @property {string} [url]
       * @description URL path of the current page
       */
      url?: string;

      /**
       * @property {string} [outputPath]
       * @description File system path where the page will be written
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
     * @property {Array} jpeg
     * @description Array of JPEG image variants with different sizes
     */
    jpeg: Array<{
      /**
       * @property {string} url
       * @description URL path to the image variant
       */
      url: string;

      /**
       * @property {number} width
       * @description Width of the image variant in pixels
       */
      width: number;

      /**
       * @property {number} height
       * @description Height of the image variant in pixels
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
     * @property {string} path
     * @description JSON path to the location of the error
     */
    path: string;

    /**
     * @property {string} message
     * @description Human-readable error message
     */
    message: string;

    /**
     * @property {number} line
     * @description Line number where the error occurred
     */
    line: number;

    /**
     * @property {number} column
     * @description Column number where the error occurred
     */
    column: number;
  }
}

/**
 * @module @11ty/eleventy-img
 * @description Type definitions for the Eleventy Image plugin used for image optimization
 */
declare module '@11ty/eleventy-img' {
  /**
   * @interface ImageOptions
   * @description Configuration options for image processing
   */
  interface ImageOptions {
    /**
     * @property {number[]} [widths]
     * @description Array of widths to generate for responsive images
     */
    widths?: number[];

    /**
     * @property {string[]} [formats]
     * @description Image formats to generate (e.g., ['jpeg', 'webp', 'avif'])
     */
    formats?: string[];

    /**
     * @property {string} [outputDir]
     * @description Directory where processed images will be saved
     */
    outputDir?: string;

    /**
     * @property {string} [urlPath]
     * @description URL path prefix for generated images
     */
    urlPath?: string;

    /**
     * @property {Function} [filenameFormat]
     * @description Custom function to generate filenames for processed images
     * @param {string} id Unique identifier for the image
     * @param {string} src Source path of the original image
     * @param {number} width Width of the generated variant
     * @param {string} format Format of the generated variant
     * @returns {string} The generated filename
     */
    filenameFormat?: (id: string, src: string, width: number, format: string) => string;
  }

  /**
   * Process an image with the specified options.
   * @param src Path to the source image
   * @param options Processing options
   * @returns Metadata about the processed images
   */
  function Image(src: string, options: ImageOptions): Promise<AnglesitePlugin.ImageMetadata>;
  export = Image;
}

/**
 * @module html-minifier-terser
 * @description Type definitions for HTML minification library
 */
declare module 'html-minifier-terser' {
  /**
   * @interface MinifyOptions
   * @description Options for HTML minification
   */
  interface MinifyOptions {
    /**
     * @property {boolean} [useShortDoctype]
     * @description Use the short HTML5 doctype
     */
    useShortDoctype?: boolean;

    /**
     * @property {boolean} [removeComments]
     * @description Remove HTML comments from output
     */
    removeComments?: boolean;

    /**
     * @property {boolean} [collapseWhitespace]
     * @description Collapse whitespace between elements
     */
    collapseWhitespace?: boolean;
  }

  /**
   * @interface HtmlMinifier
   * @description HTML minifier interface
   */
  interface HtmlMinifier {
    /**
     * @function minify
     * @description Minify HTML content with specified options
     * @param content HTML content to minify
     * @param options Minification options
     * @returns Minified HTML
     */
    minify(content: string, options: MinifyOptions): string;
  }

  const htmlMinifier: HtmlMinifier;
  export = htmlMinifier;
}

/**
 * @module structured-data-linter
 * @description Type definitions for structured data validation
 */
declare module 'structured-data-linter' {
  /**
   * Validate structured data against schema.
   * @param jsonSchema JSON-LD or other structured data to validate
   * @returns Array of validation errors
   */
  function lint(jsonSchema: string): Promise<AnglesitePlugin.SchemaValidationError[]>;
  export { lint };
}

export {};
