// Root Eleventy configuration - imports from anglesite-11ty workspace
import type { EleventyConfig } from '@11ty/eleventy';

// Import the main anglesite-11ty plugin and the assets plugin
import anglesiteEleventy, { addAssets } from '@dwk/anglesite-11ty';

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

  // Add assets plugin with custom configuration
  eleventyConfig.addPlugin(addAssets, {
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