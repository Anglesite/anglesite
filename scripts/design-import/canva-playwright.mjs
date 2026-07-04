#!/usr/bin/env node

// Playwright-based Canva published site extraction.
//
// Extracts design tokens (colors, fonts) and structured content (sections,
// navigation, images) from Canva published sites in a single browser session.
// Returns data that maps directly to Anglesite's design token pipeline.
//
// Usage (CLI):
//   node canva-playwright.mjs <url> [--content-only]
//
// Playwright is an optional dependency. Install it with:
//   npm install playwright && npx playwright install chromium

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseInlineColors, rankColors, inferColorRoles } from './canva-colors.mjs';
import { parseCanvaFonts } from './canva-fonts.mjs';

// ---------------------------------------------------------------------------
// Browser-context evaluation functions (run inside page.evaluate)
// These use browser APIs only and cannot be unit tested in Node.
// ---------------------------------------------------------------------------

/**
 * Scan all visible elements' inline style attributes for colors.
 * Read @font-face rules from stylesheets.
 *
 * @returns {{ styles: string[], fontFaces: { family: string }[] }}
 */
export const extractStylesSrc = function () {
  const styles = [];
  const fontFaces = [];

  // Collect inline style attributes from all elements
  for (const el of document.querySelectorAll('[style]')) {
    const style = el.getAttribute('style');
    if (style) styles.push(style);
  }

  // Read @font-face rules from all accessible stylesheets
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const family = rule.style.getPropertyValue('font-family')
            .trim()
            .replace(/['"]/g, '');
          if (family) fontFaces.push({ family });
        }
      }
    } catch {
      // Cross-origin stylesheet — skip
    }
  }

  return { styles, fontFaces };
};

/**
 * Find <section> elements, read children's positions/sizes/content.
 * Skips SVGs and container divs — only grabs leaf elements with content.
 *
 * @returns {Array<{ id: string, bounds: Object, elements: Array }>}
 */
export const extractSectionsSrc = function () {
  const sections = [];

  const isLeaf = (el) => {
    // Skip SVG subtrees
    if (el.closest('svg')) return false;
    // A leaf has no child elements with visible content
    const children = Array.from(el.children);
    if (children.length === 0) return true;
    // Container divs: has children but no direct text or src
    const hasDirectText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0,
    );
    const isSelfImage = el.tagName === 'IMG';
    return hasDirectText || isSelfImage;
  };

  for (const section of document.querySelectorAll('section')) {
    const sectionRect = section.getBoundingClientRect();
    const sectionData = {
      id: section.id || section.getAttribute('data-section-id') || `section-${sections.length}`,
      bounds: {
        x: Math.round(sectionRect.left + window.scrollX),
        y: Math.round(sectionRect.top + window.scrollY),
        width: Math.round(sectionRect.width),
        height: Math.round(sectionRect.height),
      },
      elements: [],
    };

    // Walk all descendants for leaf nodes with content
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!isLeaf(el)) continue;

      const textContent = el.textContent?.trim() || '';
      const src = el.tagName === 'IMG' ? (el.getAttribute('src') || null) : null;

      // Skip elements with no content
      if (!textContent && !src) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const inlineStyle = el.getAttribute('style') || '';
      // Parse key style properties from inline style
      const styleMatch = {
        fontSize: inlineStyle.match(/font-size\s*:\s*([^;]+)/)?.[1]?.trim() || null,
        fontFamily: inlineStyle.match(/font-family\s*:\s*([^;]+)/)?.[1]?.trim().replace(/['"]/g, '') || null,
        color: inlineStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1]?.trim() || null,
      };

      sectionData.elements.push({
        tagName: el.tagName,
        textContent,
        style: styleMatch,
        bounds: {
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        src,
      });
    }

    sections.push(sectionData);
  }

  return sections;
};

/**
 * Read <nav> links. Fallback: header links if no nav.
 *
 * @returns {Array<{ label: string, path: string }>}
 */
export const extractNavSrc = function () {
  const links = [];
  const seen = new Set();

  // Try <nav> first
  let navEls = Array.from(document.querySelectorAll('nav a[href]'));

  // Fallback to header links
  if (navEls.length === 0) {
    const header = document.querySelector('header');
    if (header) {
      navEls = Array.from(header.querySelectorAll('a[href]'));
    }
  }

  for (const a of navEls) {
    const label = a.textContent?.trim();
    const path = a.getAttribute('href');
    if (!label || !path || seen.has(path)) continue;
    // Skip anchor-only links and external links
    if (path.startsWith('#')) continue;
    seen.add(path);
    links.push({ label, path });
  }

  return links;
};

/**
 * Collect all <img> src URLs, deduplicated.
 *
 * @returns {Array<{ src: string, alt: string }>}
 */
export const extractImagesSrc = function () {
  const seen = new Set();
  const images = [];

  for (const img of document.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (!src || seen.has(src)) continue;
    seen.add(src);
    images.push({ src, alt: img.getAttribute('alt') || '' });
  }

  return images;
};

// ---------------------------------------------------------------------------
// Node-context: pure data transform (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Transform raw browser evaluation data into structured sections.
 *
 * Key transforms:
 * - tagName === 'IMG' || src !== null → type: 'image', content: src
 * - Otherwise → type: 'text', content: textContent.trim()
 * - fontSize string '48px' → number 48 (parseInt)
 * - Index assigned from array position
 *
 * @param {Array} rawSections - Raw data from extractSectionsSrc via page.evaluate
 * @returns {Array<{ index: number, bounds: Object, elements: Array }>}
 */
export function buildSectionData(rawSections) {
  return rawSections.map((section, index) => ({
    index,
    bounds: section.bounds,
    elements: (section.elements || []).map((el) => {
      const isImage = el.tagName === 'IMG' || el.src !== null;
      const style = el.style || {};

      return {
        type: isImage ? 'image' : 'text',
        content: isImage ? el.src : (el.textContent || '').trim(),
        style: {
          fontSize: style.fontSize != null ? parseInt(style.fontSize, 10) || undefined : undefined,
          fontFamily: style.fontFamily != null ? style.fontFamily : undefined,
          color: style.color != null ? style.color : undefined,
        },
        bounds: el.bounds,
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Extract content and design tokens from a single Canva published page.
 *
 * @param {import('playwright').Page} page - An open Playwright page
 * @param {string} url - The URL to navigate to
 * @param {Object} [options]
 * @param {boolean} [options.contentOnly] - Skip token extraction (colors/fonts)
 * @returns {Promise<{ tokens: Object|null, sections: Array, navigation: Array, images: Array }>}
 */
export async function extractCanvaPage(page, url, options = {}) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for Canva SPA to render sections
  await page.waitForSelector('section', { timeout: 10000 }).catch(() => {});
  // Extra delay for SPA hydration
  await page.waitForTimeout(2000);

  let tokens = null;

  if (!options.contentOnly) {
    const { styles, fontFaces } = await page.evaluate(extractStylesSrc);
    const hexColors = parseInlineColors(styles);
    const ranked = rankColors(hexColors);
    const colorRoles = inferColorRoles(ranked);
    const fontTokens = parseCanvaFonts(fontFaces);
    tokens = { colors: colorRoles, fonts: fontTokens };
  }

  const rawSections = await page.evaluate(extractSectionsSrc);
  const sections = buildSectionData(rawSections);

  const navigation = await page.evaluate(extractNavSrc);
  const images = await page.evaluate(extractImagesSrc);

  return { tokens, sections, navigation, images };
}

/**
 * Crawl an entire Canva published site with an already-open page.
 * Visits homepage for tokens, then discovers subpages from nav and visits each
 * with contentOnly: true. Backend-agnostic: `page` may be a Playwright page or
 * any object with the same goto/waitForSelector/waitForTimeout/evaluate subset
 * (see canva-safari.mjs).
 *
 * @param {import('playwright').Page} page - An open page
 * @param {string} baseUrl - Homepage URL of the published Canva site
 * @returns {Promise<{ tokens: Object, pages: Array, images: Array, navigation: Array }>}
 */
export async function crawlCanvaSite(page, baseUrl) {
  // Homepage extraction includes tokens
  const home = await extractCanvaPage(page, baseUrl, {});
  const { tokens, navigation } = home;

  const pages = [{ url: baseUrl, ...home }];
  const allImages = [...home.images];

  // Discover and visit subpages from navigation
  const visited = new Set([baseUrl]);
  for (const link of navigation) {
    const href = link.path;
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;

    // Resolve relative paths against base URL
    let pageUrl;
    try {
      pageUrl = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (visited.has(pageUrl)) continue;
    // Only visit pages on the same origin
    if (!pageUrl.startsWith(new URL(baseUrl).origin)) continue;

    visited.add(pageUrl);

    const subPage = await extractCanvaPage(page, pageUrl, { contentOnly: true });
    pages.push({ url: pageUrl, ...subPage });
    allImages.push(...subPage.images);
  }

  // Deduplicate images by src
  const seenSrcs = new Set();
  const uniqueImages = allImages.filter(({ src }) => {
    if (seenSrcs.has(src)) return false;
    seenSrcs.add(src);
    return true;
  });

  return { tokens, pages, images: uniqueImages, navigation };
}

/**
 * Extract tokens and content from an entire Canva published site.
 *
 * @param {string} baseUrl - Homepage URL of the published Canva site
 * @returns {Promise<{ tokens: Object, pages: Array, images: Array, navigation: Array }>}
 */
export async function extractCanvaSite(baseUrl) {
  let playwright;
  try {
    const require = createRequire(join(process.cwd(), 'package.json'));
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium',
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    return await crawlCanvaSite(page, baseUrl);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const contentOnly = args.includes('--content-only');
  const site = args.includes('--site');

  if (!url) {
    console.error('Usage: node canva-playwright.mjs <url> [--site] [--content-only]');
    console.error('  --site crawls nav-linked subpages too and returns { tokens, pages, images, navigation }');
    process.exitCode = 1;
    return;
  }

  if (site) {
    // extractCanvaSite manages its own browser lifecycle
    const result = await extractCanvaSite(url);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Resolve playwright from the user's project (cwd), not from the plugin
  // cache where this script lives. In ESM, bare `import('playwright')` would
  // resolve relative to *this file's* location, which fails when the script
  // is installed in ~/.claude/plugins/cache/. createRequire anchored to cwd
  // finds the project's node_modules instead.
  let playwright;
  try {
    const require = createRequire(join(process.cwd(), 'package.json'));
    playwright = require('playwright');
  } catch {
    console.error(
      'Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium',
    );
    process.exitCode = 1;
    return;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const result = await extractCanvaPage(page, url, { contentOnly });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

// Only run CLI when executed directly (rename-proof, unlike an endsWith check)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
