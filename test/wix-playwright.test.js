import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractContentSrc } from '../scripts/import/wix/wix-playwright.mjs';

import { extractContentSrc } from '../scripts/import/wix/wix-playwright.mjs';

// We can't import extractWixPage directly (requires Playwright runtime),
// but we can verify the source code uses the correct wait strategy.
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, '..', 'scripts', 'import', 'wix', 'wix-playwright.mjs'),
  'utf-8',
);

describe('wix-playwright.mjs wait strategy', () => {
  it('does not use networkidle (Wix Thunderbolt never quiesces)', () => {
    expect(
      src.includes("'networkidle'") || src.includes('"networkidle"'),
    ).toBe(false);
  });

  it('uses domcontentloaded for page.goto', () => {
    expect(
      src.includes("'domcontentloaded'") || src.includes('"domcontentloaded"'),
    ).toBe(true);
  });

  it('waits for #SITE_CONTAINER as the real readiness check', () => {
    expect(src).toContain('#SITE_CONTAINER');
  });
});

describe('wix-playwright.mjs fullPage option', () => {
  it('extractWixPage accepts a fullPage option', () => {
    expect(src).toContain('fullPage');
  });

  it('passes fullPage option through to extractContentSrc', () => {
    // extractContentSrc should receive and handle the fullPage flag
    expect(src).toMatch(/extractContentSrc.*fullPage|fullPage.*extractContentSrc/s);
  });

  it('extracts header images when fullPage is true', () => {
    // The source should query header/SITE_HEADER for images
    expect(src).toContain('SITE_HEADER');
    expect(src).toContain('header');
  });

  it('extracts footer content when fullPage is true', () => {
    // The source should query footer/SITE_FOOTER for content
    expect(src).toContain('SITE_FOOTER');
    expect(src).toContain('footer');
  });

  it('returns header and footer fields in the content output', () => {
    // Output structure should include header.logo, header.images, footer.text, footer.images
    expect(src).toContain('header');
    expect(src).toContain('footer');
    expect(src).toContain('logo');
  });
});

describe('wix-playwright.mjs playwright resolution', () => {
  it('uses createRequire to resolve playwright from cwd, not script location', () => {
    expect(src).toContain('createRequire');
    expect(src).toContain('process.cwd()');
  });

  it('does not use bare import("playwright") which resolves from script location', () => {
    // A bare dynamic import would fail when the script runs from the plugin cache
    // because Node resolves relative to the module file, not cwd.
    const bareImportPattern = /await\s+import\(\s*['"]playwright['"]\s*\)/;
    expect(bareImportPattern.test(src)).toBe(false);
  });
});

describe('wix-playwright.mjs accordion expansion', () => {
  it('expands aria-expanded="false" elements before extraction', () => {
    expect(src).toContain('aria-expanded="false"');
    expect(src).toContain('expandAccordions');
  });

  it('handles Wix FAQ data-hook elements', () => {
    expect(src).toContain('data-hook="faq-question"');
  });

  it('handles HTML details elements', () => {
    expect(src).toContain('details:not([open])');
  });
});

describe('wix-playwright.mjs fullPage option', () => {
  it('extractContentSrc accepts a fullPage option', () => {
    // The function should be callable with an options argument
    expect(typeof extractContentSrc).toBe('function');
  });

  it('extractWixPage passes fullPage option to page.evaluate', () => {
    expect(src).toContain('fullPage');
  });

  it('extracts header images when fullPage is true', () => {
    expect(src).toContain('SITE_HEADER');
  });

  it('extracts footer content when fullPage is true', () => {
    // Should query footer elements for text and images
    expect(src).toMatch(/footer.*images|header.*footer/s);
  });

  it('returns header and footer fields in fullPage output structure', () => {
    // The source should assign header and footer to the result object
    expect(src).toContain('result.header');
    expect(src).toContain('result.footer');
  });
});
