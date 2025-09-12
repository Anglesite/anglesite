// import webc from '@11ty/eleventy-plugin-webc';

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
import addImages from './plugins/images.js';
import addFeeds from './plugins/feeds.js';
import addRSL from './plugins/rsl.js';
import addShortcodes from './plugins/shortcodes.js';
import type { EleventyConfig } from '@11ty/eleventy';

/**
 * Eleventy configuration function.
 * @param {object} eleventyConfig Eleventy configuration object
 * @returns {object} Configuration object for Eleventy
 */
export default function (eleventyConfig: EleventyConfig) {
  // support index.11tydata.json for collection specific front-matter
  eleventyConfig.setDataFileBaseName('index');

  eleventyConfig.addPlugin(addImages);
  eleventyConfig.addPlugin(addRobotsTxt);
  eleventyConfig.addPlugin(addWebManifest);
  eleventyConfig.addPlugin(addSecurityTxt);
  eleventyConfig.addPlugin(addPgpKey);
  eleventyConfig.addPlugin(addSitemap);
  eleventyConfig.addPlugin(addRedirects);
  eleventyConfig.addPlugin(addHeaders);
  eleventyConfig.addPlugin(addHostMeta);
  eleventyConfig.addPlugin(addWebFinger);
  eleventyConfig.addPlugin(addNodeInfo);
  eleventyConfig.addPlugin(addOpenIDConfiguration);
  eleventyConfig.addPlugin(addFeeds);
  eleventyConfig.addPlugin(addRSL);
  eleventyConfig.addPlugin(addShortcodes);

  return {
    dir: {
      input: 'src',
      includes: '_includes',
    },
  };
}
