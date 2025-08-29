import webc from '@11ty/eleventy-plugin-webc';

interface EleventyConfig {
  addPlugin(plugin: unknown, options?: unknown): void;
}

export default function (eleventyConfig: EleventyConfig) {
  eleventyConfig.addPlugin(webc);

  return {
    templateFormats: ['webc'],
    dir: {
      input: 'src',
      output: '_site',
    },
    markdownTemplateEngine: 'webc',
    htmlTemplateEngine: 'webc',
  };
}
