import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const blogFiles = [
  'template/src/pages/blog/[slug].astro',
  'template/src/pages/blog/index.astro',
  'template/src/pages/blog/archive.astro',
  'template/src/pages/rss.xml.ts',
];

describe('blog slugs use Content Layer ids without extension stripping', () => {
  for (const file of blogFiles) {
    it(`${file} does not strip a .mdoc extension that is no longer present`, () => {
      // Under the Astro 5 Content Layer glob loader, `entry.id` is the
      // file path without extension. The legacy `.replace(/\.mdoc$/, "")`
      // dance is a no-op and should be gone.
      const content = readFileSync(join(root, file), 'utf-8');
      expect(content).not.toMatch(/\.replace\(\s*\/\\\.mdoc\$\//);
    });
  }
});
