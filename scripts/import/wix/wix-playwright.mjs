#!/usr/bin/env node

// Playwright-based Wix content and style extraction.
//
// Extracts both content and computed CSS styles from Wix pages in a single
// browser session. Returns design tokens (colors, fonts) that map directly
// to Anglesite's global.css custom properties.
//
// Usage (CLI):
//   node wix-playwright.mjs <url> [--content-only] [--styles-only]
//
// Playwright is an optional dependency. Install it with:
//   npm install playwright && npx playwright install chromium
// Falls back to curl + wix-extract.mjs if Playwright is not available.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { rgbToHex, classifyTokens } from './color-utils.mjs';
import {
  extractStylesSrc,
  extractContentSrc,
  expandAccordionsSrc,
} from '../browser/page-functions.mjs';

export { extractStylesSrc, extractContentSrc, expandAccordionsSrc };

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Extract content and styles from a Wix page using Playwright.
 *
 * @param {import('playwright').Page} page - An open Playwright page
 * @param {string} url - The URL to navigate to
 * @param {Object} options - { contentOnly, stylesOnly, fullPage }
 * @returns {Promise<{tokens: Object, content: Object}>}
 */
export async function extractWixPage(page, url, options = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for Wix Thunderbolt to render
  await page.waitForSelector('#SITE_CONTAINER', { timeout: 10000 }).catch(() => {});
  // Extra wait for dynamic content
  await page.waitForTimeout(2000);

  // Expand all accordion/FAQ items so collapsed content becomes visible.
  // Wix uses aria-expanded="false" on triggers and hides panel content.
  const expanded = await page.evaluate(expandAccordionsSrc);
  if (expanded > 0) {
    await page.waitForTimeout(500);
  }

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
    const fullPage = !!options.fullPage;
    content = await page.evaluate(extractContentSrc, { fullPage });
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
    console.error('Usage: node wix-playwright.mjs <url> [--content-only] [--styles-only]');
    process.exitCode = 1;
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
    console.error('Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium');
    console.error('Use curl + wix-extract.js as a fallback for content extraction.');
    process.exitCode = 1;
    return;
  }
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const result = await extractWixPage(page, url, { contentOnly, stylesOnly });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

// Only run CLI when executed directly (rename-proof, unlike an endsWith check)
const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
