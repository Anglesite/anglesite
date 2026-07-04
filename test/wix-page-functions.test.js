// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractContentSrc } from '../scripts/import/browser/page-functions.mjs';

describe('extractContentSrc heading handling', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<body><main></main></body>';
  });

  it('accumulates a heading with multiple inline text nodes into a single line', () => {
    document.querySelector('main').innerHTML = '<h1>Hello <strong>World</strong></h1>';
    const result = extractContentSrc({});
    expect(result.body).toBe('# Hello World');
  });

  it('keeps the href for a link inside a heading', () => {
    document.querySelector('main').innerHTML =
      '<h2><a href="https://example.com/linked">Linked Heading</a></h2>';
    const result = extractContentSrc({});
    expect(result.body).toBe('## [Linked Heading](https://example.com/linked)');
  });

  it('does not bleed heading text into the following paragraph', () => {
    document.querySelector('main').innerHTML =
      '<h1>Hello <strong>World</strong></h1><p>Body text follows.</p>';
    const result = extractContentSrc({});
    expect(result.body).toBe('# Hello World\n\nBody text follows.');
  });

  it('still joins multi-node paragraph text as before', () => {
    document.querySelector('main').innerHTML =
      '<p>Hello <strong>World</strong>, welcome.</p>';
    const result = extractContentSrc({});
    expect(result.body).toBe('Hello World , welcome.');
  });
});
