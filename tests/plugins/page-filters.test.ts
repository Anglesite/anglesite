import {
  isPagePublic,
  isHtmlPage,
  isSitemapEligible,
  filterSitemapPages,
  filterPublicHtmlPages,
} from '../../plugins/utils/page-filters.js';
import type { PageData } from '../../types/index.js';

describe('page filters', () => {
  const createMockPage = (overrides: Partial<PageData> = {}): PageData => ({
    website: {
      title: 'Test Site',
      language: 'en',
    },
    page: {
      url: '/test/',
      date: new Date('2024-01-01'),
      inputPath: 'test.md',
      outputPath: 'test/index.html',
    },
    ...overrides,
  });

  describe('isPagePublic', () => {
    it('should return true for normal pages', () => {
      const page = createMockPage();
      expect(isPagePublic(page)).toBe(true);
    });

    it('should return false for excluded pages', () => {
      const page = createMockPage({ eleventyExcludeFromCollections: true });
      expect(isPagePublic(page)).toBe(false);
    });

    it('should return false for pages without URL', () => {
      const page = createMockPage({ page: undefined });
      expect(isPagePublic(page)).toBe(false);
    });
  });

  describe('isHtmlPage', () => {
    it('should return true for HTML pages', () => {
      const page = createMockPage();
      expect(isHtmlPage(page)).toBe(true);
    });

    it('should return true for pages without outputPath', () => {
      const page = createMockPage();
      page.page.outputPath = undefined!;
      expect(isHtmlPage(page)).toBe(true);
    });

    it('should return false for non-HTML pages', () => {
      const page = createMockPage();
      page.page.outputPath = 'test.xml';
      expect(isHtmlPage(page)).toBe(false);
    });
  });

  describe('isSitemapEligible', () => {
    it('should return true for eligible pages', () => {
      const page = createMockPage();
      expect(isSitemapEligible(page)).toBe(true);
    });

    it('should return false for excluded pages', () => {
      const page = createMockPage({ eleventyExcludeFromCollections: true });
      expect(isSitemapEligible(page)).toBe(false);
    });

    it('should return false for sitemap-excluded pages', () => {
      const page = createMockPage({ sitemap: { exclude: true } });
      expect(isSitemapEligible(page)).toBe(false);
    });

    it('should return false for non-HTML pages', () => {
      const page = createMockPage();
      page.page.outputPath = 'test.xml';
      expect(isSitemapEligible(page)).toBe(false);
    });
  });

  describe('filterSitemapPages', () => {
    it('should filter array correctly', () => {
      const pages = [
        createMockPage({ page: { url: '/page1/', date: new Date(), inputPath: 'page1.md', outputPath: 'page1.html' } }),
        createMockPage({ eleventyExcludeFromCollections: true }),
        createMockPage({ sitemap: { exclude: true } }),
        createMockPage({ page: { url: '/page2/', date: new Date(), inputPath: 'page2.md', outputPath: 'page2.html' } }),
      ];

      const filtered = filterSitemapPages(pages);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].page.url).toBe('/page1/');
      expect(filtered[1].page.url).toBe('/page2/');
    });
  });

  describe('filterPublicHtmlPages', () => {
    it('should filter public HTML pages correctly', () => {
      const pages = [
        createMockPage({ page: { url: '/page1/', date: new Date(), inputPath: 'page1.md', outputPath: 'page1.html' } }),
        createMockPage({ eleventyExcludeFromCollections: true }),
        createMockPage({ page: { url: '/page2/', date: new Date(), inputPath: 'page2.md', outputPath: 'page2.xml' } }),
        createMockPage({ page: { url: '/page3/', date: new Date(), inputPath: 'page3.md', outputPath: 'page3.html' } }),
      ];

      const filtered = filterPublicHtmlPages(pages);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].page.url).toBe('/page1/');
      expect(filtered[1].page.url).toBe('/page3/');
    });
  });
});
