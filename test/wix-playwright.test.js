import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.ok(
      !src.includes("'networkidle'") && !src.includes('"networkidle"'),
      'networkidle causes timeouts on Wix — use domcontentloaded instead',
    );
  });

  it('uses domcontentloaded for page.goto', () => {
    assert.ok(
      src.includes("'domcontentloaded'") || src.includes('"domcontentloaded"'),
      'page.goto should use domcontentloaded wait strategy',
    );
  });

  it('waits for #SITE_CONTAINER as the real readiness check', () => {
    assert.ok(
      src.includes('#SITE_CONTAINER'),
      'Should wait for Wix Thunderbolt container element',
    );
  });
});
