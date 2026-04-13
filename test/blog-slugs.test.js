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

describe('blog slugs strip .mdoc extension', () => {
  for (const file of blogFiles) {
    it(`${file} does not use raw post.id for URLs`, () => {
      const content = readFileSync(join(root, file), 'utf-8');

      // post.id in Astro 5 glob loader includes the .mdoc extension.
      // Every use of post.id in a URL context must strip it.
      // Match post.id used in slug params or template literals for hrefs,
      // but NOT when it's followed by .replace (which strips the extension).
      const lines = content.split('\n');
      for (const line of lines) {
        // Skip lines that strip the extension
        if (line.includes('.replace(') && line.includes('.mdoc')) continue;
        // Skip lines that use the slug helper
        if (line.includes('stripMdoc') || line.includes('toSlug')) continue;

        // Flag raw post.id used in URL-building contexts
        if (
          line.includes('slug: post.id') ||
          (line.includes('`/blog/${post.id}') &&
            !line.includes('.replace('))
        ) {
          expect.fail(
            `${file} uses raw post.id for URL without stripping .mdoc extension:\n  ${line.trim()}`,
          );
        }
      }
    });
  }
});
