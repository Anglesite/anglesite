const anglesiteEleventy = require('@dwk/anglesite-11ty');
const fs = require('fs');
const path = require('path');

/**
 * Eleventy configuration function for Anglesite websites.
 * @param eleventyConfig Configuration object
 * @returns Configuration return object
 */
module.exports = function (eleventyConfig) {
  // FIXME: Workaround for a known issue in eleventy-plugin-webc (https://github.com/11ty/eleventy-plugin-webc/issues/86).
  // When using `permalink` in front matter, especially with dynamic values or for non-HTML files,
  // `page.url` may not be correctly populated or available to other plugins/filters.
  // To avoid build errors and ensure consistent URL generation, explicitly duplicate the `permalink`
  // value in `page.url` within the front matter for affected templates.
  eleventyConfig.setFreezeReservedData(false);

  // Anglesite 11ty is the configuration that Anglesite needs
  // of an 11ty project for it to work with the UX of Anglesite
  // Skip WebC plugin in anglesite-11ty since we register it here to avoid conflicts
  eleventyConfig.addPlugin(anglesiteEleventy, {
    skipWebC: true,
  });

  // Add WebC plugin directly here with proper configuration
  const EleventyWebcPlugin = require('@11ty/eleventy-plugin-webc');
  eleventyConfig.addPlugin(EleventyWebcPlugin, {
    components: '_includes/**/*.webc', // Standardized path - consistent with per-website-server
  });

  // Add global data functions to make data accessible to npm components
  eleventyConfig.addGlobalData('eleventy', () => ({
    generator: process.env.ELEVENTY_VERSION ? `Eleventy v${process.env.ELEVENTY_VERSION}` : 'Eleventy',
  }));

  // Check for base layout and configure accordingly
  const baseLayoutPath = path.join(process.cwd(), 'src/_includes/base.webc');
  if (fs.existsSync(baseLayoutPath)) {
    eleventyConfig.setDataFileBaseName('anglesite');
  }

  // Update config for the actual website files to be in src/ for
  // simpler editing in Anglesite.
  return {
    templateFormats: ['11ty.js', 'webc', 'md', 'html'],
    markdownTemplateEngine: 'webc',
    htmlTemplateEngine: 'webc',
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_includes',
    },
  };
};
