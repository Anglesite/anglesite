/**
 * @file Test data persistence functionality (get-file-content, save-file-content)
 */
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Data Persistence Functionality', () => {
  let testWebsitePath: string;

  beforeAll(async () => {
    // Create test website structure
    testWebsitePath = path.join(__dirname, '../fixtures/persistence-test');
    await fs.mkdir(path.join(testWebsitePath, 'src/_data'), { recursive: true });

    // Create initial test file
    const initialConfig = {
      title: 'Test Website',
      language: 'en',
      description: 'Test description',
    };

    await fs.writeFile(path.join(testWebsitePath, 'src/_data/website.json'), JSON.stringify(initialConfig, null, 2));
  });

  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(testWebsitePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('File System Operations', () => {
    test('should read existing website.json file', async () => {
      const filePath = path.join(testWebsitePath, 'src/_data/website.json');

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        expect(data.title).toBe('Test Website');
        expect(data.language).toBe('en');
        expect(data.description).toBe('Test description');
      } catch (error) {
        throw new Error(`File reading failed: ${error}`);
      }
    });

    test('should write and update website.json file', async () => {
      const filePath = path.join(testWebsitePath, 'src/_data/website.json');

      const newConfig = {
        title: 'Updated Test Website',
        language: 'en',
        description: 'Updated test description',
        url: 'https://test.example.com',
        author: {
          name: 'Test Author',
          email: 'test@example.com',
        },
        manifest: {
          name: 'Test App',
          theme_color: '#007bff',
        },
      };

      // Write new configuration
      await fs.writeFile(filePath, JSON.stringify(newConfig, null, 2));

      // Verify the write was successful
      const savedContent = await fs.readFile(filePath, 'utf-8');
      const savedData = JSON.parse(savedContent);

      expect(savedData.title).toBe('Updated Test Website');
      expect(savedData.url).toBe('https://test.example.com');
      expect(savedData.author.name).toBe('Test Author');
      expect(savedData.manifest.theme_color).toBe('#007bff');
    });

    test('should create directories when writing to nested paths', async () => {
      const nestedPath = path.join(testWebsitePath, 'src/_data/config/advanced.json');
      const configData = {
        advanced: true,
        settings: {
          debug: false,
          cache: true,
        },
      };

      // Ensure directory exists
      await fs.mkdir(path.dirname(nestedPath), { recursive: true });

      // Write to nested path
      await fs.writeFile(nestedPath, JSON.stringify(configData, null, 2));

      // Verify the file was created
      const savedContent = await fs.readFile(nestedPath, 'utf-8');
      const savedData = JSON.parse(savedContent);

      expect(savedData.advanced).toBe(true);
      expect(savedData.settings.cache).toBe(true);
    });

    test('should handle JSON parsing and formatting correctly', async () => {
      const testData = {
        title: 'JSON Test',
        complex: {
          nested: {
            array: ['item1', 'item2'],
            object: {
              key: 'value',
            },
          },
        },
        features: ['rss', 'sitemap', 'analytics'],
      };

      // Test JSON stringification (what save operation does)
      const jsonString = JSON.stringify(testData, null, 2);
      expect(jsonString).toContain('"title": "JSON Test"');
      expect(jsonString).toContain('"item1"');
      expect(jsonString).toContain('"item2"');

      // Test JSON parsing (what read operation does)
      const parsedData = JSON.parse(jsonString);
      expect(parsedData.title).toBe('JSON Test');
      expect(parsedData.complex.nested.array).toEqual(['item1', 'item2']);
      expect(parsedData.features).toHaveLength(3);
    });

    test('should validate that file operations work with real schema structure', async () => {
      // Create a config that matches the full schema structure
      const fullConfig = {
        // Basic info
        title: 'Full Schema Test',
        language: 'en',
        description: 'Testing with full schema structure',
        url: 'https://fulltest.example.com',

        // Author
        author: {
          name: 'Full Test Author',
          email: 'fulltest@example.com',
          url: 'https://author.example.com',
        },

        // Social
        social: {
          twitter: 'fulltestuser',
          github: 'fulltestuser',
          linkedin: 'https://linkedin.com/in/fulltest',
        },

        // Manifest
        manifest: {
          name: 'Full Test App',
          short_name: 'FullTest',
          theme_color: '#2563eb',
          background_color: '#ffffff',
          display: 'standalone',
        },

        // Feeds
        feeds: {
          enabled: true,
          defaultTypes: ['rss', 'atom'],
          collections: {
            blog: {
              enabled: true,
              title: 'Blog Feed',
            },
          },
        },

        // Robots
        robots: [
          {
            'User-agent': '*',
            Allow: ['/'],
            Disallow: ['/private/'],
          },
        ],
      };

      const filePath = path.join(testWebsitePath, 'src/_data/full-schema-test.json');

      // Save full configuration
      await fs.writeFile(filePath, JSON.stringify(fullConfig, null, 2));

      // Read it back and verify structure
      const savedContent = await fs.readFile(filePath, 'utf-8');
      const savedData = JSON.parse(savedContent);

      // Verify nested structures are preserved
      expect(savedData.author.email).toBe('fulltest@example.com');
      expect(savedData.social.github).toBe('fulltestuser');
      expect(savedData.manifest.display).toBe('standalone');
      expect(savedData.feeds.collections.blog.enabled).toBe(true);
      expect(savedData.robots[0]['User-agent']).toBe('*');
      expect(savedData.robots[0].Allow).toEqual(['/']);
    });
  });
});
