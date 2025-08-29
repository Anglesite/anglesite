import * as fs from 'fs';
import { generateSitemapFiles } from '../../plugins/sitemap.js';
import type { AnglesiteWebsiteConfiguration, PageData } from '../../types/index.js';

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

describe('sitemap memory monitoring', () => {
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

  describe('memory monitoring', () => {
    it('should log memory statistics for normal sitemap generation', async () => {
      const pages: PageData[] = Array.from({ length: 100 }, (_, i) => ({
        website: mockWebsite,
        page: {
          url: `/page-${i}/`,
          date: new Date('2024-01-01'),
          inputPath: `page-${i}.md`,
          outputPath: `page-${i}.html`,
        },
      }));

      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await generateSitemapFiles(mockWebsite, pages, '/output');

      expect(result.totalUrls).toBe(100);
      expect(result.filesWritten).toHaveLength(1);

      // Should log memory monitoring start message
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Starting sitemap generation with memory monitoring (100 pages)')
      );

      // Should log memory statistics
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[@dwk\/anglesite-11ty\] Sitemap memory stats: Peak: \d+MB, Start: \d+MB, Increase: [+-]?\d+MB, Avg\/page: \d+\.\d+MB, Files: 1, Pages: 100/
        )
      );
    });

    it('should log memory statistics for large sites with multiple files', async () => {
      const websiteWithSmallChunks = {
        ...mockWebsite,
        sitemap: {
          enabled: true,
          maxUrlsPerFile: 50, // Force multiple files
          splitLargeSites: true,
        },
      };

      const pages: PageData[] = Array.from({ length: 150 }, (_, i) => ({
        website: websiteWithSmallChunks,
        page: {
          url: `/page-${i}/`,
          date: new Date('2024-01-01'),
          inputPath: `page-${i}.md`,
          outputPath: `page-${i}.html`,
        },
      }));

      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await generateSitemapFiles(websiteWithSmallChunks, pages, '/output');

      expect(result.totalUrls).toBe(150);
      expect(result.filesWritten.length).toBeGreaterThan(1); // Multiple sitemap files

      // Should log memory monitoring start message
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Starting sitemap generation with memory monitoring (150 pages)')
      );

      // Should log memory statistics with correct file count
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `\\[@dwk\\/anglesite-11ty\\] Sitemap memory stats: Peak: \\d+MB, Start: \\d+MB, Increase: [+-]?\\d+MB, Avg\\/page: \\d+\\.\\d+MB, Files: ${result.filesWritten.length}, Pages: 150`
          )
        )
      );
    });

    it('should handle memory monitoring when sitemap is disabled', async () => {
      const websiteDisabled = {
        ...mockWebsite,
        sitemap: false,
      };

      const pages: PageData[] = [
        {
          website: websiteDisabled,
          page: {
            url: '/test/',
            date: new Date('2024-01-01'),
            inputPath: 'test.md',
            outputPath: 'test.html',
          },
        },
      ];

      const result = await generateSitemapFiles(websiteDisabled, pages, '/output');

      expect(result.totalUrls).toBe(0);
      expect(result.filesWritten).toHaveLength(0);

      // Should not log memory monitoring when sitemap is disabled
      expect(consoleSpy.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Starting sitemap generation with memory monitoring')
      );
    });

    it('should include memory stats in error context when sitemap fails', async () => {
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
      (fs.promises.writeFile as jest.Mock).mockRejectedValue(new Error('File system error'));

      const result = await generateSitemapFiles(mockWebsite, pages, '/output');

      expect(result).toEqual({ filesWritten: [], totalUrls: 0 });

      // Should still log memory monitoring start
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] Starting sitemap generation with memory monitoring (1 pages)')
      );

      // Should log error details
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write sitemap files: File system error'
      );
    });
  });

  describe('memory usage context', () => {
    it('should provide proper context strings for different operations', async () => {
      const pages: PageData[] = Array.from({ length: 10 }, (_, i) => ({
        website: mockWebsite,
        page: {
          url: `/page-${i}/`,
          date: new Date('2024-01-01'),
          inputPath: `page-${i}.md`,
          outputPath: `page-${i}.html`,
        },
      }));

      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      await generateSitemapFiles(mockWebsite, pages, '/output');

      // Verify that memory monitoring start is logged with page count
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Starting sitemap generation with memory monitoring (10 pages)'
      );

      // Verify that memory statistics are logged
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[@dwk\/anglesite-11ty\] Sitemap memory stats:.*Files: 1, Pages: 10/)
      );
    });
  });
});
