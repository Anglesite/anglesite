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

import {
  extractStylesSrc as sharedStyles,
  extractContentSrc as sharedContent,
  expandAccordionsSrc,
} from '../scripts/import/browser/page-functions.mjs';

describe('browser/page-functions module', () => {
  it('wix-playwright re-exports are the same functions', async () => {
    const wix = await import('../scripts/import/wix/wix-playwright.mjs');
    expect(wix.extractContentSrc).toBe(sharedContent);
    expect(wix.extractStylesSrc).toBe(sharedStyles);
  });

  it('extractContentSrc finds content in a Squarespace-shaped page', () => {
    document.documentElement.innerHTML = `
      <body><main id="page"><section class="sqs-block-content">
        <h1>About Sandra</h1><p>Sandra Cami is a first-generation designer with a decade of experience.</p>
        <img src="https://images.squarespace-cdn.com/content/v1/abc/img.jpeg" alt="portrait">
      </section></main></body>`;
    const result = sharedContent({});
    expect(result.body).toContain('Sandra Cami');
    expect(result.images[0].src).toContain('squarespace-cdn.com');
  });

  it('expandAccordionsSrc opens details and aria-expanded triggers', () => {
    document.documentElement.innerHTML = `
      <body><details><summary>Q</summary>A</details>
      <button aria-expanded="false">FAQ</button></body>`;
    const count = expandAccordionsSrc();
    expect(count).toBe(2);
    expect(document.querySelector('details').open).toBe(true);
  });
});

describe('extractContentSrc heading handling', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<body><main></main></body>';
  });

  it('accumulates a heading with multiple inline text nodes into a single line', () => {
    document.querySelector('main').innerHTML = '<h1>Hello <strong>World</strong></h1>';
    const result = sharedContent({});
    expect(result.body).toBe('# Hello World');
  });

  it('keeps the href for a link inside a heading', () => {
    document.querySelector('main').innerHTML =
      '<h2><a href="https://example.com/linked">Linked Heading</a></h2>';
    const result = sharedContent({});
    expect(result.body).toBe('## [Linked Heading](https://example.com/linked)');
  });

  it('does not bleed heading text into the following paragraph', () => {
    document.querySelector('main').innerHTML =
      '<h1>Hello <strong>World</strong></h1><p>Body text follows.</p>';
    const result = sharedContent({});
    expect(result.body).toBe('# Hello World\n\nBody text follows.');
  });

  it('still joins multi-node paragraph text as before', () => {
    document.querySelector('main').innerHTML =
      '<p>Hello <strong>World</strong>, welcome.</p>';
    const result = sharedContent({});
    expect(result.body).toBe('Hello World , welcome.');
  });
});
