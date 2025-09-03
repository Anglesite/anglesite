import syntaxHighlight from '@11ty/eleventy-plugin-syntaxhighlight';
import type { EleventyConfig } from '@11ty/eleventy';

interface SyntaxHighlightOptions {
  theme?: string;
  includeCSS?: boolean;
  cssFilename?: string;
  preAttributes?: Record<string, unknown>;
  codeAttributes?: Record<string, unknown>;
  init?: () => void;
}

/**
 * Add syntax highlighting support using @11ty/eleventy-plugin-syntaxhighlight
 *
 * By default, this plugin does not include any CSS styling. You need to add a Prism.js theme:
 *
 * ## Option 1: npm Package (Recommended)
 * 1. Install: `npm install prismjs`
 * 2a. Manual copy: `cp node_modules/prismjs/themes/prism.css src/_includes/`
 * 2b. Or auto-copy via Eleventy passthrough:
 *     `eleventyConfig.addPassthroughCopy({"node_modules/prismjs/themes/prism.css": "prism.css"});`
 * 3. Link in your layout: `<link rel="stylesheet" href="/prism.css">`
 *
 * Available themes in node_modules/prismjs/themes/:
 * - prism.css (default light theme)
 * - prism-dark.css
 * - prism-funky.css
 * - prism-okaidia.css
 * - prism-twilight.css
 * - prism-coy.css
 * - prism-solarizedlight.css
 * - prism-tomorrow.css
 *
 * ## Option 2: CDN
 * Add to your layout head:
 * `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/themes/prism.min.css">`
 *
 * ## Option 3: Auto-include via Plugin Options (Uses eleventyConfig.addPassthroughCopy)
 * Configure the plugin to automatically copy themes from node_modules:
 * ```js
 * addSyntaxHighlight(eleventyConfig, {
 *   theme: 'dark',           // Theme name
 *   includeCSS: true,        // Auto-copy CSS from node_modules
 *   cssFilename: 'prism.css' // Optional: custom output filename
 * });
 * ```
 * The plugin calls eleventyConfig.addPassthroughCopy() internally.
 *
 * ## Option 4: Custom CSS
 * Write your own `.token.*` styles
 * @param eleventyConfig - The Eleventy configuration object
 * @param options - Configuration options for syntax highlighting
 */
export default function addSyntaxHighlight(eleventyConfig: EleventyConfig, options: SyntaxHighlightOptions = {}): void {
  const defaultOptions: SyntaxHighlightOptions = {
    // Don't include any CSS by default - let users choose their own theme
    theme: 'none',
    includeCSS: false,
    cssFilename: undefined, // Will default to prism-{theme}.css
    preAttributes: {
      tabindex: 0,
    },
    codeAttributes: {},
    init: function () {
      // You can add custom language support here if needed
      // Example: Prism.languages.myCustomLanguage = { ... };
    },
  };

  // Merge user options with defaults
  const finalOptions: SyntaxHighlightOptions = {
    ...defaultOptions,
    ...options,
    // Ensure user's init function is preserved if provided
    init: options.init || defaultOptions.init,
  };

  // Auto-copy CSS theme if requested using eleventyConfig.addPassthroughCopy()
  if (finalOptions.includeCSS && finalOptions.theme && finalOptions.theme !== 'none') {
    const themeMap: Record<string, string> = {
      prism: 'prism.css',
      dark: 'prism-dark.css',
      funky: 'prism-funky.css',
      okaidia: 'prism-okaidia.css',
      twilight: 'prism-twilight.css',
      coy: 'prism-coy.css',
      solarizedlight: 'prism-solarizedlight.css',
      tomorrow: 'prism-tomorrow.css',
    };

    const themeFile = themeMap[finalOptions.theme] || `prism-${finalOptions.theme}.css`;
    const sourcePath = `node_modules/prismjs/themes/${themeFile}`;
    const targetPath = finalOptions.cssFilename || `prism-${finalOptions.theme}.css`;

    // Use Eleventy's passthrough copy to automatically copy CSS from node_modules
    eleventyConfig.addPassthroughCopy({
      [sourcePath]: targetPath,
    });

    console.log(`[Syntax Highlight] Using eleventyConfig.addPassthroughCopy() to copy: ${sourcePath} → ${targetPath}`);
  }

  // Add the syntax highlighting plugin
  eleventyConfig.addPlugin(syntaxHighlight as (eleventyConfig: EleventyConfig, options?: object) => void, finalOptions);
}
