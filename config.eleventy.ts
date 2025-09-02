// Root Eleventy configuration - imports from anglesite-11ty workspace
import type { EleventyConfig } from '@11ty/eleventy';

// Import plugins from remaining plugins/ directory (non-well-known)
import addAssetPipeline from './plugins/assets.js';

// Import the main anglesite-11ty plugin (includes all well-known plugins)
import anglesiteEleventy from '@dwk/anglesite-11ty';

/**
 * Eleventy configuration function.
 * @param {object} eleventyConfig Eleventy configuration object
 * @returns {object} Configuration object for Eleventy
 */
export default function (eleventyConfig: EleventyConfig) {
  // support index.11tydata.json for collection specific front-matter
  eleventyConfig.setDataFileBaseName('index');

  // Add the main anglesite-11ty plugin (includes all well-known directory plugins)
  eleventyConfig.addPlugin(anglesiteEleventy);

  // Add remaining plugins
  eleventyConfig.addPlugin(addAssetPipeline, {
    passthroughCopy: {
      'src/assets/fonts': 'fonts',
      'src/assets/icons': 'assets/icons',
      'src/assets/images': 'assets/images',
      'src/favicon.ico': 'favicon.ico',
      'src/favicon.svg': 'favicon.svg',
    },
  });

  return {
    dir: {
      input: 'src',
      includes: '_includes',
    },
  };
}