import * as fs from 'fs';
import * as path from 'path';
import { generateWebManifest } from '../../plugins/webmanifest';
import addWebManifest from '../../plugins/webmanifest';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('webmanifest plugin', () => {
  const mockEleventyConfig = {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_includes',
      data: '_data',
    },
    on: jest.fn(),
    addPlugin: jest.fn(),
    addBundle: jest.fn(),
    setFreezeReservedData: jest.fn(),
    addPassthroughCopy: jest.fn(),
    addLayoutAlias: jest.fn(),
    setDataFileBaseName: jest.fn(),
    addJavaScriptFunction: jest.fn(),
    addShortcode: jest.fn(),
    addFilter: jest.fn(),
    addTransform: jest.fn(),
    addTemplateFormats: jest.fn(),
    addExtension: jest.fn(),
    setUseGitIgnore: jest.fn(),
    setUseEditorIgnore: jest.fn(),
    addCollection: jest.fn(),
    addTemplate: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('generateWebManifest', () => {
    it('should return empty JSON when no website data', () => {
      const result = generateWebManifest(null as unknown as AnglesiteWebsiteConfiguration);
      expect(result).toBe('{}');
    });

    it('should return empty JSON when website is undefined', () => {
      const result = generateWebManifest(undefined as unknown as AnglesiteWebsiteConfiguration);
      expect(result).toBe('{}');
    });

    it('should generate basic manifest with title only', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result).toEqual({
        name: 'Test App',
        short_name: 'Test App',
        start_url: '/',
        display: 'standalone',
        scope: '/',
        lang: 'en',
      });
    });

    it('should generate short_name from acronym for long titles', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'My Very Long Application Title',
        language: 'en',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.short_name).toBe('MVLAT');
    });

    it('should truncate short_name from single word for very long titles', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'VeryLongApplicationTitleWithoutSpaces',
        language: 'en',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.short_name).toBe('VeryLongAppl');
    });

    it('should use custom short_name when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'My Very Long Application Title',
        language: 'en',
        manifest: {
          short_name: 'MyApp',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.short_name).toBe('MyApp');
    });

    it('should use custom name when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Default Title',
        language: 'en',
        manifest: {
          name: 'Custom App Name',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.name).toBe('Custom App Name');
    });

    it('should include description when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        description: 'This is a test application',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.description).toBe('This is a test application');
    });

    it('should include language when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en-US',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.lang).toBe('en-US');
    });

    it('should include id when URL provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        url: 'https://example.com',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.id).toBe('https://example.com');
    });

    it('should include theme_color when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        manifest: {
          theme_color: '#000000',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.theme_color).toBe('#000000');
    });

    it('should include background_color when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        manifest: {
          background_color: '#ffffff',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.background_color).toBe('#ffffff');
    });

    it('should include orientation when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        manifest: {
          orientation: 'portrait',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.orientation).toBe('portrait');
    });

    it('should use custom display mode when provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        manifest: {
          display: 'fullscreen',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.display).toBe('fullscreen');
    });

    it('should include PNG icons from favicon config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        favicon: {
          png: {
            '192': '/icon-192.png',
            '512': '/icon-512.png',
            '32': '/icon-32.png',
          },
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.icons).toEqual([
        {
          src: '/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ]);
    });

    it('should exclude small PNG icons (less than 48px)', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        favicon: {
          png: {
            '16': '/icon-16.png',
            '32': '/icon-32.png',
            '48': '/icon-48.png',
            '192': '/icon-192.png',
          },
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.icons).toEqual([
        {
          src: '/icon-48.png',
          sizes: '48x48',
          type: 'image/png',
        },
        {
          src: '/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        },
      ]);
    });

    it('should include SVG icons from favicon config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        favicon: {
          svg: '/icon.svg',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.icons).toEqual([
        {
          src: '/icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
        },
      ]);
    });

    it('should include Apple Touch Icon from favicon config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        favicon: {
          appleTouchIcon: '/apple-touch-icon.png',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.icons).toEqual([
        {
          src: '/apple-touch-icon.png',
          sizes: '180x180',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ]);
    });

    it('should sort icons with SVG first, then by size', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
        favicon: {
          png: {
            '512': '/icon-512.png',
            '192': '/icon-192.png',
          },
          svg: '/icon.svg',
          appleTouchIcon: '/apple-touch-icon.png',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.icons).toEqual([
        {
          src: '/icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
        },
        {
          src: '/apple-touch-icon.png',
          sizes: '180x180',
          type: 'image/png',
          purpose: 'any maskable',
        },
        {
          src: '/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ]);
    });

    it('should format JSON output with proper indentation', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
      };

      const result = generateWebManifest(data);
      expect(result).toContain('{\n  "name":');
    });

    it('should handle missing favicon object gracefully', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en',
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result.icons).toBeUndefined();
    });

    it('should generate complete manifest with all options', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test App',
        language: 'en-US',
        description: 'A comprehensive test application',
        url: 'https://example.com',
        manifest: {
          name: 'Custom Test App',
          short_name: 'CTA',
          display: 'fullscreen',
          theme_color: '#000000',
          background_color: '#ffffff',
          orientation: 'portrait',
        },
        favicon: {
          png: {
            '192': '/icon-192.png',
            '512': '/icon-512.png',
          },
          svg: '/icon.svg',
          appleTouchIcon: '/apple-touch-icon.png',
        },
      };

      const result = JSON.parse(generateWebManifest(data));
      expect(result).toEqual({
        name: 'Custom Test App',
        short_name: 'CTA',
        start_url: '/',
        display: 'fullscreen',
        scope: '/',
        description: 'A comprehensive test application',
        lang: 'en-US',
        id: 'https://example.com',
        theme_color: '#000000',
        background_color: '#ffffff',
        orientation: 'portrait',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      });
    });
  });

  describe('addWebManifest plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addWebManifest(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write manifest.webmanifest using data from the cascade', async () => {
      addWebManifest(mockEleventyConfig);

      // Get the callback that was registered
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      // Simulate eleventy.after event with data from the cascade
      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test App',
                language: 'en',
                url: 'https://test.com',
                description: 'Test application',
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', 'manifest.webmanifest'),
        expect.stringContaining('"name": "Test App"')
      );
    });

    it('should handle file system errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      addWebManifest(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test App',
                language: 'en',
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Failed to write manifest.webmanifest: Permission denied')
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty results gracefully', async () => {
      addWebManifest(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
