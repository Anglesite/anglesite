/**
 * @file REFACTORED RSL Integration Tests
 * @description Example of how to use the new test utilities for cleaner RSL testing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import addRSL from '../../plugins/rsl.js';
import { MockFactory } from '../../../anglesite/test/utils/mock-factory';
import {
  TestData,
  WebsiteConfigBuilder,
  CollectionItemBuilder,
} from '../../../anglesite/test/builders/website-config-builder';

describe('RSL Integration (Refactored)', () => {
  let tempDir: string;
  let outputDir: string;
  let mockEleventyConfig: ReturnType<typeof MockFactory.createMockEleventyConfig>;

  // Using MockFactory for consistent setup
  const mockCollectionApi = {
    getFilteredByTag: jest.fn((tag: string) => {
      if (tag === 'posts') {
        return [
          new CollectionItemBuilder()
            .asBlogPost('First Post')
            .withAuthor('John Doe')
            .withDate(new Date('2023-12-01'))
            .build(),
          new CollectionItemBuilder()
            .asBlogPost('Second Post')
            .withAuthor('Jane Smith')
            .withData({ license: 'CC-BY-4.0' })
            .withDate(new Date('2023-12-02'))
            .build(),
        ];
      }
      return [];
    }),
  };

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rsl-integration-'));
    outputDir = path.join(tempDir, '_site');

    // Create directory structure
    const inputDir = path.join(tempDir, 'src');
    const dataDir = path.join(inputDir, '_data');
    await fs.promises.mkdir(inputDir, { recursive: true });
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Use our builder for consistent test data
    const websiteConfig = new WebsiteConfigBuilder()
      .withTitle('Test Website')
      .withUrl('https://test.example.com')
      .withAuthor('Test Author', 'test@example.com')
      .withRSLEnabled() // Fluent API for RSL configuration
      .build();

    // Verify the config is valid using custom matcher
    expect(websiteConfig).toBeValidWebsiteConfig();
    expect(websiteConfig.rsl).toHaveValidRSLStructure();

    await fs.promises.writeFile(path.join(dataDir, 'website.json'), JSON.stringify(websiteConfig, null, 2));

    // Create test assets
    await fs.promises.writeFile(path.join(inputDir, 'test-image.jpg'), Buffer.from('fake-jpg-data'));
    await fs.promises.writeFile(path.join(inputDir, 'readme.md'), '# Test Site\n\nThis is a test website.');

    // Use MockFactory for consistent mock setup
    mockEleventyConfig = MockFactory.createMockEleventyConfig();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
    MockFactory.resetAllMocks();
  });

  describe('Plugin Initialization', () => {
    it('should initialize RSL plugin without errors', () => {
      expect(() => {
        addRSL(mockEleventyConfig as any);
      }).not.toThrow();

      expect(mockEleventyConfig.addCollection).toHaveBeenCalledWith('_rslCollectionCapture', expect.any(Function));
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });
  });

  describe('RSL File Generation', () => {
    it('should generate valid RSL files during build', async () => {
      // Initialize the plugin
      addRSL(mockEleventyConfig as any);

      // Get registered handlers
      const collectionFn = mockEleventyConfig.collections?.get('_rslCollectionCapture');
      const afterBuildHandler = mockEleventyConfig.events?.get('eleventy.after');

      expect(collectionFn).toBeDefined();
      expect(afterBuildHandler).toBeDefined();

      // Set up collections
      collectionFn!(mockCollectionApi);

      // Create mock build results using our builder
      const mockResults = [
        new CollectionItemBuilder()
          .withUrl('/index.html')
          .withData({
            title: 'Home Page',
            website: new WebsiteConfigBuilder()
              .withTitle('Test Website')
              .withUrl('https://test.example.com')
              .withRSL({
                enabled: true,
                defaultOutputFormats: ['sitewide'],
                defaultLicense: {
                  permits: [{ type: 'usage', values: ['view'] }],
                  payment: { type: 'free', attribution: true },
                  copyright: 'Test Copyright',
                },
                contentDiscovery: { enabled: false },
              })
              .build(),
          })
          .withTemplateContent('<h1>Home</h1>')
          .build(),
      ];

      // Simulate the after-build event
      await afterBuildHandler!({
        dir: {
          input: path.join(tempDir, 'src'),
          output: outputDir,
        },
        results: mockResults,
      });

      // Verify RSL file generation
      const siteRSLPath = path.join(outputDir, 'rsl.xml');
      expect(fs.existsSync(siteRSLPath)).toBe(true);

      const rslContent = fs.readFileSync(siteRSLPath, 'utf-8');

      // Using custom assertion for XML validation
      expect(rslContent).toBeValidXML();
      expect(rslContent).toContain('url="https://test.example.com/index.html"');
      expect(rslContent).toContain('Test Copyright');
    });

    it('should handle missing website configuration gracefully', async () => {
      // Remove the website configuration file
      const configPath = path.join(tempDir, 'src', '_data', 'website.json');
      await fs.promises.unlink(configPath);

      addRSL(mockEleventyConfig as any);
      const afterBuildHandler = mockEleventyConfig.events?.get('eleventy.after');

      // Should not throw when config is missing
      await expect(
        afterBuildHandler!({
          dir: {
            input: path.join(tempDir, 'src'),
            output: outputDir,
          },
          results: [TestData.page('Test Page')], // Using TestData convenience method
        })
      ).resolves.not.toThrow();

      // No RSL files should be generated
      const siteRSLPath = path.join(outputDir, 'rsl.xml');
      expect(fs.existsSync(siteRSLPath)).toBe(false);
    });

    it('should respect disabled RSL configuration', async () => {
      // Update config to disable RSL using our builder
      const disabledConfig = new WebsiteConfigBuilder()
        .withTitle('Test Website')
        .withRSLDisabled() // Fluent method for disabled RSL
        .build();

      const configPath = path.join(tempDir, 'src', '_data', 'website.json');
      await fs.promises.writeFile(configPath, JSON.stringify(disabledConfig, null, 2));

      addRSL(mockEleventyConfig as any);
      const afterBuildHandler = mockEleventyConfig.events?.get('eleventy.after');

      await afterBuildHandler!({
        dir: {
          input: path.join(tempDir, 'src'),
          output: outputDir,
        },
        results: [TestData.page()],
      });

      // No RSL files should be generated when disabled
      const siteRSLPath = path.join(outputDir, 'rsl.xml');
      expect(fs.existsSync(siteRSLPath)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty build results gracefully', async () => {
      addRSL(mockEleventyConfig as any);
      const afterBuildHandler = mockEleventyConfig.events?.get('eleventy.after');

      // Should complete without errors when no results are provided
      await expect(
        afterBuildHandler!({
          dir: {
            input: path.join(tempDir, 'src'),
            output: outputDir,
          },
          results: [], // Empty results
        })
      ).resolves.not.toThrow();
    });

    it('should validate collection items correctly', () => {
      const validItem = new CollectionItemBuilder().asBlogPost().build();
      const invalidItem = { url: '/test/', incomplete: true };

      // Using custom matchers for validation
      expect(validItem).toBeValidCollectionItem();
      expect(invalidItem).not.toBeValidCollectionItem();
    });
  });

  describe('Configuration Validation', () => {
    it('should work with comprehensive RSL configurations', () => {
      const comprehensiveConfig = new WebsiteConfigBuilder()
        .comprehensive() // Includes full RSL setup
        .build();

      // Validate the comprehensive configuration
      expect(comprehensiveConfig).toBeValidWebsiteConfig();
      expect(comprehensiveConfig.rsl).toHaveValidRSLStructure();
      expect(comprehensiveConfig.url).toBeValidURL();
    });

    it('should validate website names for security', () => {
      const secureNames = ['valid-site', 'My Website', 'site123'];
      const insecureNames = ['../etc', 'site<script>', 'con', ''];

      secureNames.forEach((name) => {
        expect(name).toBeValidWebsiteName();
      });

      insecureNames.forEach((name) => {
        expect(name).not.toBeValidWebsiteName();
      });
    });
  });
});
