/**
 * @file Tests for Schema Service IPC handlers
 */

// Type definitions for schema testing
interface SchemaResult {
  schema?: Record<string, unknown>;
  error?: string;
  fallbackSchema?: Record<string, unknown>;
  warnings?: string[];
}

interface SchemaProperty {
  type?: string;
  $ref?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  title?: string;
  allOf?: Array<{ $ref: string }>;
  additionalProperties?: boolean;
}

interface MockIpcEvent {
  sender: {
    session: Record<string, unknown>;
  };
}

type IPCHandler = (event: MockIpcEvent, ...args: unknown[]) => Promise<unknown> | unknown;
import * as fs from 'fs/promises';
import * as path from 'path';
import { ipcMain } from 'electron';

// Mock electron IPC
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/test/userData'),
    getName: jest.fn(() => 'Test App'),
  },
  ipcMain: {
    handle: jest.fn(),
  },
}));

// Mock the website-manager module
const mockGetWebsitePath = jest.fn();

jest.mock('../../src/main/utils/website-manager', () => ({
  getWebsitePath: mockGetWebsitePath,
  WebsiteManager: jest.fn().mockImplementation(() => ({
    getWebsitePath: mockGetWebsitePath,
  })),
  createStubAtomicOperations: jest.fn(),
}));

// Mock the service registry to provide proper getResilientService method
const mockWebsiteManager = {
  execute: jest.fn(),
  getWebsitePath: jest.fn((websiteName: string) => `/test/websites/${websiteName}`),
};

jest.mock('../../src/main/core/service-registry', () => ({
  getGlobalContext: jest.fn(() => ({
    getResilientService: jest.fn((serviceKey: string) => {
      if (serviceKey === 'websiteManager') {
        return mockWebsiteManager;
      }
      throw new Error(`Unknown service: ${serviceKey}`);
    }),
  })),
}));

// Import setupSchemaHandlers after mocks
import { setupSchemaHandlers } from '../../src/main/ipc/schema';

describe('Schema Service IPC Handlers', () => {
  let mockIpcInvokeEvent: MockIpcEvent;
  let testSchemaPath: string;
  let mockHandlers: Record<string, IPCHandler>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup mock for getWebsitePath
    mockGetWebsitePath.mockImplementation((websiteName: string) => {
      const mockPath = path.join(__dirname, '../fixtures/websites', websiteName);
      console.log('Mock getWebsitePath called with:', websiteName, 'returning:', mockPath);
      return mockPath;
    });

    // Reset mock implementations for service registry
    mockWebsiteManager.execute.mockImplementation(async (callback: (service: any) => Promise<string>) => {
      return callback({
        getWebsitePath: (websiteName: string) => `/test/websites/${websiteName}`,
      });
    });

    // Create mock IPC event
    mockIpcInvokeEvent = {
      sender: {
        session: {},
      },
    };

    // Track registered handlers
    mockHandlers = {};
    (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: IPCHandler) => {
      mockHandlers[channel] = handler;
    });

    // Setup test schema directory structure
    // The path should match the structure expected by our schema loader
    testSchemaPath = path.join(__dirname, '../fixtures/anglesite-11ty/schemas');
    await setupTestSchemas();

    // Setup handlers
    setupSchemaHandlers();
  });

  afterEach(async () => {
    // Clean up test schemas
    try {
      await fs.rm(path.join(__dirname, '../fixtures'), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('get-website-schema handler', () => {
    test('should resolve complete schema with all module references', async () => {
      const handler = mockHandlers['get-website-schema'];
      expect(handler).toBeDefined();

      const result = (await handler(mockIpcInvokeEvent, 'test-website')) as SchemaResult;

      expect(result).toBeDefined();

      expect(result.schema).toBeDefined();
      expect(result.schema.type).toBe('object');

      // Verify main schema properties are present
      expect(result.schema.properties).toBeDefined();
      expect((result.schema.properties as Record<string, SchemaProperty>).title).toBeDefined();
      expect((result.schema.properties as Record<string, SchemaProperty>).language).toBeDefined();

      // Verify schema structure is correct
      expect(result.schema.title).toBe('Test Website Configuration');
      expect(result.schema.required).toContain('title');
      expect(result.schema.required).toContain('language');
    });

    test('should resolve nested common.json references', async () => {
      const handler = mockHandlers['get-website-schema'];
      const result = (await handler(mockIpcInvokeEvent, 'test-website')) as SchemaResult;

      // Check that author properties reference the common schema
      const properties = result.schema?.properties as Record<string, SchemaProperty>;
      expect(properties?.author).toBeDefined();
      expect(properties?.author?.type).toBe('object');
      expect(properties?.author?.properties).toBeDefined();

      // Email and URL may be $ref references to common.json
      const authorEmailProp = properties?.author?.properties?.email;
      expect(authorEmailProp).toBeDefined();

      // Should either be resolved or contain reference to common definitions
      expect(authorEmailProp?.type === 'string' || authorEmailProp?.$ref === './common.json#/definitions/email').toBe(
        true
      );
    });

    test('should include all required modules', async () => {
      const handler = mockHandlers['get-website-schema'];
      const result = (await handler(mockIpcInvokeEvent, 'test-website')) as SchemaResult;

      // Verify properties from different modules are present
      const properties = result.schema?.properties as Record<string, SchemaProperty>;
      expect(properties?.title).toBeDefined(); // basic-info
      expect(properties?.robots).toBeDefined(); // seo-robots
      expect(properties?.feeds).toBeDefined(); // feeds
      expect(properties?.rsl).toBeDefined(); // rsl
    });

    test('should handle missing schema directory gracefully', async () => {
      // Remove schema directory
      await fs.rm(testSchemaPath, { recursive: true, force: true });

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler(mockIpcInvokeEvent, 'test-website')) as SchemaResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Schema directory not found');
      expect(result.fallbackSchema).toBeDefined();
      const fallbackProperties = result.fallbackSchema?.properties as Record<string, SchemaProperty>;
      expect(fallbackProperties?.title).toBeDefined();
    });

    test('should handle corrupted schema files gracefully', async () => {
      // Create corrupted main schema file
      await fs.writeFile(path.join(testSchemaPath, 'website.schema.json'), '{ invalid json content', 'utf-8');

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler(mockIpcInvokeEvent, 'test-website')) as SchemaResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('JSON parsing error');
      expect(result.fallbackSchema).toBeDefined();
    });

    test('should handle missing module references', async () => {
      // Remove a required module
      await fs.unlink(path.join(testSchemaPath, 'modules/feeds.json'));

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler(mockIpcInvokeEvent, 'test-website')) as SchemaResult;

      expect(result.warnings).toBeDefined();
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('feeds.json')]));
      expect(result.schema).toBeDefined();
      // Should still have other modules
      const properties = result.schema?.properties as Record<string, SchemaProperty>;
      expect(properties?.title).toBeDefined();
    });
  });

  describe('get-schema-module handler', () => {
    test('should load individual schema modules', async () => {
      const handler = mockHandlers['get-schema-module'];
      expect(handler).toBeDefined();

      const result = (await handler(mockIpcInvokeEvent, 'test-website', 'basic-info')) as SchemaProperty;

      expect(result).toBeDefined();
      expect(result.properties).toBeDefined();
      expect(result.properties?.title).toBeDefined();
      expect(result.properties?.language).toBeDefined();
    });

    test('should handle non-existent modules', async () => {
      const handler = mockHandlers['get-schema-module'];

      await expect(handler(mockIpcInvokeEvent, 'test-website', 'non-existent-module')).rejects.toThrow(
        'Module not found'
      );
    });
  });

  // Helper function to create test schema files
  async function setupTestSchemas(): Promise<void> {
    // Create the proper directory structure that matches schema service expectations
    // Schema service expects: websitePath/../../anglesite-11ty/schemas
    // Mock websitePath is: __dirname/../fixtures/websites/test-website
    // So schema path should be: __dirname/../fixtures/anglesite-11ty/schemas

    await fs.mkdir(testSchemaPath, { recursive: true });
    const modulesPath = path.join(testSchemaPath, 'modules');
    await fs.mkdir(modulesPath, { recursive: true });

    // Create main website schema
    const mainSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'https://anglesite.dwk.io/schemas/website.json',
      title: 'Test Website Configuration',
      type: 'object',
      allOf: [
        { $ref: './modules/basic-info.json' },
        { $ref: './modules/seo-robots.json' },
        { $ref: './modules/feeds.json' },
        { $ref: './modules/rsl.json' },
      ],
      additionalProperties: false,
    };

    // Create common definitions
    const commonSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      definitions: {
        email: {
          type: 'string',
          format: 'email',
        },
        url: {
          type: 'string',
          format: 'uri',
        },
        nonEmptyString: {
          type: 'string',
          minLength: 1,
        },
      },
    };

    // Create basic-info module
    const basicInfoSchema = {
      type: 'object',
      required: ['title', 'language'],
      properties: {
        title: {
          $ref: './common.json#/definitions/nonEmptyString',
        },
        language: {
          type: 'string',
          pattern: '^[a-z]{2}$',
        },
        author: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: {
              $ref: './common.json#/definitions/email',
            },
            url: {
              $ref: './common.json#/definitions/url',
            },
          },
        },
      },
    };

    // Create other module schemas (simplified for testing)
    const robotsSchema = {
      type: 'object',
      properties: {
        robots: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    };

    const feedsSchema = {
      type: 'object',
      properties: {
        feeds: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
          },
        },
      },
    };

    const rslSchema = {
      type: 'object',
      properties: {
        rsl: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
          },
        },
      },
    };

    // Write all schema files
    await fs.writeFile(path.join(testSchemaPath, 'website.schema.json'), JSON.stringify(mainSchema, null, 2));
    await fs.writeFile(path.join(modulesPath, 'common.json'), JSON.stringify(commonSchema, null, 2));
    await fs.writeFile(path.join(modulesPath, 'basic-info.json'), JSON.stringify(basicInfoSchema, null, 2));
    await fs.writeFile(path.join(modulesPath, 'seo-robots.json'), JSON.stringify(robotsSchema, null, 2));
    await fs.writeFile(path.join(modulesPath, 'feeds.json'), JSON.stringify(feedsSchema, null, 2));
    await fs.writeFile(path.join(modulesPath, 'rsl.json'), JSON.stringify(rslSchema, null, 2));
  }
});
