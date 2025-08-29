import * as fs from 'fs';
import { generateSitemapFiles, safeUrlConstruction } from '../../plugins/sitemap.js';
import type { AnglesiteWebsiteConfiguration, PageData } from '../../types/index.js';

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

describe('sitemap error handling', () => {
  const mockWebsite: AnglesiteWebsiteConfiguration = {
    title: 'Test Site',
    language: 'en',
    url: 'https://example.com',
  };

  const consoleSpy = {
    error: jest.spyOn(console, 'error').mockImplementation(),
    warn: jest.spyOn(console, 'warn').mockImplementation(),
    log: jest.spyOn(console, 'log').mockImplementation(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy.error.mockClear();
    consoleSpy.warn.mockClear();
    consoleSpy.log.mockClear();
  });

  afterAll(() => {
    Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
  });

  describe('safeUrlConstruction', () => {
    it('should handle invalid URLs gracefully', () => {
      const baseUrl = new URL('https://example.com');
      const invalidUrl = 'http://[invalid-ipv6-brackets';

      const result = safeUrlConstruction(invalidUrl, baseUrl, 'test-context');

      expect(result).toBeNull();
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Invalid URL in test-context: http://[invalid-ipv6-brackets')
      );
    });

    it('should construct valid URLs successfully', () => {
      const baseUrl = new URL('https://example.com');
      const validUrl = '/test-page/';

      const result = safeUrlConstruction(validUrl, baseUrl, 'test-context');

      expect(result).toBe('https://example.com/test-page/');
      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });
  });

  describe('generateSitemapFiles error context', () => {
    it('should provide detailed error context for file system failures', async () => {
      const pages: PageData[] = [
        {
          website: mockWebsite,
          page: {
            url: '/test/',
            date: new Date('2024-01-01'),
            inputPath: 'test.md',
            outputPath: 'test.html',
          },
        },
      ];

      // Mock file system failure
      (fs.promises.writeFile as jest.Mock).mockRejectedValue(new Error('ENOSPC: no space left on device'));

      const result = await generateSitemapFiles(mockWebsite, pages, '/output');

      expect(result).toEqual({ filesWritten: [], totalUrls: 0 });
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write sitemap files: ENOSPC: no space left on device'
      );
      expect(consoleSpy.error).toHaveBeenCalledWith('[@dwk/anglesite-11ty] Site context: 1 pages, output: /output');
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Config: maxUrls=50000, split=true')
      );
    });

    it('should provide batch processing error context for large sites', async () => {
      const websiteWithSmallChunks = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 1, // Force multiple files
          splitLargeSites: true,
        },
      };

      const pages: PageData[] = [
        {
          website: websiteWithSmallChunks,
          page: {
            url: '/page1/',
            date: new Date('2024-01-01'),
            inputPath: 'page1.md',
            outputPath: 'page1.html',
          },
        },
        {
          website: websiteWithSmallChunks,
          page: {
            url: '/page2/',
            date: new Date('2024-01-01'),
            inputPath: 'page2.md',
            outputPath: 'page2.html',
          },
        },
      ];

      // Mock file system failure on second chunk
      let callCount = 0;
      (fs.promises.writeFile as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          // Fail on second chunk
          throw new Error('Write failed on chunk 2');
        }
        return Promise.resolve();
      });

      const result = await generateSitemapFiles(websiteWithSmallChunks, pages, '/output');

      expect(result).toEqual({ filesWritten: [], totalUrls: 0 });
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Failed to write sitemap chunk')
      );
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Chunk context: 1 URLs')
      );
    });

    it('should provide sitemap index generation error context', async () => {
      const websiteWithSmallChunks = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 1,
          splitLargeSites: true,
        },
      };

      const pages: PageData[] = [
        {
          website: websiteWithSmallChunks,
          page: {
            url: '/page1/',
            date: new Date('2024-01-01'),
            inputPath: 'page1.md',
            outputPath: 'page1.html',
          },
        },
        {
          website: websiteWithSmallChunks,
          page: {
            url: '/page2/',
            date: new Date('2024-01-01'),
            inputPath: 'page2.md',
            outputPath: 'page2.html',
          },
        },
      ];

      // Mock successful chunk writes but fail on index
      (fs.promises.writeFile as jest.Mock).mockImplementation(async (path: string) => {
        if (path.endsWith('sitemap.xml')) {
          throw new Error('Index write failed');
        }
        return Promise.resolve();
      });

      const result = await generateSitemapFiles(websiteWithSmallChunks, pages, '/output');

      expect(result).toEqual({ filesWritten: [], totalUrls: 0 });
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write sitemap index: Index write failed'
      );
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Index context: 2 entries, chunks: 2')
      );
    });

    it('should handle pages with invalid URLs gracefully', async () => {
      const pages: PageData[] = [
        {
          website: mockWebsite,
          page: {
            url: '/valid-page/',
            date: new Date('2024-01-01'),
            inputPath: 'valid.md',
            outputPath: 'valid.html',
          },
        },
        {
          website: mockWebsite,
          page: {
            url: 'http://[invalid-ipv6-syntax',
            date: new Date('2024-01-01'),
            inputPath: 'invalid.md',
            outputPath: 'invalid.html',
          },
        },
      ];

      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await generateSitemapFiles(mockWebsite, pages, '/output');

      expect(result.totalUrls).toBe(2); // Both pages are counted in total
      expect(result.filesWritten).toHaveLength(1); // Single sitemap file
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Invalid URL in page invalid.md:')
      );
    });
  });
});
