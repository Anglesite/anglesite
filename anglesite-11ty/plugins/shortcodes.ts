import { EleventyContext, EleventyConfig } from '../types/index.js';

/**
 * Adds shortcodes for Anglesite projects.
 * @param eleventyConfig The Eleventy configuration object.
 */
export default function addShortcodes(eleventyConfig: EleventyConfig): void {
  eleventyConfig.addShortcode('getPageTitle', function (this: EleventyContext) {
    const pageTitle = this.title;
    const websiteTitle = this.website?.title || 'Website';

    // TODO: Make the website title construction configurable in Anglesite UI
    if (pageTitle && pageTitle !== websiteTitle) {
      return `${pageTitle} | ${websiteTitle}`;
    }
    return websiteTitle;
  });
}
