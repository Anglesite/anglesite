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
import addGpcJson from './plugins/gpc.js';
import addOpenIdConfiguration from './plugins/openid-configuration.js';
import addAppleAppSiteAssociation from './plugins/apple-app-site-association.js';
import addAssetLinks from './plugins/assetlinks.js';
import addBrowserConfig from './plugins/browserconfig.js';
import EleventyWebcPlugin from '@11ty/eleventy-plugin-webc';
import type { EleventyConfig } from '@11ty/eleventy';

export interface AnglesiteEleventyOptions {
  /** Skip WebC plugin registration to avoid conflicts when WebC is registered elsewhere */
  skipWebC?: boolean;
  /** Path pattern for WebC components */
  webComponents?: string;
  /** Additional options for the WebC plugin */
  webcOptions?: Record<string, unknown>;
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

  // Ensure options is an object to prevent null reference errors
  const safeOptions = options || {};

  // Add WebC plugin with configurable component paths, unless skipWebC is true
  // This prevents conflicts when WebC is registered by parent configurations
  if (safeOptions.skipWebC !== true) {
    eleventyConfig.addPlugin(EleventyWebcPlugin, {
      components: safeOptions.webComponents || '_includes/**/*.webc',
      ...safeOptions.webcOptions,
    });
  }

  // Add all plugins
  addShortcodes(eleventyConfig);
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
  addGpcJson(eleventyConfig);
  addOpenIdConfiguration(eleventyConfig);
  addAppleAppSiteAssociation(eleventyConfig);
  addAssetLinks(eleventyConfig);
  addBrowserConfig(eleventyConfig);
}

// Export individual plugins for direct use if needed
export {
  addShortcodes,
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
  addGpcJson,
  addOpenIdConfiguration,
  addAppleAppSiteAssociation,
  addAssetLinks,
  addBrowserConfig,
};
