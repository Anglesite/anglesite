/**
 * RSL Integration Tests
 * Tests the complete RSL plugin integration with Eleventy
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import addRSL from '../../plugins/rsl.js';
import type { RSLConfiguration } from '../../plugins/rsl/types.js';

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

const mockCollectionApi = {
  getFilteredByTag: jest.fn((tag: string) => {
    if (tag === 'posts') {
      return [
        {
          url: '/posts/post-1/',
          date: new Date('2023-12-01'),
          data: {
            title: 'First Post',
            author: 'John Doe',
            page: { date: new Date('2023-12-01'), url: '/posts/post-1/' },
          },
          templateContent: '<h1>First Post</h1><p>Content here.</p>',
        },
        {
          url: '/posts/post-2/',
          date: new Date('2023-12-02'),
          data: {
            title: 'Second Post',
            author: 'Jane Smith',
            page: { date: new Date('2023-12-02'), url: '/posts/post-2/' },
            license: 'CC-BY-4.0',
          },
          templateContent: '<h1>Second Post</h1><p>More content.</p>',
        },
      ];
    }
    return [];
  }),
};

describe('RSL Integration', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rsl-integration-'));
    outputDir = path.join(tempDir, '_site');

    // Create input directory structure
    const inputDir = path.join(tempDir, 'src');
    const dataDir = path.join(inputDir, '_data');

    await fs.promises.mkdir(inputDir, { recursive: true });
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Create test website configuration
    const websiteConfig = {
      title: 'Test Website',
      description: 'A test website for RSL integration',
      url: 'https://test.example.com',
      author: {
        name: 'Test Author',
        email: 'test@example.com',
      },
      language: 'en',
      rsl: {
        enabled: true,
        defaultOutputFormats: ['sitewide', 'collection'],
        defaultLicense: {
          permits: [
            { type: 'usage', values: ['view', 'download'] },
            { type: 'user', values: ['individual'] },
          ],
          prohibits: [{ type: 'usage', values: ['ai-training', 'commercial'] }],
          payment: { type: 'free', attribution: true },
          copyright: 'Copyright © 2023 Test Website',
        },
        collections: {
          posts: {
            enabled: true,
            outputFormats: ['collection'],
          },
        },
        contentDiscovery: {
          enabled: true,
          maxDepth: 3,
          includeExtensions: ['.md', '.html', '.jpg', '.png'],
          generateChecksums: false,
        },
      } as RSLConfiguration,
    };

    await fs.promises.writeFile(path.join(dataDir, 'website.json'), JSON.stringify(websiteConfig, null, 2));

    // Create some test assets
    await fs.promises.writeFile(path.join(inputDir, 'test-image.jpg'), Buffer.from('fake-jpg-data'));

    await fs.promises.writeFile(path.join(inputDir, 'readme.md'), '# Test Site\n\nThis is a test website.');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  it('should initialize RSL plugin without errors', () => {
    expect(() => {
      addRSL(mockEleventyConfig as any);
    }).not.toThrow();

    expect(mockEleventyConfig.addCollection).toHaveBeenCalledWith('_rslCollectionCapture', expect.any(Function));
    expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
  });

  it('should generate RSL files during Eleventy after-build event', async () => {
    // Initialize the plugin
    addRSL(mockEleventyConfig as any);

    // Get the registered collection function and after-build handler
    const collectionFn = mockEleventyConfig.collections.get('_rslCollectionCapture');
    const afterBuildHandler = mockEleventyConfig.events.get('eleventy.after');

    expect(collectionFn).toBeDefined();
    expect(afterBuildHandler).toBeDefined();

    // Call the collection function to set up the collections reference
    collectionFn(mockCollectionApi);

    // Create mock build results
    const mockResults = [
      {
        url: '/index.html',
        date: new Date('2023-12-01'),
        data: {
          title: 'Home Page',
          page: { date: new Date('2023-12-01'), url: '/index.html' },
          website: {
            title: 'Test Website',
            url: 'https://test.example.com',
            rsl: {
              enabled: true,
              defaultOutputFormats: ['sitewide'],
              defaultLicense: {
                permits: [{ type: 'usage', values: ['view'] }],
                payment: { type: 'free', attribution: true },
                copyright: 'Test Copyright',
              },
              contentDiscovery: { enabled: false }, // Disable for test simplicity
            },
          },
        },
        templateContent: '<h1>Home</h1>',
      },
    ];

    // Simulate the after-build event
    await afterBuildHandler({
      dir: {
        input: path.join(tempDir, 'src'),
        output: outputDir,
      },
      results: mockResults,
    });

    // Check that site-wide RSL file was generated
    const siteRSLPath = path.join(outputDir, 'rsl.xml');
    expect(fs.existsSync(siteRSLPath)).toBe(true);

    const rslContent = fs.readFileSync(siteRSLPath, 'utf-8');
    expect(rslContent).toContain('<?xml version="1.0"?>');
    expect(rslContent).toContain('xmlns="https://rslstandard.org/rsl"');
    expect(rslContent).toContain('url="https://test.example.com/index.html"');
    expect(rslContent).toContain('Test Copyright');
  });

  it('should handle missing website configuration gracefully', async () => {
    // Remove the website configuration file
    const configPath = path.join(tempDir, 'src', '_data', 'website.json');
    await fs.promises.unlink(configPath);

    // Initialize the plugin
    addRSL(mockEleventyConfig as any);

    // Get the after-build handler
    const afterBuildHandler = mockEleventyConfig.events.get('eleventy.after');

    // Mock console.log to check for expected messages
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Simulate the after-build event
    await afterBuildHandler({
      dir: {
        input: path.join(tempDir, 'src'),
        output: outputDir,
      },
      results: [{ url: '/test/', data: {}, templateContent: 'test' }],
    });

    expect(consoleSpy).toHaveBeenCalledWith('RSL: No website configuration found, skipping RSL generation');

    // No RSL files should be generated
    const siteRSLPath = path.join(outputDir, 'rsl.xml');
    expect(fs.existsSync(siteRSLPath)).toBe(false);

    consoleSpy.mockRestore();
  });

  it('should respect disabled RSL configuration', async () => {
    // Update website config to disable RSL
    const configPath = path.join(tempDir, 'src', '_data', 'website.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.rsl.enabled = false;
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));

    // Initialize the plugin
    addRSL(mockEleventyConfig as any);

    // Get the after-build handler
    const afterBuildHandler = mockEleventyConfig.events.get('eleventy.after');

    // Mock console.log to check for expected messages
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Simulate the after-build event
    await afterBuildHandler({
      dir: {
        input: path.join(tempDir, 'src'),
        output: outputDir,
      },
      results: [{ url: '/test/', data: {}, templateContent: 'test' }],
    });

    expect(consoleSpy).toHaveBeenCalledWith('RSL: RSL generation is disabled');

    // No RSL files should be generated
    const siteRSLPath = path.join(outputDir, 'rsl.xml');
    expect(fs.existsSync(siteRSLPath)).toBe(false);

    consoleSpy.mockRestore();
  });

  it('should handle empty build results gracefully', async () => {
    // Initialize the plugin
    addRSL(mockEleventyConfig as any);

    // Get the after-build handler
    const afterBuildHandler = mockEleventyConfig.events.get('eleventy.after');

    // Mock console.log to check for expected messages
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Simulate the after-build event with empty results
    await afterBuildHandler({
      dir: {
        input: path.join(tempDir, 'src'),
        output: outputDir,
      },
      results: [],
    });

    expect(consoleSpy).toHaveBeenCalledWith('RSL: No build results, skipping RSL generation');

    consoleSpy.mockRestore();
  });

  it('should log plugin initialization', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    addRSL(mockEleventyConfig as any);

    expect(consoleSpy).toHaveBeenCalledWith('RSL: RSL plugin initialized');

    consoleSpy.mockRestore();
  });
});
