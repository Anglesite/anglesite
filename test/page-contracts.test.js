import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pagesDir = join(root, 'template', 'src', 'pages');

// Recursively find all .astro files under pages/
function findAstroFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findAstroFiles(full));
    } else if (entry.endsWith('.astro')) {
      results.push(full);
    }
  }
  return results;
}

// Pages that intentionally use a specialized layout instead of BaseLayout
const ALTERNATIVE_LAYOUT_PAGES = new Set([
  'menu/kiosk.astro', // KioskLayout — headerless mobile menu for QR/NFC table access
]);

const pageFiles = findAstroFiles(pagesDir).map((full) => ({
  path: full,
  name: relative(pagesDir, full),
  content: readFileSync(full, 'utf-8'),
}));

describe('page contracts', () => {
  it('discovers at least one page', () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  for (const page of pageFiles) {
    describe(page.name, () => {
      it('imports BaseLayout', () => {
        if (ALTERNATIVE_LAYOUT_PAGES.has(page.name)) {
          expect(page.content).toMatch(/import\s+\w+Layout\s+from/);
        } else {
          expect(page.content).toMatch(/import\s+BaseLayout\s+from/);
        }
      });

      it('passes a title prop to BaseLayout', () => {
        expect(page.content).toMatch(/title[=:]/);
      });

      it('does not hardcode a site name', () => {
        expect(page.content).not.toContain('>My Website<');
        expect(page.content).not.toContain('>My Site<');
        expect(page.content).not.toContain('>Site Name<');
      });
    });
  }
});
