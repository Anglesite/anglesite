/**
 * @file Type declarations for third-party dependencies
 * @module deps
 * @description Type definitions for external dependencies that don't provide
 * their own TypeScript type declarations, including image processing,
 * HTML minification, and WebC plugin functionality.
 */

/**
 * @module @11ty/eleventy-img
 * @description Eleventy Image plugin for optimizing and transforming images
 */
declare module '@11ty/eleventy-img' {
  /**
   * @interface ImageOptions
   * @description Configuration options for image processing
   */
  interface ImageOptions {
    /** Array of widths to generate for responsive images */
    widths: number[];

    /** Image formats to generate (e.g., ['jpeg', 'webp', 'avif']) */
    formats: string[];

    /** Directory where processed images will be saved */
    outputDir: string;

    /** URL path prefix for generated images */
    urlPath: string;

    /**
     * Custom function to generate filenames for processed images
     * @param id Unique identifier for the image
     * @param src Source path of the original image
     * @param width Width of the generated variant
     * @param format Format of the generated variant
     * @returns The generated filename
     */
    filenameFormat: (id: string, src: string, width: number, format: string) => string;
  }

  /**
   * @interface ImageMetadata
   * @description Metadata about the processed image variants
   */
  interface ImageMetadata {
    /** Array of JPEG variants with their URLs */
    jpeg: Array<{
      /** URL path to the image variant */
      url: string;
    }>;
  }

  /**
   * Processes an image with the specified options
   * @param src Path to the source image
   * @param options Processing configuration
   * @returns Metadata about the processed images
   */
  function Image(src: string, options: ImageOptions): Promise<ImageMetadata>;
  export default Image;
}

/**
 * @module html-minifier-terser
 * @description HTML minification library for optimizing HTML output
 */
declare module 'html-minifier-terser' {
  /**
   * @interface MinifyOptions
   * @description Configuration options for HTML minification
   */
  interface MinifyOptions {
    /** Use the short HTML5 doctype */
    useShortDoctype?: boolean;

    /** Remove HTML comments from output */
    removeComments?: boolean;

    /** Collapse whitespace between elements */
    collapseWhitespace?: boolean;
  }

  /**
   * Minifies HTML content with specified options
   * @param html HTML content to minify
   * @param options Minification configuration
   * @returns Minified HTML
   */
  export function minify(html: string, options: MinifyOptions): string;
}

/**
 * @module @11ty/eleventy-plugin-webc
 * @description Eleventy WebC plugin for component-based templating
 */
declare module '@11ty/eleventy-plugin-webc' {
  /**
   * @interface WebCOptions
   * @description Configuration options for the WebC plugin
   */
  interface WebCOptions {
    /** Paths to component directories or files */
    components?: string[];

    /** Path(s) to layout templates */
    layouts?: string | string[];

    /** Enable bundler mode for CSS and JavaScript */
    bundlerMode?: boolean;
  }

  /**
   * Initializes the WebC plugin with Eleventy
   * @param eleventyConfig Eleventy configuration object
   * @param options Plugin configuration options
   */
  function webCPlugin(eleventyConfig: unknown, options?: WebCOptions): void;
  export default webCPlugin;
}

/**
 * @module @11ty/eleventy-plugin-syntaxhighlight
 * @description Eleventy Syntax Highlighting plugin using Prism.js
 */
declare module '@11ty/eleventy-plugin-syntaxhighlight' {
  /**
   * @interface SyntaxHighlightOptions
   * @description Configuration options for syntax highlighting
   */
  interface SyntaxHighlightOptions {
    /** Theme name ('default', 'dark', etc.) or 'none' to disable CSS */
    theme?: string;
    /** Add attributes to <pre> tags */
    preAttributes?: Record<string, unknown>;
    /** Add attributes to <code> tags */
    codeAttributes?: Record<string, unknown>;
    /** Custom initialization function for Prism */
    init?: (data: { Prism: unknown }) => void;
    /** Auto-copy CSS theme from node_modules */
    includeCSS?: boolean;
    /** Custom output filename for CSS */
    cssFilename?: string;
    /** Additional plugin options */
    [key: string]: unknown;
  }

  /**
   * Initializes the syntax highlighting plugin with Eleventy
   * @param eleventyConfig Eleventy configuration object
   * @param options Plugin configuration options
   */
  function syntaxHighlightPlugin(eleventyConfig: unknown, options?: SyntaxHighlightOptions): void;
  export default syntaxHighlightPlugin;
}
