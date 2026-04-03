import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchPage = readFileSync(
  join(__dirname, '..', 'template', 'src', 'pages', 'search.astro'),
  'utf-8',
);

describe('search.astro', () => {
  it('does not import from astro-pagefind/components (missing export)', () => {
    expect(searchPage).not.toContain('astro-pagefind/components');
  });

  it('uses is:inline script to avoid Vite resolution of post-build assets', () => {
    expect(searchPage).toMatch(/<script\s[^>]*is:inline[^>]*>/);
  });

  it('dynamically imports pagefind UI at runtime', () => {
    expect(searchPage).toMatch(/import\(.*pagefind.*\)/);
  });

  it('mounts PagefindUI to the #search element', () => {
    expect(searchPage).toContain('element: "#search"');
  });

  it('includes a noscript fallback', () => {
    expect(searchPage).toMatch(/<noscript>/);
  });

  it('themes pagefind CSS variables to match site design tokens', () => {
    expect(searchPage).toContain('--pagefind-ui-primary');
    expect(searchPage).toContain('--pagefind-ui-text');
    expect(searchPage).toContain('--pagefind-ui-background');
  });
});
