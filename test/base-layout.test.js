import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(
  join(__dirname, '..', 'template', 'src', 'layouts', 'BaseLayout.astro'),
  'utf-8',
);

describe('BaseLayout.astro', () => {
  it('does not hardcode "My Website" in the header', () => {
    expect(layout).not.toContain('>My Website<');
  });

  it('reads SITE_NAME from .site-config', () => {
    expect(layout).toMatch(/SITE_NAME/);
  });

  it('uses the site name variable in the header link', () => {
    // The header should use a variable, not a string literal
    expect(layout).toMatch(/<a[^>]*class="p-name u-url"[^>]*>\{[^}]*\}/);
  });

  it('always emits og:image meta tag (unconditional)', () => {
    // og:image should NOT be wrapped in a conditional — it always renders
    expect(layout).toMatch(/<meta property="og:image" content=\{ogImage\}/);
    expect(layout).not.toMatch(/\{ogImage &&.*og:image/);
  });

  it('resolves per-page OG image path from slug', () => {
    // The resolveOgImage function should reference /images/og/ directory
    expect(layout).toContain('/images/og/');
  });
});
