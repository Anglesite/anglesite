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

const COLLECTIONS = ['posts', 'notes', 'services', 'team', 'testimonials', 'gallery', 'events', 'menus', 'menuSections', 'menuItems', 'faq', 'products', 'experiments'];

describe('content collections', () => {
  it('defines all collections with defineCollection', () => {
    for (const name of COLLECTIONS) {
      expect(contentConfig).toMatch(
        new RegExp(`const ${name} = defineCollection\\(`),
      );
    }
  });

  it('uses the Astro 5 Content Layer glob loader', () => {
    // Legacy `type: "content"` is gone — every collection uses a glob loader.
    expect(contentConfig).toContain('from "astro/loaders"');
    expect(contentConfig).toContain('glob({');
    expect(contentConfig).not.toMatch(/type:\s*"content"/);
  });

  it('does not ship pre-created content directories in the template', () => {
    // The glob loader is happy with empty/missing directories, so the
    // template ships none — Keystatic creates them on demand.
    for (const name of COLLECTIONS) {
      const gitkeep = join(root, 'template', 'src', 'content', name, '.gitkeep');
      expect(existsSync(gitkeep), `Unexpected .gitkeep in src/content/${name}/`).toBe(false);
    }
  });

  it('defines all collections in keystatic.config.ts', () => {
    for (const name of COLLECTIONS) {
      expect(keystatic).toContain(`${name}: collection({`);
    }
  });

  it('keystatic registers every collection unconditionally', () => {
    // No directory-existence filter — collections are always available.
    expect(keystatic).not.toContain('existsSync');
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

  it('keystatic paths match content directory names', () => {
    for (const name of COLLECTIONS) {
      expect(keystatic).toContain(`path: "src/content/${name}/*"`);
    }
  });
});

describe('collection schema fields', () => {
  // Verify key fields exist in both configs for each collection
  const fieldChecks = {
    notes: ['slug', 'publishDate', 'inReplyTo', 'syndication', 'draft'],
    services: ['name', 'description', 'price', 'order'],
    team: ['name', 'role', 'bio', 'photo', 'order'],
    testimonials: ['author', 'quote', 'attribution', 'rating'],
    gallery: ['image', 'alt', 'caption', 'category', 'order'],
    events: ['title', 'date', 'time', 'location', 'description'],
    menus: ['name', 'description', 'order'],
    menuSections: ['name', 'menu', 'description', 'order'],
    menuItems: ['name', 'section', 'description', 'price', 'dietary', 'available', 'order'],
    faq: ['question', 'answer', 'category', 'order'],
    products: ['name', 'description', 'price', 'image', 'weight', 'order'],
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
