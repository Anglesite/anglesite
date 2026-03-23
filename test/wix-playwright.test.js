import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// We can't import extractWixPage directly (requires Playwright runtime),
// but we can verify the source code uses the correct wait strategy.
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, '..', 'scripts', 'import', 'wix', 'wix-playwright.js'),
  'utf-8',
);

describe('wix-playwright.js wait strategy', () => {
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
