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

  it('sets pagefind CSS variables on #search, not :root (Astro scoping)', () => {
    // :root in a scoped <style> becomes :root[data-astro-cid-xxx] which never
    // matches because <html> is rendered by BaseLayout without this scope hash.
    // Variables must be on #search so the widget inherits them via CSS cascade.
    expect(searchPage).not.toMatch(/:root\s*\{[^}]*--pagefind-ui/s);
    expect(searchPage).toMatch(/#search\s*\{[^}]*--pagefind-ui/s);
  });
});
