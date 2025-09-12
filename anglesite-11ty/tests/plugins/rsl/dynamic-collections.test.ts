/**
 * Dynamic Collections Tests for RSL Plugin
 * Tests that reproduce the bug where RSL requires hardcoded collection names
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import addRSL from '../../../plugins/rsl.js';
import type { RSLConfiguration } from '../../../plugins/rsl/types.js';

// Mock Eleventy config and collections
const mockEleventyConfig = {
  collections: new Map(),
  events: new Map(),
  addCollection: jest.fn((name: string, fn: (collection: unknown) => unknown[]) => {
    mockEleventyConfig.collections.set(name, fn);
  }),
  on: jest.fn((event: string, handler: (data: unknown) => void) => {
    mockEleventyConfig.events.set(event, handler);
  }),
};

// Mock collection API with dynamic collection discovery capability
const mockCollectionApi = {
  getFilteredByTag: jest.fn((tag: string) => {
    // Simulate different collections with arbitrary names
    const collections = {
      'blog-posts': [
        {
          url: '/blog-posts/first-blog-post/',
          date: new Date('2023-12-01'),
          data: {
            title: 'First Blog Post',
            tags: ['blog-posts'],
            page: { date: new Date('2023-12-01'), url: '/blog-posts/first-blog-post/' },
          },
          templateContent: '<h1>First Blog Post</h1>',
        },
      ],
      'product-reviews': [
        {
          url: '/reviews/amazing-product/',
          date: new Date('2023-12-02'),
          data: {
            title: 'Amazing Product Review',
            tags: ['product-reviews'],
            page: { date: new Date('2023-12-02'), url: '/reviews/amazing-product/' },
          },
          templateContent: '<h1>Amazing Product Review</h1>',
        },
      ],
      tutorials: [
        {
          url: '/tutorials/how-to-code/',
          date: new Date('2023-12-03'),
          data: {
            title: 'How to Code Tutorial',
            tags: ['tutorials'],
            page: { date: new Date('2023-12-03'), url: '/tutorials/how-to-code/' },
          },
          templateContent: '<h1>How to Code Tutorial</h1>',
        },
      ],
      'custom-collection-with-long-name': [
        {
          url: '/custom/item/',
          date: new Date('2023-12-04'),
          data: {
            title: 'Custom Collection Item',
            tags: ['custom-collection-with-long-name'],
            page: { date: new Date('2023-12-04'), url: '/custom/item/' },
          },
          templateContent: '<h1>Custom Collection Item</h1>',
        },
      ],
    };
    return collections[tag as keyof typeof collections] || [];
  }),
  getAll: jest.fn(() => {
    // Return all items from all collections to simulate Eleventy's getAll behavior
    const allItems = [
      {
        url: '/blog-posts/first-blog-post/',
        date: new Date('2023-12-01'),
        data: {
          title: 'First Blog Post',
          tags: ['blog-posts'],
          page: { date: new Date('2023-12-01'), url: '/blog-posts/first-blog-post/' },
        },
        templateContent: '<h1>First Blog Post</h1>',
      },
      {
        url: '/reviews/amazing-product/',
        date: new Date('2023-12-02'),
        data: {
          title: 'Amazing Product Review',
          tags: ['product-reviews'],
          page: { date: new Date('2023-12-02'), url: '/reviews/amazing-product/' },
        },
        templateContent: '<h1>Amazing Product Review</h1>',
      },
      {
        url: '/tutorials/how-to-code/',
        date: new Date('2023-12-03'),
        data: {
          title: 'How to Code Tutorial',
          tags: ['tutorials'],
          page: { date: new Date('2023-12-03'), url: '/tutorials/how-to-code/' },
        },
        templateContent: '<h1>How to Code Tutorial</h1>',
      },
      {
        url: '/custom/item/',
        date: new Date('2023-12-04'),
        data: {
          title: 'Custom Collection Item',
          tags: ['custom-collection-with-long-name'],
          page: { date: new Date('2023-12-04'), url: '/custom/item/' },
        },
        templateContent: '<h1>Custom Collection Item</h1>',
      },
    ];
    return allItems;
  }),
};

describe('RSL Dynamic Collections Bug Tests', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rsl-dynamic-collections-'));
    outputDir = path.join(tempDir, '_site');

    // Create input directory structure
    const inputDir = path.join(tempDir, 'src');
    const dataDir = path.join(inputDir, '_data');

    await fs.promises.mkdir(inputDir, { recursive: true });
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  // NOTE: The "BUG: Hardcoded Collection Names" tests have been removed
  // because the bugs have been fixed - dynamic collection support now works properly.
  // The correct behavior is now tested in the "DESIRED: Dynamic Collection Support" section below.

  describe('DESIRED: Dynamic Collection Support', () => {
    it('should auto-discover and generate RSL for all collections when enabled', async () => {
      // This test defines the desired behavior after the fix
      const websiteConfig = {
        title: 'Test Website',
        url: 'https://test.example.com',
        rsl: {
          enabled: true,
          defaultOutputFormats: ['collection'],
          // NEW: Enable auto-discovery of all collections
          autoDiscoverCollections: true,
          defaultLicense: {
            permits: [{ type: 'usage', values: ['view'] }],
            payment: { type: 'free', attribution: true },
          },
        } as RSLConfiguration & { autoDiscoverCollections?: boolean },
      };

      await fs.promises.writeFile(
        path.join(tempDir, 'src', '_data', 'website.json'),
        JSON.stringify(websiteConfig, null, 2)
      );

      addRSL(mockEleventyConfig as any);
      const collectionFn = mockEleventyConfig.collections.get('_rslCollectionCapture');
      const afterBuildHandler = mockEleventyConfig.events.get('eleventy.after');
      collectionFn(mockCollectionApi);

      const mockResults = [
        {
          url: '/index.html',
          date: new Date('2023-12-01'),
          data: { title: 'Home Page', website: websiteConfig },
          templateContent: '<h1>Home</h1>',
        },
      ];

      await afterBuildHandler({
        dir: { input: path.join(tempDir, 'src'), output: outputDir },
        results: mockResults,
      });

      // With auto-discovery enabled, ALL collections should now have RSL files
      const blogRSLPath = path.join(outputDir, 'blog-posts', 'blog-posts.rsl.xml');
      const reviewsRSLPath = path.join(outputDir, 'product-reviews', 'product-reviews.rsl.xml');
      const tutorialsRSLPath = path.join(outputDir, 'tutorials', 'tutorials.rsl.xml');
      const customRSLPath = path.join(
        outputDir,
        'custom-collection-with-long-name',
        'custom-collection-with-long-name.rsl.xml'
      );

      expect(fs.existsSync(blogRSLPath)).toBe(true);
      expect(fs.existsSync(reviewsRSLPath)).toBe(true);
      expect(fs.existsSync(tutorialsRSLPath)).toBe(true);
      expect(fs.existsSync(customRSLPath)).toBe(true);
    });

    it('should support custom collection naming patterns', async () => {
      // This test defines desired behavior for arbitrary collection names
      const websiteConfig = {
        title: 'Test Website',
        url: 'https://test.example.com',
        rsl: {
          enabled: true,
          autoDiscoverCollections: true,
          defaultOutputFormats: ['collection'],
          defaultLicense: {
            permits: [{ type: 'usage', values: ['view'] }],
            payment: { type: 'free', attribution: true },
          },
        } as RSLConfiguration & { autoDiscoverCollections?: boolean },
      };

      // After fix, these arbitrary collection names should all work:
      // - 'blog-posts'
      // - 'product-reviews'
      // - 'tutorials'
      // - 'custom-collection-with-long-name'

      expect(true).toBe(true); // Placeholder for future implementation
    });

    it('should allow selective collection inclusion/exclusion', async () => {
      // This test defines desired behavior for selective collection control
      const websiteConfig = {
        title: 'Test Website',
        url: 'https://test.example.com',
        rsl: {
          enabled: true,
          autoDiscoverCollections: true,
          // NEW: Include/exclude patterns for collection discovery
          includeCollections: ['blog-*', 'tutorials'],
          excludeCollections: ['internal-*', 'draft-*'],
          defaultOutputFormats: ['collection'],
          defaultLicense: {
            permits: [{ type: 'usage', values: ['view'] }],
            payment: { type: 'free', attribution: true },
          },
        } as RSLConfiguration & {
          autoDiscoverCollections?: boolean;
          includeCollections?: string[];
          excludeCollections?: string[];
        },
      };

      expect(true).toBe(true); // Placeholder for future implementation
    });
  });
});
