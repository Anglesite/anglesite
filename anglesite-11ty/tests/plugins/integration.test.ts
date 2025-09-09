import { describe, it, expect } from '@jest/globals';

describe('Plugin Integration Tests', () => {
  describe('Build Process Integration', () => {
    it('should import all plugins without throwing errors', async () => {
      // This is a basic integration test to ensure plugins can be imported
      // and their exports are available

      // Import all plugins and check they export default functions
      const addSitemap = (await import('../../plugins/sitemap.js')).default;
      const addRobots = (await import('../../plugins/robots.js')).default;
      const addSecurity = (await import('../../plugins/security.js')).default;
      const addHeaders = (await import('../../plugins/headers.js')).default;
      const addFeeds = (await import('../../plugins/feeds.js')).default;
      const addRedirects = (await import('../../plugins/redirects.js')).default;
      const addWebfinger = (await import('../../plugins/webfinger.js')).default;
      const addWebmanifest = (await import('../../plugins/webmanifest.js')).default;
      const addHostMeta = (await import('../../plugins/host-meta.js')).default;
      const addNodeinfo = (await import('../../plugins/nodeinfo.js')).default;
      const addOpenidConfiguration = (await import('../../plugins/openid-configuration.js')).default;
      const addPgp = (await import('../../plugins/pgp.js')).default;
      const addShortcodes = (await import('../../plugins/shortcodes.js')).default;
      const addSyntaxHighlight = (await import('../../plugins/syntax-highlight.js')).default;
      const addImages = (await import('../../plugins/images.js')).default;

      // Verify all exports are functions
      expect(typeof addSitemap).toBe('function');
      expect(typeof addRobots).toBe('function');
      expect(typeof addSecurity).toBe('function');
      expect(typeof addHeaders).toBe('function');
      expect(typeof addFeeds).toBe('function');
      expect(typeof addRedirects).toBe('function');
      expect(typeof addWebfinger).toBe('function');
      expect(typeof addWebmanifest).toBe('function');
      expect(typeof addHostMeta).toBe('function');
      expect(typeof addNodeinfo).toBe('function');
      expect(typeof addOpenidConfiguration).toBe('function');
      expect(typeof addPgp).toBe('function');
      expect(typeof addShortcodes).toBe('function');
      expect(typeof addSyntaxHighlight).toBe('function');
      expect(typeof addImages).toBe('function');
    });

    it('should import utility functions without throwing errors', async () => {
      // Test utility imports
      const pageFilters = await import('../../plugins/utils/page-filters.js');

      expect(typeof pageFilters.filterSitemapPages).toBe('function');
      expect(typeof pageFilters.isPagePublic).toBe('function');
    });
  });

  describe('Type System Integration', () => {
    it('should import type definitions without errors', async () => {
      // Test type imports - these should not throw during compilation
      const types = await import('../../types/index.js');

      // The types module should export interfaces and types
      expect(typeof types).toBe('object');
    });
  });
});
