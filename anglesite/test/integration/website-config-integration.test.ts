/**
 * @file Integration test for the complete website configuration feature
 */
import * as fs from 'fs/promises';
import * as path from 'path';

// Type definitions for IPC handler responses
interface SchemaResult {
  schema?: Record<string, unknown>;
  error?: string;
  warnings?: string[];
  fallbackSchema?: Record<string, unknown>;
}

// Import the module to spy on it
import * as websiteManager from '../../src/main/utils/website-manager';

// Note: Using global electron mock from Jest setup (includes both handle and on)

describe('Website Configuration Integration Tests', () => {
  let mockHandlers: Record<string, (...args: unknown[]) => unknown>;
  let testWebsitePath: string;

  beforeAll(async () => {
    // Setup test environment
    testWebsitePath = path.join(__dirname, '../fixtures/integration-test/test-website');
    await setupTestEnvironment();

    // Set up spy on getWebsitePath to return test paths
    jest.spyOn(websiteManager, 'getWebsitePath').mockImplementation((websiteName: string) => {
      const testPath = path.join(__dirname, '../fixtures/integration-test', websiteName);
      console.log('Spied getWebsitePath called with:', websiteName, 'returning:', testPath);
      return testPath;
    });

    // Clear require cache for all related modules to ensure fresh imports
    const reactEditorPath = require.resolve('../../src/main/ipc/react-editor');
    const schemaPath = require.resolve('../../src/main/ipc/schema');

    delete require.cache[reactEditorPath];
    delete require.cache[schemaPath];

    // Track registered handlers
    mockHandlers = {};
    const { ipcMain } = require('electron');
    (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers[channel] = handler;
    });

    // Import and setup handlers AFTER the module is mocked
    const { setupReactEditorHandlers } = require('../../src/main/ipc/react-editor');
    const { setupSchemaHandlers } = require('../../src/main/ipc/schema');

    setupReactEditorHandlers();
    setupSchemaHandlers();
  });

  afterAll(async () => {
    // Reset mocks and spies
    jest.restoreAllMocks();
    jest.resetModules();
    jest.clearAllMocks();

    // Cleanup
    try {
      await fs.rm(path.join(__dirname, '../fixtures/integration-test'), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Complete workflow: schema loading + data persistence', () => {
    test('should load schema, read existing data, and save new data', async () => {
      const mockEvent = { sender: {} };

      // 1. Test schema loading
      console.log('1. Testing schema loading...');
      const getSchemaHandler = mockHandlers['get-website-schema'];
      expect(getSchemaHandler).toBeDefined();

      const schemaResult = (await getSchemaHandler(mockEvent, 'test-website')) as SchemaResult;
      console.log('Schema result:', schemaResult ? 'Success' : 'Failed');

      // Should have either a schema or fallback
      expect(schemaResult).toBeDefined();
      expect(schemaResult.schema || schemaResult.fallbackSchema).toBeDefined();

      // 2. Test loading existing data
      console.log('2. Testing data loading...');
      const getFileHandler = mockHandlers['get-file-content'];
      expect(getFileHandler).toBeDefined();

      const existingData = (await getFileHandler(mockEvent, 'test-website', 'src/_data/website.json')) as string | null;
      console.log('Existing data loaded:', existingData ? existingData.length + ' characters' : 'None');

      // 3. Test saving new data
      console.log('3. Testing data saving...');
      const saveFileHandler = mockHandlers['save-file-content'];
      expect(saveFileHandler).toBeDefined();

      const newWebsiteConfig = {
        title: 'Integration Test Website',
        language: 'en',
        description: 'A test website for integration testing',
        url: 'https://integration-test.example.com',
        author: {
          name: 'Test Author',
          email: 'test@example.com',
        },
        manifest: {
          name: 'Integration Test App',
          theme_color: '#007bff',
        },
      };

      const saveResult = await saveFileHandler(
        mockEvent,
        'test-website',
        'src/_data/website.json',
        JSON.stringify(newWebsiteConfig, null, 2)
      );

      expect(saveResult).toBe(true);
      console.log('✓ Data saved successfully');

      // 4. Verify the saved data can be read back
      console.log('4. Verifying saved data...');
      const savedData = (await getFileHandler(mockEvent, 'test-website', 'src/_data/website.json')) as string;
      expect(savedData).toBeDefined();

      const parsedSavedData = JSON.parse(savedData);
      expect(parsedSavedData.title).toBe('Integration Test Website');
      expect(parsedSavedData.author.name).toBe('Test Author');
      expect(parsedSavedData.manifest.theme_color).toBe('#007bff');

      console.log('✓ Data verification successful');
      console.log('✓ Complete workflow integration test passed');
    });

    test('should handle schema fallback when anglesite-11ty is not available', async () => {
      const mockEvent = { sender: {} };

      // Test with a website that doesn't have anglesite-11ty available
      const getSchemaHandler = mockHandlers['get-website-schema'];
      const schemaResult = (await getSchemaHandler(mockEvent, 'test-website-no-schema')) as SchemaResult;

      // Should fallback gracefully
      expect(schemaResult.error).toBeDefined();
      expect(schemaResult.fallbackSchema).toBeDefined();
      expect((schemaResult.fallbackSchema?.properties as Record<string, unknown>)?.title).toBeDefined();

      console.log('✓ Schema fallback works correctly');
    });

    test('should create directories when saving to new paths', async () => {
      const mockEvent = { sender: {} };
      const saveFileHandler = mockHandlers['save-file-content'];

      // Test saving to a nested path that doesn't exist
      const result = await saveFileHandler(
        mockEvent,
        'test-website',
        'src/_data/config/advanced.json',
        '{"test": "data"}'
      );

      expect(result).toBe(true);

      // Verify the file was created (using real getWebsitePath since spy isn't overriding)
      const realWebsitePath = websiteManager.getWebsitePath('test-website');
      const filePath = path.join(realWebsitePath, 'src/_data/config/advanced.json');
      const fileExists = await fs.access(filePath).then(
        () => true,
        () => false
      );
      expect(fileExists).toBe(true);

      console.log('✓ Directory creation works correctly');
    });
  });

  async function setupTestEnvironment(): Promise<void> {
    // Create test website structure
    const srcDataPath = path.join(testWebsitePath, 'src/_data');
    await fs.mkdir(srcDataPath, { recursive: true });

    // Create initial website.json
    const initialConfig = {
      title: 'Initial Test Website',
      language: 'en',
      description: 'Initial configuration for testing',
    };

    await fs.writeFile(path.join(srcDataPath, 'website.json'), JSON.stringify(initialConfig, null, 2));

    // Create a mock anglesite-11ty schema structure (simplified)
    const anglesitePath = path.join(testWebsitePath, '../../anglesite-11ty/schemas');
    await fs.mkdir(anglesitePath, { recursive: true });

    const mockSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Mock Website Schema',
      type: 'object',
      properties: {
        title: { type: 'string' },
        language: { type: 'string' },
        description: { type: 'string' },
      },
    };

    await fs.writeFile(path.join(anglesitePath, 'website.schema.json'), JSON.stringify(mockSchema, null, 2));

    console.log('✓ Test environment setup complete');
  }
});
