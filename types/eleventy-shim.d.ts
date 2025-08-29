declare module '@11ty/eleventy' {
  export interface EleventyConfig {
    /** Adds a new bundle for grouping assets */
    addBundle(bundleName: string): void;
    /** Registers a plugin with optional configuration */
    addPlugin(plugin: (eleventyConfig: EleventyConfig, options?: object) => void, options?: object): void;
    /** Controls whether reserved data keys can be overridden */
    setFreezeReservedData(freeze: boolean): void;
    /** Adds files or directories to copy without processing */
    addPassthroughCopy(pathOrGlob: string | object): void;
    /** Creates an alias for a layout template */
    addLayoutAlias(alias: string, layoutPath: string): void;
    /** Sets the base name for data files */
    setDataFileBaseName(baseName: string): void;
    /** Registers a JavaScript function for use in templates */
    addJavaScriptFunction(name: string, fn: (...args: unknown[]) => unknown): void;
    /** Adds a shortcode for template use */
    addShortcode(name: string, fn: (...args: unknown[]) => unknown): void;
    /** Registers a filter for transforming values */
    addFilter(name: string, fn: (...args: unknown[]) => unknown): void;
    /** Adds a transform for modifying output */
    addTransform(name: string, fn: (...args: unknown[]) => unknown): void;
    /** Adds a new template format */
    addTemplateFormats(formats: string | string[]): void;
    /** Adds a custom extension */
    addExtension(
      format: string,
      options: {
        outputFileExtension: string;
        compile: (inputContent: string, inputPath: string) => (data: unknown) => string;
      }
    ): void;
    setUseGitIgnore(use: boolean): void;
    setUseEditorIgnore(use: boolean): void;
    /** Adds a new collection */
    addCollection(name: string, callback: (collectionApi: EleventyCollectionApi) => any): void;
    /** Registers an event listener */
    on(
      eventName: 'eleventy.after',
      listener: (args: { dir: { output: string }; results: any[] }) => void | Promise<void>
    ): void;
    on(eventName: string, listener: (...args: any[]) => void): void;
    dir: {
      input: string;
      output: string;
      includes: string;
      layouts: string;
      data: string;
    };
  }

  export interface EleventyCollectionApi {
    getAll(): EleventyCollectionItem[];
    getAllSorted(): EleventyCollectionItem[];
    // Add other methods as needed
  }

  export interface EleventyCollectionItem {
    data: {
      website?: any;
      eleventyExcludeFromCollections?: boolean;
      sitemap?: any;
      priority?: number;
      [key: string]: any;
    };
    url: string;
    date: Date;
    inputPath: string;
    outputPath: string;
    rawContent?: string;
    templateContent?: string;
    // Add other properties as needed
  }
}
