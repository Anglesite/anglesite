import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const contentConfig = readFileSync(
  join(root, 'template', 'src', 'content.config.ts'),
  'utf-8',
);
const keystatic = readFileSync(
  join(root, 'template', 'keystatic.config.ts'),
  'utf-8',
);

const COLLECTIONS = ['posts', 'services', 'team', 'testimonials', 'gallery', 'events', 'faq'];

describe('content collections', () => {
  it('exports all collections from content.config.ts', () => {
    // The export line should include all collection names
    const exportLine = contentConfig.match(/export const collections = \{([^}]+)\}/)?.[1] ?? '';
    for (const name of COLLECTIONS) {
      expect(exportLine).toContain(name);
    }
  });

  it('defines all collections in keystatic.config.ts', () => {
    for (const name of COLLECTIONS) {
      expect(keystatic).toContain(`${name}: collection({`);
    }
  });

  it('has matching collection names in both config files', () => {
    // Extract collection names from content.config.ts (defineCollection calls)
    const zodCollections = [...contentConfig.matchAll(/^const (\w+) = defineCollection/gm)]
      .map((m) => m[1]);
    // Extract collection names from keystatic.config.ts (collection keys)
    const ksCollections = [...keystatic.matchAll(/^\s+(\w+): collection\(/gm)]
      .map((m) => m[1]);

    expect(zodCollections.sort()).toEqual(ksCollections.sort());
  });

  it('has content directories for each collection', () => {
    for (const name of COLLECTIONS) {
      const dir = join(root, 'template', 'src', 'content', name);
      expect(existsSync(dir), `Missing directory: src/content/${name}/`).toBe(true);
    }
  });

  it('keystatic paths match content directory names', () => {
    for (const name of COLLECTIONS) {
      expect(keystatic).toContain(`path: "src/content/${name}/*"`);
    }
  });
});

describe('collection schema fields', () => {
  // Verify key fields exist in both configs for each collection
  const fieldChecks = {
    services: ['name', 'description', 'price', 'order'],
    team: ['name', 'role', 'bio', 'photo', 'order'],
    testimonials: ['author', 'quote', 'attribution', 'rating'],
    gallery: ['image', 'alt', 'caption', 'category', 'order'],
    events: ['title', 'date', 'time', 'location', 'description'],
    faq: ['question', 'answer', 'category', 'order'],
  };

  for (const [collection, fields] of Object.entries(fieldChecks)) {
    it(`${collection} has required fields in content.config.ts`, () => {
      // Find the collection's schema block
      const schemaBlock = contentConfig.match(
        new RegExp(`const ${collection} = defineCollection\\({[\\s\\S]*?\\}\\);`),
      )?.[0] ?? '';
      for (const field of fields) {
        expect(schemaBlock, `${collection} missing field: ${field}`).toContain(field);
      }
    });

    it(`${collection} has required fields in keystatic.config.ts`, () => {
      // Find the collection's schema block in keystatic
      const collectionBlock = keystatic.match(
        new RegExp(`${collection}: collection\\({[\\s\\S]*?\\}\\),\\n\\s{4}\\}\\),`),
      )?.[0] ?? keystatic;
      for (const field of fields) {
        expect(collectionBlock, `${collection} missing Keystatic field: ${field}`)
          .toContain(field);
      }
    });
  }
});
