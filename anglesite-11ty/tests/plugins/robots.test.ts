import * as fs from 'fs';
import * as path from 'path';
import { generateRobotsTxt } from '../../plugins/robots';
import addRobotsTxt from '../../plugins/robots';
import type { EleventyConfig } from '@11ty/eleventy';
import type { AnglesiteWebsiteConfiguration } from '../../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('robots plugin', () => {
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

  describe('generateRobotsTxt', () => {
    it('should return empty string when no website data', () => {
      expect(generateRobotsTxt(null as any)).toBe('');
    });

    it('should return empty string when website is undefined', () => {
      expect(generateRobotsTxt(undefined as any)).toBe('');
    });

    it('should generate default robots.txt when no robots config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow:\n\n');
    });

    it('should generate robots.txt with simple robot rules', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        robots: [
          {
            'User-agent': '*',
            Disallow: ['/admin', '/private'],
            Allow: '/public',
            'Crawl-delay': 1,
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nAllow: /public\nDisallow: /admin\nDisallow: /private\nCrawl-delay: 1\n\n');
    });

    it('should handle single string Allow and Disallow values', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        robots: [
          {
            'User-agent': '*',
            Allow: '/single-allow',
            Disallow: '/single-disallow',
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nAllow: /single-allow\nDisallow: /single-disallow\n\n');
    });

    it('should handle array Allow and Disallow values', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        robots: [
          {
            'User-agent': '*',
            Allow: ['/public', '/images'],
            Disallow: ['/admin', '/private'],
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nAllow: /public\nAllow: /images\nDisallow: /admin\nDisallow: /private\n\n');
    });

    it('should handle multiple robot rules', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        robots: [
          {
            'User-agent': '*',
            Disallow: '/admin',
          },
          {
            'User-agent': 'Googlebot',
            Allow: '/',
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow: /admin\n\nUser-agent: Googlebot\nAllow: /\n\n');
    });

    it('should add sitemap when sitemap is enabled and URL provided', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        sitemap: true,
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n');
    });

    it('should add custom sitemap filename when specified', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        sitemap: {
          enabled: true,
          indexFilename: 'custom-sitemap.xml',
        },
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow:\n\nSitemap: https://example.com/custom-sitemap.xml\n');
    });

    it('should not add sitemap when sitemap is disabled', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        sitemap: { enabled: false },
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow:\n\n');
    });

    it('should not add sitemap when URL is missing', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        sitemap: true,
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow:\n\n');
    });

    it('should handle sitemap object with default enabled', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        sitemap: {},
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n');
    });

    it('should generate complete robots.txt with robots rules and sitemap', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        sitemap: true,
        robots: [
          {
            'User-agent': '*',
            Disallow: ['/admin', '/private'],
            Allow: '/public',
          },
          {
            'User-agent': 'Googlebot',
            Allow: '/',
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe(
        'User-agent: *\nAllow: /public\nDisallow: /admin\nDisallow: /private\n\nUser-agent: Googlebot\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n'
      );
    });

    it('should handle zero crawl delay', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        robots: [
          {
            'User-agent': '*',
            'Crawl-delay': 0,
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nCrawl-delay: 0\n\n');
    });

    it('should skip invalid robot rules without User-agent', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        robots: [
          {
            Disallow: '/admin',
          } as any,
          {
            'User-agent': '*',
            Allow: '/',
          },
        ],
      };

      const result = generateRobotsTxt(data);
      expect(result).toBe('User-agent: *\nAllow: /\n\n');
    });
  });

  describe('addRobotsTxt plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addRobotsTxt(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write robots.txt using data from the cascade', async () => {
      addRobotsTxt(mockEleventyConfig);

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
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
                robots: [{ 'User-agent': '*', Allow: ['/'] }],
                sitemap: true,
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', 'robots.txt'),
        'User-agent: *\nAllow: /\n\nSitemap: https://test.com/sitemap.xml\n'
      );
    });

    it('should generate default robots.txt when no robots rules specified', async () => {
      addRobotsTxt(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('_site', 'robots.txt'), 'User-agent: *\nDisallow:\n\n');
    });

    it('should handle file system errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      addRobotsTxt(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Eleventy] Failed to write robots.txt: Permission denied')
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty results gracefully', async () => {
      addRobotsTxt(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
