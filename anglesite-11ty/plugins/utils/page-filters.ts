import type { PageData } from '../../types/index.js';

/**
 * Checks if a page should be included in public-facing features like sitemaps.
 * @param page The page data to check.
 * @returns True if the page should be included, false otherwise.
 */
export function isPagePublic(page: PageData): boolean {
  // Skip pages that are excluded from collections
  if (page.eleventyExcludeFromCollections) {
    return false;
  }

  // Skip pages without a URL
  if (!page.page?.url) {
    return false;
  }

  return true;
}

/**
 * Checks if a page is an HTML page (suitable for sitemap inclusion).
 * @param page The page data to check.
 * @returns True if the page is HTML, false otherwise.
 */
export function isHtmlPage(page: PageData): boolean {
  // Skip non-HTML pages
  if (page.page?.outputPath && !page.page.outputPath.endsWith('.html')) {
    return false;
  }

  return true;
}

/**
 * Checks if a page should be included in a sitemap.
 * @param page The page data to check.
 * @returns True if the page should be included in the sitemap, false otherwise.
 */
export function isSitemapEligible(page: PageData): boolean {
  // First check if the page is public
  if (!isPagePublic(page)) {
    return false;
  }

  // Check if explicitly excluded from sitemap
  // sitemap: false or sitemap.exclude: true
  if (page.sitemap === false) {
    return false;
  }

  if (typeof page.sitemap === 'object' && page.sitemap?.exclude) {
    return false;
  }

  // Check if it's an HTML page
  if (!isHtmlPage(page)) {
    return false;
  }

  return true;
}

/**
 * Filters an array of pages to only include those eligible for sitemap.
 * @param pages Array of page data.
 * @returns Filtered array of pages.
 */
export function filterSitemapPages(pages: PageData[]): PageData[] {
  return pages.filter(isSitemapEligible);
}

/**
 * Filters an array of pages to only include public HTML pages.
 * @param pages Array of page data.
 * @returns Filtered array of pages.
 */
export function filterPublicHtmlPages(pages: PageData[]): PageData[] {
  return pages.filter((page) => isPagePublic(page) && isHtmlPage(page));
}
