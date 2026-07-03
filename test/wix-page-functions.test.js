// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { extractContentSrc } from '../scripts/import/wix/wix-playwright.mjs';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('extractContentSrc (executed in a DOM)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = readFileSync(
      join(fixtureDir, 'wix-blog-post.html'),
      'utf8',
    );
  });

  it('runs without throwing and returns the content shape', () => {
    const result = extractContentSrc({});
    expect(result).toMatchObject({
      images: expect.any(Array),
      navLinks: expect.any(Array),
      tags: expect.any(Array),
    });
    expect(typeof result.body).toBe('string');
    expect(result.body.length).toBeGreaterThan(0);
  });

  it('only attaches header/footer in fullPage mode', () => {
    expect(extractContentSrc({}).header).toBeUndefined();
    const full = extractContentSrc({ fullPage: true });
    expect(full.header).toBeDefined();
    expect(full.footer).toBeDefined();
  });
});
