import anglesiteEleventy from '@dwk/anglesite-11ty';

/**
 * Eleventy configuration function.
 * @param {import("@11ty/eleventy/src/UserConfig")} eleventyConfig The Eleventy configuration object
 * @returns {object} Eleventy configuration settings
 */
export default function (eleventyConfig) {
  // FIXME: Workaround for a known issue in eleventy-plugin-webc (https://github.com/11ty/eleventy-plugin-webc/pull/93.
  // When using `permalink` in front matter, especially with dynamic values or for non-HTML files,
  // `page.url` may not be correctly populated or available to other plugins/filters.
  // To avoid build errors and ensure consistent URL generation, explicitly duplicate the `permalink`
  // value in `page.url` within the front matter for affected templates.
  //
  // Example:
  // ```
  // permalink: /my-page/index.html
  // page:
  //    url: /my-page/
  // ```
  // This ensures that `page.url` is always available and correctly reflects the intended output URL.
  eleventyConfig.setFreezeReservedData(false);

  // Anglesite 11ty is the configuration that Anglesite needs
  // of an 11ty project for it to work with the UX of Anglesite
  eleventyConfig.addPlugin(anglesiteEleventy, {
    webComponents: 'src/_includes/**/*.webc',
  });

  // Ignore _README.md files from being built
  eleventyConfig.ignores.add('**/_README.md');

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
}
