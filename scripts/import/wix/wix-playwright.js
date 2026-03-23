#!/usr/bin/env node

// Playwright-based Wix content and style extraction.
//
// Extracts both content and computed CSS styles from Wix pages in a single
// browser session. Returns design tokens (colors, fonts) that map directly
// to Anglesite's global.css custom properties.
//
// Usage (CLI):
//   node wix-playwright.js <url> [--content-only] [--styles-only]
//
// Playwright is a required dependency — run `npx playwright install chromium`
// after `npm install` to download the browser binary.

import { rgbToHex, classifyTokens } from './color-utils.js';

// ---------------------------------------------------------------------------
// Browser-context evaluation functions (run inside page.evaluate)
// ---------------------------------------------------------------------------

/** Extract computed styles from visible elements on the page. */
export const extractStylesSrc = function () {
  const samples = {
    bg: [],
    text: [],
    heading: [],
  };
  const fonts = {
    heading: [],
    body: [],
  };

  // Sample background colors. Wix nests backgrounds in deep containers,
  // so check explicit candidates AND walk ancestors of the content area.
  const isOpaque = (bg) => bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';

  const bgCandidates = [
    document.body,
    document.querySelector('#SITE_CONTAINER'),
    document.querySelector('#PAGES_CONTAINER'),
    document.querySelector('[data-hook="post-page"]'),
    document.querySelector('main'),
  ].filter(Boolean);

  // Also sample all section-level wrappers (Wix uses deeply nested divs
  // with background colors for page sections)
  for (const el of document.querySelectorAll('section, [data-mesh-id], [data-testid]')) {
    if (el.offsetHeight > 100) bgCandidates.push(el);
  }

  // Walk ancestors of the first content area to find the nearest opaque bg
  const contentRoot = document.querySelector('[data-hook="post-description"]')
    || document.querySelector('#PAGES_CONTAINER')
    || document.querySelector('main');
  if (contentRoot) {
    let ancestor = contentRoot.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      bgCandidates.push(ancestor);
      ancestor = ancestor.parentElement;
    }
  }

  for (const el of bgCandidates) {
    const style = getComputedStyle(el);
    if (isOpaque(style.backgroundColor)) {
      samples.bg.push(style.backgroundColor);
    }
  }

  // Sample text colors and fonts from paragraphs and spans
  const textEls = document.querySelectorAll('p, span, li, td, a, div');
  const seen = new Set();
  for (const el of textEls) {
    // Skip invisible elements
    if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;
    // Skip elements with no direct text content
    const text = el.textContent?.trim();
    if (!text || text.length < 3) continue;
    // Deduplicate by element
    if (seen.has(el)) continue;
    seen.add(el);

    const style = getComputedStyle(el);
    const color = style.color;
    if (color) samples.text.push(color);

    const fontFamily = style.fontFamily?.split(',')[0]?.trim().replace(/['"]/g, '');
    if (fontFamily) fonts.body.push(fontFamily);
  }

  // Sample heading styles
  const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
  for (const el of headingEls) {
    if (el.offsetHeight === 0) continue;
    const style = getComputedStyle(el);
    if (style.color) samples.heading.push(style.color);
    const fontFamily = style.fontFamily?.split(',')[0]?.trim().replace(/['"]/g, '');
    if (fontFamily) fonts.heading.push(fontFamily);
  }

  return { samples, fonts };
};

/** Extract text content from the rendered page via TreeWalker. */
export const extractContentSrc = function () {
  const result = { body: '', images: [], title: '', navLinks: [] };

  // Try blog post region first
  const postDesc = document.querySelector('[data-hook="post-description"]');
  const postFooter = document.querySelector('[data-hook="post-footer"]');

  let container;
  if (postDesc) {
    container = postDesc;
  } else {
    // Static page: use PAGES_CONTAINER or main
    container = document.querySelector('#PAGES_CONTAINER')
      || document.querySelector('main')
      || document.body;
  }

  // Walk text nodes
  const blocks = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip script/style content
      const tag = node.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip post-footer region
      if (postFooter && postFooter.contains(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.textContent.trim();
      if (!text || text === '\u00a0') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let currentBlock = [];
  let lastParent = null;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    if (!text) continue;

    // Detect block boundaries (different parent block element)
    const blockParent = node.parentElement?.closest('div, p, h1, h2, h3, h4, h5, h6, li, blockquote');
    if (blockParent !== lastParent && currentBlock.length > 0) {
      blocks.push(currentBlock.join(' '));
      currentBlock = [];
    }
    lastParent = blockParent;

    // Check if this is a heading
    const heading = node.parentElement?.closest('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (heading) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join(' '));
        currentBlock = [];
      }
      // Detect heading level
      const level = heading.tagName?.match(/H(\d)/)?.[1] || '2';
      blocks.push('#'.repeat(Number(level)) + ' ' + text);
      lastParent = blockParent;
      continue;
    }

    currentBlock.push(text);
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join(' '));
  }

  result.body = blocks.join('\n\n');

  // Extract images from the container
  const imgs = container.querySelectorAll('img');
  for (const img of imgs) {
    if (img.src) {
      result.images.push({
        src: img.src,
        alt: img.alt || '',
      });
    }
  }

  // Extract title
  const titleEl = document.querySelector('[data-hook="post-title"], h1');
  if (titleEl) result.title = titleEl.textContent?.trim() || '';

  // Extract navigation links (complete, including JS-rendered sub-navs)
  const navLinks = document.querySelectorAll('nav a, [role="navigation"] a');
  for (const a of navLinks) {
    const text = a.textContent?.trim();
    const href = a.href;
    if (text && href) {
      result.navLinks.push({ text, href });
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Extract content and styles from a Wix page using Playwright.
 *
 * @param {import('playwright').Page} page - An open Playwright page
 * @param {string} url - The URL to navigate to
 * @param {Object} options - { contentOnly, stylesOnly }
 * @returns {Promise<{tokens: Object, content: Object}>}
 */
export async function extractWixPage(page, url, options = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for Wix Thunderbolt to render
  await page.waitForSelector('#SITE_CONTAINER', { timeout: 10000 }).catch(() => {});
  // Extra wait for dynamic content
  await page.waitForTimeout(2000);

  let tokens = null;
  let content = null;

  if (!options.contentOnly) {
    const { samples, fonts } = await page.evaluate(extractStylesSrc);

    // Convert rgb() samples to hex
    const hexSamples = {
      bg: samples.bg.map((c) => rgbToHex(c)).filter((c) => c.startsWith('#')),
      text: samples.text.map((c) => rgbToHex(c)).filter((c) => c.startsWith('#')),
      heading: samples.heading.map((c) => rgbToHex(c)).filter((c) => c.startsWith('#')),
    };

    tokens = classifyTokens(hexSamples, fonts);
  }

  if (!options.stylesOnly) {
    content = await page.evaluate(extractContentSrc);
  }

  return { tokens, content };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const contentOnly = args.includes('--content-only');
  const stylesOnly = args.includes('--styles-only');

  if (!url) {
    console.error('Usage: node wix-playwright.js <url> [--content-only] [--styles-only]');
    process.exitCode = 1;
    return;
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const result = await extractWixPage(page, url, { contentOnly, stylesOnly });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

// Only run CLI when executed directly
const isDirectRun = process.argv[1]?.endsWith('wix-playwright.js');
if (isDirectRun) {
  main();
}
