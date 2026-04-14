#!/usr/bin/env node

// Side-by-side comparison screenshot utility.
//
// Captures fullPage screenshots of both the original Canva published site and
// the locally running Astro dev server for visual comparison.
//
// Usage (programmatic):
//   import { captureComparisons } from './comparison.mjs';
//   await captureComparisons(canvaBaseUrl, localBaseUrl, ['/','  /services']);
//
// Playwright is an optional dependency. Install it with:
//   npm install playwright && npx playwright install chromium

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPARISON_DIR = 'docs/design-import/comparison';

// ---------------------------------------------------------------------------
// Pure utility (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Generate file paths for comparison screenshots for a given page path.
 *
 * Slug rules:
 * - Strip leading and trailing slashes
 * - `/` (or empty after stripping) → "home"
 * - Replace remaining `/` characters with `-`
 *
 * @param {string} pagePath - URL path, e.g. "/", "/services", "/about/team"
 * @returns {{ original: string, generated: string }}
 */
export function comparisonPaths(pagePath) {
  // Strip leading and trailing slashes
  const stripped = pagePath.replace(/^\/+|\/+$/g, '');
  // Root path → "home"; otherwise replace internal slashes with dashes
  const slug = stripped.length === 0 ? 'home' : stripped.replace(/\//g, '-');

  return {
    original: `${COMPARISON_DIR}/${slug}-original.png`,
    generated: `${COMPARISON_DIR}/${slug}-generated.png`,
  };
}

// ---------------------------------------------------------------------------
// Orchestration (requires Playwright — not unit-testable)
// ---------------------------------------------------------------------------

/**
 * Capture side-by-side comparison screenshots for each page path.
 *
 * For each path:
 * 1. Navigate to Canva URL, wait for networkidle + 2s, take fullPage screenshot
 * 2. Navigate to local dev server URL, wait for networkidle, take fullPage screenshot
 *
 * @param {string} canvaBaseUrl  - Base URL of the published Canva site
 * @param {string} localBaseUrl  - Base URL of the local Astro dev server
 * @param {string[]} pagePaths   - Array of page paths, e.g. ["/", "/services"]
 * @returns {Promise<void>}
 */
export async function captureComparisons(canvaBaseUrl, localBaseUrl, pagePaths) {
  let playwright;
  try {
    const require = createRequire(join(process.cwd(), 'package.json'));
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium',
    );
  }

  mkdirSync(COMPARISON_DIR, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    for (const pagePath of pagePaths) {
      const { original, generated } = comparisonPaths(pagePath);

      // Capture original Canva page
      const canvaUrl = new URL(pagePath, canvaBaseUrl).href;
      await page.goto(canvaUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: original, fullPage: true });

      // Capture local Astro dev server page
      const localUrl = new URL(pagePath, localBaseUrl).href;
      await page.goto(localUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.screenshot({ path: generated, fullPage: true });
    }
  } finally {
    await browser.close();
  }
}
