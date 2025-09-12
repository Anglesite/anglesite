import addShortcodes from './plugins/shortcodes.js';
import addRobotsTxt from './plugins/robots.js';
import addWebManifest from './plugins/webmanifest.js';
import addSecurityTxt from './plugins/security.js';
import addPgpKey from './plugins/pgp.js';
import addSitemap from './plugins/sitemap.js';
import addRedirects from './plugins/redirects.js';
import addHeaders from './plugins/headers.js';
import addHostMeta from './plugins/host-meta.js';
import addWebFinger from './plugins/webfinger.js';
import addNodeInfo from './plugins/nodeinfo.js';
import addOpenIDConfiguration from './plugins/openid-configuration.js';
import addImages, { type ImageOptions } from './plugins/images.js';
import addFeeds from './plugins/feeds.js';
import addRSL from './plugins/rsl.js';
import addSyntaxHighlight from './plugins/syntax-highlight.js';
import EleventyWebcPlugin from '@11ty/eleventy-plugin-webc';
import type { EleventyConfig } from '@11ty/eleventy';

export interface AnglesiteEleventyOptions {
  /** Path pattern for WebC components */
  webComponents?: string;
  /** Additional options for the WebC plugin */
  webcOptions?: Record<string, unknown>;
  /** Configuration options for image optimization */
  imageOptions?: ImageOptions;
  /** Configuration options for syntax highlighting */
  syntaxHighlightOptions?: Record<string, unknown>;
}

/**
 * The main plugin for Anglesite 11ty.
 * @param eleventyConfig The Eleventy configuration object.
 * @param options Configuration options for the plugin.
 */
export default function anglesiteEleventy(
  eleventyConfig: EleventyConfig,
  options: AnglesiteEleventyOptions = {}
): void {
  // support index.11tydata.json for collection specific front-matter
  eleventyConfig.setDataFileBaseName('index');

  // Add WebC plugin with configurable component paths
  eleventyConfig.addPlugin(EleventyWebcPlugin, {
    components: options.webComponents || '_includes/**/*.webc',
    ...options.webcOptions,
  });

  // Add all plugins
  addShortcodes(eleventyConfig);
  addImages(eleventyConfig, options.imageOptions);
  addSyntaxHighlight(eleventyConfig, options.syntaxHighlightOptions as Parameters<typeof addSyntaxHighlight>[1]);
  addRobotsTxt(eleventyConfig);
  addWebManifest(eleventyConfig);
  addSecurityTxt(eleventyConfig);
  addPgpKey(eleventyConfig);
  addSitemap(eleventyConfig);
  addRedirects(eleventyConfig);
  addHeaders(eleventyConfig);
  addHostMeta(eleventyConfig);
  addWebFinger(eleventyConfig);
  addNodeInfo(eleventyConfig);
  addOpenIDConfiguration(eleventyConfig);
  addFeeds(eleventyConfig);
  addRSL(eleventyConfig);
}

// Export individual plugins for direct use if needed
export {
  addShortcodes,
  addImages,
  addSyntaxHighlight,
  addRobotsTxt,
  addWebManifest,
  addSecurityTxt,
  addPgpKey,
  addSitemap,
  addRedirects,
  addHeaders,
  addHostMeta,
  addWebFinger,
  addNodeInfo,
  addOpenIDConfiguration,
  addFeeds,
  addRSL,
};
