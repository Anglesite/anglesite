// Test configuration for Eleventy using the built anglesite-11ty plugin
import anglesiteEleventy from './dist/index.js';

export default function(eleventyConfig) {
  // Use the main anglesite plugin with image optimization
  eleventyConfig.addPlugin(anglesiteEleventy, {
    imageOptions: {
      outputDir: 'img/',
      urlPath: '/img/',
      formats: ['avif', 'webp', 'jpeg'],
      widths: [300, 600, 1200],
    }
  });

  return {
    dir: {
      input: 'src',
      includes: '_includes',
    },
  };
};