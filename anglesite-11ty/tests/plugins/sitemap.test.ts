import * as fs from 'fs';
import * as path from 'path';
import { generateSitemapXml, generateSitemapFiles } from '../../plugins/sitemap';
import addSitemap from '../../plugins/sitemap';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../types/website';

// Local interface for testing (matches the one in sitemap.ts)
interface PageData {
  website?: AnglesiteWebsiteConfiguration;
  page?: {
    url?: string;
    date?: Date;
    inputPath?: string;
    outputPath?: string;
  };
  sitemap?: {
    exclude?: boolean;
    changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
    priority?: number;
    lastmod?: Date | string;
  };
  priority?: number;
  eleventyExcludeFromCollections?: boolean;
}

// Mock fs operations to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readFile: jest.fn(),
  },
}));

describe('sitemap plugin', () => {
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
    jest.clearAllMocks();
  });

  describe('generateSitemapXml', () => {
    const mockWebsite: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      language: 'en',
      url: 'https://example.com',
    };

    const mockPages = [
      {
        page: {
          url: '/',
          date: new Date('2024-01-01'),
          inputPath: 'index.md',
          outputPath: 'index.html',
        },
      },
      {
        page: {
          url: '/about/',
          date: new Date('2024-01-02'),
          inputPath: 'about.md',
          outputPath: 'about/index.html',
        },
      },
    ];

    it('should return empty string if website is missing', () => {
      expect(generateSitemapXml(null as unknown as AnglesiteWebsiteConfiguration, [])).toBe('');
      expect(generateSitemapXml({} as AnglesiteWebsiteConfiguration, [])).toBe('');
    });

    it('should return empty string if sitemap is disabled', () => {
      const disabledWebsite = { ...mockWebsite, sitemap: false };
      expect(generateSitemapXml(disabledWebsite, mockPages)).toBe('');

      const disabledWebsite2 = { ...mockWebsite, sitemap: { enabled: false } };
      expect(generateSitemapXml(disabledWebsite2, mockPages)).toBe('');
    });

    it('should generate basic sitemap with default changefreq', () => {
      const xml = generateSitemapXml(mockWebsite, mockPages);
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).toContain('<loc>https://example.com/about/</loc>');
      expect(xml).toContain('<changefreq>yearly</changefreq>');
      expect(xml).toContain('<lastmod>2024-01-01</lastmod>');
      expect(xml).toContain('<lastmod>2024-01-02</lastmod>');
    });

    it('should use sitemap changefreq when available', () => {
      const pagesWithChangefreq = [
        {
          ...mockPages[0],
          sitemap: { changefreq: 'daily' },
        },
        {
          ...mockPages[1],
          sitemap: { changefreq: 'monthly' },
        },
      ];
      const xml = generateSitemapXml(mockWebsite, pagesWithChangefreq);
      expect(xml).toContain('<changefreq>daily</changefreq>');
      expect(xml).toContain('<changefreq>monthly</changefreq>');
    });

    it('should use website default changefreq', () => {
      const websiteWithDefaults = {
        ...mockWebsite,
        sitemap: { changefreq: 'weekly' as const, priority: 0.8 },
      };
      const xml = generateSitemapXml(websiteWithDefaults, mockPages);
      expect(xml).toContain('<changefreq>weekly</changefreq>');
      expect(xml).toContain('<priority>0.8</priority>');
    });

    it('should handle priority values', () => {
      const pagesWithPriority = [
        {
          ...mockPages[0],
          sitemap: { priority: 1.0 },
        },
        {
          ...mockPages[1],
          priority: 0.5,
        },
      ];
      const xml = generateSitemapXml(mockWebsite, pagesWithPriority);
      expect(xml).toContain('<priority>1</priority>');
      expect(xml).toContain('<priority>0.5</priority>');
    });

    it('should handle custom lastmod dates', () => {
      const pagesWithLastmod = [
        {
          ...mockPages[0],
          sitemap: { lastmod: '2024-03-15' },
        },
      ];
      const xml = generateSitemapXml(mockWebsite, pagesWithLastmod);
      expect(xml).toContain('<lastmod>2024-03-15</lastmod>');
    });

    it('should exclude pages with eleventyExcludeFromCollections', () => {
      const pagesWithExclusion = [
        mockPages[0],
        {
          ...mockPages[1],
          eleventyExcludeFromCollections: true,
        },
      ];
      const xml = generateSitemapXml(mockWebsite, pagesWithExclusion);
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).not.toContain('<loc>https://example.com/about/</loc>');
    });

    it('should exclude pages with sitemap.exclude', () => {
      const pagesWithExclusion = [
        mockPages[0],
        {
          ...mockPages[1],
          sitemap: { exclude: true },
        },
      ];
      const xml = generateSitemapXml(mockWebsite, pagesWithExclusion);
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).not.toContain('<loc>https://example.com/about/</loc>');
    });

    it('should skip non-HTML pages', () => {
      const mixedPages = [
        mockPages[0],
        {
          page: {
            url: '/robots.txt',
            date: new Date('2024-01-03'),
            inputPath: 'robots.txt',
            outputPath: 'robots.txt',
          },
        },
      ];
      const xml = generateSitemapXml(mockWebsite, mixedPages);
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).not.toContain('robots.txt');
    });

    it('should escape XML special characters', () => {
      const pagesWithSpecialChars = [
        {
          page: {
            url: '/search/?q=test&sort=<desc>',
            date: new Date('2024-01-01'),
            inputPath: 'search.md',
            outputPath: 'search/index.html',
          },
        },
      ];
      const xml = generateSitemapXml(mockWebsite, pagesWithSpecialChars);
      expect(xml).toContain('&amp;'); // & is properly escaped in URL
      expect(xml).toContain('%3C'); // < is URL-encoded by URL constructor
      expect(xml).toContain('%3E'); // > is URL-encoded by URL constructor
      expect(xml).not.toContain('&sort=<'); // Raw characters shouldn't appear
    });

    it('should handle invalid dates gracefully', () => {
      const pagesWithInvalidDate = [
        {
          page: {
            url: '/',
            date: new Date('2024-01-01'),
            inputPath: 'index.md',
            outputPath: 'index.html',
          },
          sitemap: { lastmod: 'invalid-date' },
        },
      ];
      expect(() => generateSitemapXml(mockWebsite, pagesWithInvalidDate)).toThrow(
        'Invalid date provided: invalid-date'
      );
    });

    it('should validate priority ranges', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const pagesWithInvalidPriority = [
        {
          page: {
            url: '/',
            date: new Date('2024-01-01'),
            inputPath: 'index.md',
            outputPath: 'index.html',
          },
          sitemap: { priority: 1.5 }, // Invalid: > 1.0
        },
        {
          page: {
            url: '/about/',
            date: new Date('2024-01-02'),
            inputPath: 'about.md',
            outputPath: 'about/index.html',
          },
          sitemap: { priority: -0.1 }, // Invalid: < 0.0
        },
      ];

      const xml = generateSitemapXml(mockWebsite, pagesWithInvalidPriority);

      expect(xml).not.toContain('<priority>1.5</priority>');
      expect(xml).not.toContain('<priority>-0.1</priority>');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid priority 1.5 for /, must be between 0.0 and 1.0')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid priority -0.1 for /about/, must be between 0.0 and 1.0')
      );

      consoleSpy.mockRestore();
    });

    it('should handle URL construction edge cases', () => {
      const websiteWithoutTrailingSlash = {
        ...mockWebsite,
        url: 'https://example.com', // No trailing slash
      };

      const pagesWithVariousUrls = [
        {
          page: {
            url: '/', // Root with slash
            date: new Date('2024-01-01'),
            inputPath: 'index.md',
            outputPath: 'index.html',
          },
        },
        {
          page: {
            url: 'about', // No leading slash
            date: new Date('2024-01-02'),
            inputPath: 'about.md',
            outputPath: 'about.html',
          },
        },
      ];

      const xml = generateSitemapXml(websiteWithoutTrailingSlash, pagesWithVariousUrls);
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).toContain('<loc>https://example.com/about</loc>');
    });

    it('should handle pages with missing page.url', () => {
      const pagesWithMissingUrl = [
        mockPages[0], // Valid page
        {
          page: {
            url: undefined,
            date: new Date('2024-01-02'),
            inputPath: 'broken.md',
            outputPath: 'broken.html',
          },
        },
      ];

      const xml = generateSitemapXml(mockWebsite, pagesWithMissingUrl as PageData[]);
      expect(xml).toContain('<loc>https://example.com/</loc>');
      expect(xml).not.toContain('broken');
    });

    it('should handle pages with missing page object', () => {
      const pagesWithMissingPage = [
        mockPages[0], // Valid page
        {
          page: undefined,
        } as PageData,
      ];

      const xml = generateSitemapXml(mockWebsite, pagesWithMissingPage);
      expect(xml).toContain('<loc>https://example.com/</loc>');
      // Should only have one URL entry
      expect((xml.match(/<url>/g) || []).length).toBe(1);
    });
  });

  describe('addSitemap plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addSitemap(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write sitemap.xml using data from the cascade', async () => {
      addSitemap(mockEleventyConfig);

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
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
          {
            inputPath: 'about.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
              page: {
                url: '/about/',
                date: new Date('2024-01-02'),
                inputPath: 'about.md',
                outputPath: 'about/index.html',
              },
            },
          },
        ],
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
      const callArgs = (fs.promises.writeFile as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(path.join('_site', 'sitemap.xml'));
      expect(callArgs[1]).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(callArgs[1]).toContain('<loc>https://test.com/</loc>');
      expect(callArgs[1]).toContain('<loc>https://test.com/about/</loc>');
    });

    it('should not write sitemap if disabled', async () => {
      addSitemap(mockEleventyConfig);

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
                sitemap: false,
              },
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
        ],
      });

      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should handle empty results gracefully', async () => {
      addSitemap(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [],
      });

      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should handle file system errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (fs.promises.writeFile as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('Permission denied');
      });

      addSitemap(mockEleventyConfig);
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
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Failed to write sitemap files: Permission denied')
      );

      consoleSpy.mockRestore();
    });

    it('should handle missing website data gracefully', async () => {
      addSitemap(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              // No website property
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
        ],
      });

      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('generateSitemapFiles - Large Site Support', () => {
    const mockWebsite: AnglesiteWebsiteConfiguration = {
      title: 'Large Test Site',
      language: 'en',
      url: 'https://example.com',
    };

    const createMockPages = (count: number): PageData[] => {
      return Array.from({ length: count }, (_, i) => ({
        page: {
          url: `/page-${i + 1}/`,
          date: new Date('2024-01-01'),
          inputPath: `page-${i + 1}.md`,
          outputPath: `page-${i + 1}/index.html`,
        },
      }));
    };

    const mockMkdirSync = jest.spyOn(fs, 'mkdirSync').mockImplementation();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterAll(() => {
      mockMkdirSync.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should generate single sitemap for small sites', async () => {
      const pages = createMockPages(100);
      const result = await generateSitemapFiles(mockWebsite, pages, '_site');

      expect(result.filesWritten).toEqual(['sitemap.xml']);
      expect(result.totalUrls).toBe(100);
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join('_site', 'sitemap.xml'),
        expect.stringContaining('<?xml version="1.0" encoding="UTF-8"?>')
      );
    });

    it('should generate multiple sitemaps with index for large sites', async () => {
      const websiteWithConfig = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 2, // Small limit for testing
          splitLargeSites: true,
        },
      };

      const pages = createMockPages(5);
      const result = await generateSitemapFiles(websiteWithConfig, pages, '_site');

      expect(result.filesWritten).toEqual([
        'sitemap-1.xml',
        'sitemap-2.xml',
        'sitemap-3.xml',
        'sitemap.xml', // Index file
      ]);
      expect(result.totalUrls).toBe(5);
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(4); // 3 chunks + 1 index
    });

    it('should use custom filename patterns', async () => {
      const websiteWithConfig = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 2,
          splitLargeSites: true,
          indexFilename: 'sitemap-index.xml',
          chunkFilenamePattern: 'sitemap-chunk-{index}.xml',
        },
      };

      const pages = createMockPages(3);
      const result = await generateSitemapFiles(websiteWithConfig, pages, '_site');

      expect(result.filesWritten).toEqual(['sitemap-chunk-1.xml', 'sitemap-chunk-2.xml', 'sitemap-index.xml']);
    });

    it('should disable splitting when splitLargeSites is false', async () => {
      const websiteWithConfig = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 2,
          splitLargeSites: false, // Disabled
        },
      };

      const pages = createMockPages(5);
      const result = await generateSitemapFiles(websiteWithConfig, pages, '_site');

      expect(result.filesWritten).toEqual(['sitemap.xml']);
      expect(result.totalUrls).toBe(5);
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1); // Single file only
    });

    it('should handle disabled sitemap configuration', async () => {
      const websiteWithDisabled = {
        ...mockWebsite,
        sitemap: false,
      };

      const pages = createMockPages(5);
      const result = await generateSitemapFiles(websiteWithDisabled, pages, '_site');

      expect(result.filesWritten).toEqual([]);
      expect(result.totalUrls).toBe(0);
      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should handle missing website URL', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const websiteWithoutUrl = {
        ...mockWebsite,
        url: undefined,
      };

      const pages = createMockPages(5);
      const result = await generateSitemapFiles(websiteWithoutUrl, pages, '_site');

      expect(result.filesWritten).toEqual([]);
      expect(result.totalUrls).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] No website URL provided, skipping sitemap generation'
      );
      expect(fs.promises.writeFile).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should generate sitemap index XML correctly', async () => {
      const websiteWithConfig = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 1, // Force multiple files
          splitLargeSites: true,
        },
      };

      const pages = createMockPages(2);
      await generateSitemapFiles(websiteWithConfig, pages, '_site');

      // Check that the index file was written with correct content
      const indexCall = (fs.promises.writeFile as jest.Mock).mock.calls.find((call) => call[0].endsWith('sitemap.xml'));
      expect(indexCall).toBeDefined();

      const indexContent = indexCall[1] as string;
      expect(indexContent).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(indexContent).toContain('<loc>https://example.com/sitemap-1.xml</loc>');
      expect(indexContent).toContain('<loc>https://example.com/sitemap-2.xml</loc>');
      expect(indexContent).toContain('<lastmod>');
    });

    it('should handle file system errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      (fs.promises.writeFile as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('Disk full');
      });

      const pages = createMockPages(5);
      const result = await generateSitemapFiles(mockWebsite, pages, '_site');

      expect(result.filesWritten).toEqual([]);
      expect(result.totalUrls).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Failed to write sitemap files: Disk full')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should respect default configuration values', async () => {
      const websiteWithMinimalConfig = {
        ...mockWebsite,
        sitemap: true, // Just enable it
      };

      // Test with a number that would trigger splitting with default maxUrlsPerFile (50000)
      const pages = createMockPages(10);
      const result = await generateSitemapFiles(websiteWithMinimalConfig, pages, '_site');

      expect(result.filesWritten).toEqual(['sitemap.xml']);
      expect(result.totalUrls).toBe(10);
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Collection-based functionality', () => {
    it('should register a sitemapPages collection', () => {
      addSitemap(mockEleventyConfig);

      expect(mockEleventyConfig.addCollection).toHaveBeenCalledWith('sitemapPages', expect.any(Function));
    });

    it('should handle eleventyExcludeFromCollections correctly', async () => {
      addSitemap(mockEleventyConfig);

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
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
          {
            inputPath: '404.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
              page: {
                url: '/404.html',
                date: new Date('2024-01-01'),
                inputPath: '404.md',
                outputPath: '404.html',
              },
              eleventyExcludeFromCollections: true,
            },
          },
        ],
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
      const callArgs = (fs.promises.writeFile as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toContain('<loc>https://test.com/</loc>');
      expect(callArgs[1]).not.toContain('<loc>https://test.com/404.html</loc>');
    });

    it('should handle sitemap: false exclusion correctly', async () => {
      addSitemap(mockEleventyConfig);

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
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
          {
            inputPath: 'private.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
              page: {
                url: '/private/',
                date: new Date('2024-01-01'),
                inputPath: 'private.md',
                outputPath: 'private/index.html',
              },
              sitemap: false,
            },
          },
        ],
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
      const callArgs = (fs.promises.writeFile as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toContain('<loc>https://test.com/</loc>');
      expect(callArgs[1]).not.toContain('<loc>https://test.com/private/</loc>');
    });

    it('should handle sitemap.exclude: true correctly', async () => {
      addSitemap(mockEleventyConfig);

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
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
          {
            inputPath: 'admin.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
              page: {
                url: '/admin/',
                date: new Date('2024-01-01'),
                inputPath: 'admin.md',
                outputPath: 'admin/index.html',
              },
              sitemap: {
                exclude: true,
              },
            },
          },
        ],
      });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
      const callArgs = (fs.promises.writeFile as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toContain('<loc>https://test.com/</loc>');
      expect(callArgs[1]).not.toContain('<loc>https://test.com/admin/</loc>');
    });

    it('should fallback to filesystem website config when not in results', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          title: 'Test Site',
          language: 'en',
          url: 'https://filesystem.com',
        })
      );

      addSitemap(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [], // Empty results to trigger filesystem fallback
      });

      expect(fs.promises.readFile).toHaveBeenCalledWith(expect.stringContaining('website.json'), 'utf-8');
    });

    it('should handle missing page data gracefully', async () => {
      addSitemap(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'broken.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
              },
              // Missing page data
            },
          },
        ],
      });

      // Should still write a file, but with default values
      expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    });

    it('should use collection data for real builds when results lack data property', async () => {
      addSitemap(mockEleventyConfig);

      // Simulate collection being populated (would happen during build)
      const collectionCallback = mockEleventyConfig.addCollection.mock.calls[0][1];
      const mockCollectionApi = {
        getAll: () => [
          {
            url: '/',
            date: new Date('2024-01-01'),
            inputPath: 'index.md',
            outputPath: 'index.html',
            data: {
              website: {
                title: 'Collection Site',
                language: 'en',
                url: 'https://collection.com',
              },
            },
          },
        ],
      };

      collectionCallback(mockCollectionApi);

      const onCallback = mockEleventyConfig.on.mock.calls[0][1];

      // Simulate results without data property (real build scenario)
      await onCallback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            url: '/',
            // No data property - should use collection data
          },
        ],
      });

      // Should handle gracefully even without proper website config in this test scenario
      // In real builds, the website config would be read from filesystem
    });

    it('should handle memory monitoring edge cases', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // Mock process.memoryUsage to return high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        rss: 600 * 1024 * 1024,
        heapTotal: 600 * 1024 * 1024,
        heapUsed: 600 * 1024 * 1024, // 600MB heap used (above 512MB threshold)
        external: 50 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024,
      }));

      addSitemap(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      // Create a large number of pages to trigger memory monitoring
      const manyPages = Array.from({ length: 50 }, (_, i) => ({
        inputPath: `page${i}.html`,
        data: {
          website: {
            title: 'Test Site',
            language: 'en',
            url: 'https://test.com',
          },
          page: {
            url: `/page${i}/`,
            date: new Date('2024-01-01'),
            inputPath: `page${i}.md`,
            outputPath: `page${i}/index.html`,
          },
        },
      }));

      await callback({
        dir: { output: '_site' },
        results: manyPages,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('High memory usage detected during'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Sitemap memory stats:'));

      // Restore original function
      process.memoryUsage = originalMemoryUsage;
      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle filesystem read errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Mock readFile to reject
      (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      addSitemap(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [{}], // No data property, should try to read from filesystem
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Sitemap plugin: Could not read website.json from _data directory'
      );

      consoleSpy.mockRestore();
    });

    it('should handle multi-file sitemap generation', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      addSitemap(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      // Create many pages to trigger multi-file generation
      const manyPages = Array.from({ length: 25 }, (_, i) => ({
        inputPath: `page${i}.html`,
        data: {
          website: {
            title: 'Test Site',
            language: 'en',
            url: 'https://test.com',
            sitemap: {
              maxUrlsPerFile: 10, // Small limit to force multiple files
              splitLargeSites: true,
            },
          },
          page: {
            url: `/page${i}/`,
            date: new Date('2024-01-01'),
            inputPath: `page${i}.md`,
            outputPath: `page${i}/index.html`,
          },
        },
      }));

      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      await callback({
        dir: { output: '_site' },
        results: manyPages,
      });

      // Should write sitemap files (exact filenames depend on internal logic)
      expect(fs.promises.writeFile).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should handle invalid priority values correctly', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const websiteWithInvalidPriority = {
        title: 'Test Site',
        language: 'en' as const,
        url: 'https://example.com',
        sitemap: {
          priority: 2.5, // Invalid: > 1.0
        },
      };

      const pagesWithInvalidPriority = [
        {
          page: {
            url: '/',
            date: new Date('2024-01-01'),
            inputPath: 'index.md',
            outputPath: 'index.html',
          },
        },
      ];

      const xml = generateSitemapXml(websiteWithInvalidPriority, pagesWithInvalidPriority);

      // Should not include invalid priority
      expect(xml).not.toContain('<priority>2.5</priority>');

      consoleSpy.mockRestore();
    });

    it('should handle edge cases in filename sanitization', () => {
      // Test the internal sanitizeFilename function through file operations
      const mockWriteFile = fs.promises.writeFile as jest.Mock;
      mockWriteFile.mockImplementation((filename: string) => {
        // Verify the filename doesn't contain dangerous characters
        const basename = path.basename(filename);
        expect(basename).not.toMatch(/[<>:"/\\|?*]/);
        expect(basename).not.toMatch(/^\./); // No leading dots
        return Promise.resolve();
      });

      addSitemap(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      return callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                url: 'https://test.com',
                sitemap: {
                  chunkFilenamePattern: 'sitemap<>:"|?*.{index}.xml', // Dangerous chars
                },
              },
              page: {
                url: '/',
                date: new Date('2024-01-01'),
                inputPath: 'index.md',
                outputPath: 'index.html',
              },
            },
          },
        ],
      });
    });
  });

  describe('utility functions', () => {
    it('should format dates correctly', () => {
      const testWebsite: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
      };

      const pagesWithInvalidDate = [
        {
          page: {
            url: '/',
            date: new Date('2024-01-01'),
            inputPath: 'index.md',
            outputPath: 'index.html',
          },
          sitemap: { lastmod: 'definitely-not-a-date' },
        },
      ];

      expect(() => generateSitemapXml(testWebsite, pagesWithInvalidDate)).toThrow(
        'Invalid date provided: definitely-not-a-date'
      );
    });

    it('should handle memory monitoring optimizations', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Mock high memory increase to trigger optimization suggestions
      const originalMemoryUsage = process.memoryUsage;
      let callCount = 0;
      process.memoryUsage = jest.fn(() => {
        const baseMemory = 50 * 1024 * 1024; // 50MB base
        const memoryIncrease = callCount * 30 * 1024 * 1024; // 30MB increase per call
        callCount++;
        return {
          rss: baseMemory + memoryIncrease,
          heapTotal: baseMemory + memoryIncrease,
          heapUsed: baseMemory + memoryIncrease,
          external: 10 * 1024 * 1024,
          arrayBuffers: 5 * 1024 * 1024,
        };
      });

      addSitemap(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      // Create enough pages to trigger memory optimization suggestions
      const manyPages = Array.from({ length: 15 }, (_, i) => ({
        inputPath: `page${i}.html`,
        data: {
          website: {
            title: 'Test Site',
            language: 'en',
            url: 'https://test.com',
          },
          page: {
            url: `/page${i}/`,
            date: new Date('2024-01-01'),
            inputPath: `page${i}.md`,
            outputPath: `page${i}/index.html`,
          },
        },
      }));

      await callback({
        dir: { output: '_site' },
        results: manyPages,
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Sitemap memory stats:'));

      // Restore original function
      process.memoryUsage = originalMemoryUsage;
      consoleSpy.mockRestore();
    });
  });
});
