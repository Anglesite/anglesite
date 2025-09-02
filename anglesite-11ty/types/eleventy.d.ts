/**
 * @file Type definitions for @11ty/eleventy and related packages
 * @module eleventy
 * @description Comprehensive type definitions for the Eleventy static site generator
 * and its related packages, including configuration interfaces and data structures.
 */

/// <reference types="node" />

/**
 * @interface EleventyConfigReturn
 * @description Return object from Eleventy configuration function
 */
export interface EleventyConfigReturn {
  /** Array of template formats to process */
  templateFormats?: string[];
  /** Directory configuration */
  dir?: {
    /** Input directory for source files */
    input?: string;
    /** Output directory for built files */
    output?: string;
    /** Directory for includes */
    includes: string;
    /** Directory for layouts */
    layouts: string;
  };
  /** Template engine for Markdown files */
  markdownTemplateEngine?: string;
  /** Template engine for HTML files */
  htmlTemplateEngine?: string;
}

/**
 * @namespace Eleventy
 * @description Eleventy type definitions namespace
 */
declare namespace Eleventy {
  interface EleventyConfigReturn {
    templateFormats: string[];
    dir: {
      input?: string;
      output?: string;
      includes: string;
      layouts: string;
    };
    markdownTemplateEngine?: string;
    htmlTemplateEngine?: string;
  }

  interface EleventyData {
    title?: string;
    description?: string;
    lang?: string;
    site?: {
      title?: string;
      description?: string;
      url?: string;
      lang?: string;
    };
    page?: {
      url?: string;
      date?: Date;
      inputPath?: string;
      outputPath?: string;
    };
  }
}

/**
 * @interface WebCOptions
 * @description WebC plugin configuration options
 */
export interface WebCOptions {
  /** Component directories or files */
  components?: string[];
  layouts?: string | string[];
  bundlerMode?: boolean;
}

/**
 * @module @11ty/eleventy-plugin-webc
 * @description WebC plugin for component-based templating
 */
declare module '@11ty/eleventy-plugin-webc' {
  const webCPlugin: (eleventyConfig: unknown, options?: WebCOptions) => void;
  export = webCPlugin;
}

/**
 * @module @dwk/anglesite-11ty
 * @description Anglesite plugin for Eleventy
 */
declare module '@dwk/anglesite-11ty' {
  const anglesitePlugin: (eleventyConfig: unknown) => { name: string };
  export = anglesitePlugin;
}
