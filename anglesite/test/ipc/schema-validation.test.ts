/**
 * @file Unit tests for schema validation and resolution
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
// import * as path from 'path'; // Not used in this test file
import { setupSchemaHandlers } from '../../src/main/ipc/schema';

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/test/userData'),
    getName: jest.fn(() => 'Test App'),
  },
  ipcMain: {
    handle: jest.fn(),
  },
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

// Use doMock to ensure mock is applied before module caching
jest.doMock('../../src/main/utils/website-manager', () => ({
  getWebsitePath: jest.fn((websiteName: string) => `/test/websites/${websiteName}`),
  WebsiteManager: jest.fn().mockImplementation(() => ({
    getWebsitePath: jest.fn((websiteName: string) => `/test/websites/${websiteName}`),
  })),
  createStubAtomicOperations: jest.fn(),
}));

describe('Schema Validation and Resolution', () => {
  let mockHandlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlers = {};

    // Capture registered handlers
    (ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers[channel] = handler;
    });

    // Setup handlers
    setupSchemaHandlers();
  });

  describe('Schema Loading', () => {
    it('should successfully load and parse a valid schema', async () => {
      const mockSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Test Schema',
        type: 'object',
        properties: {
          title: { type: 'string' },
          language: { type: 'string' },
        },
      };

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockSchema));

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      expect(result.schema).toBeDefined();
      expect(result.schema.title).toBe('Test Schema');
      expect(result.error).toBeUndefined();
    });

    it('should return fallback schema when schema directory does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      expect(result.error).toBeDefined();
      expect(result.fallbackSchema).toBeDefined();
      expect(result.fallbackSchema.properties.title).toBeDefined();
    });

    it('should handle JSON parsing errors gracefully', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('invalid json {');

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      expect(result.error).toContain('JSON parsing error');
      expect(result.fallbackSchema).toBeDefined();
    });

    it('should handle missing website name', async () => {
      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, '')) as { schema?: any; error?: string; fallbackSchema?: any };

      expect(result.error).toContain('Website name is required');
      expect(result.fallbackSchema).toBeDefined();
    });
  });

  describe('Schema Module Resolution', () => {
    it('should resolve schema with allOf references', async () => {
      const mainSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Main Schema',
        type: 'object',
        allOf: [{ $ref: './modules/basic-info.json' }, { $ref: './modules/author.json' }],
      };

      const basicInfoModule = {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title'],
      };

      const authorModule = {
        type: 'object',
        properties: {
          author: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      };

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('website.schema.json')) {
          return Promise.resolve(JSON.stringify(mainSchema));
        }
        if (filePath.includes('basic-info.json')) {
          return Promise.resolve(JSON.stringify(basicInfoModule));
        }
        if (filePath.includes('author.json')) {
          return Promise.resolve(JSON.stringify(authorModule));
        }
        return Promise.reject(new Error('File not found'));
      });

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      expect(result.schema).toBeDefined();
      expect(result.schema.properties.title).toBeDefined();
      expect(result.schema.properties.description).toBeDefined();
      expect(result.schema.properties.author).toBeDefined();
      expect(result.schema.required).toContain('title');
    });

    it('should handle missing module references with warnings', async () => {
      const mainSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Main Schema',
        type: 'object',
        allOf: [{ $ref: './modules/exists.json' }, { $ref: './modules/missing.json' }],
      };

      const existsModule = {
        type: 'object',
        properties: {
          title: { type: 'string' },
        },
      };

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('website.schema.json')) {
          return Promise.resolve(JSON.stringify(mainSchema));
        }
        if (filePath.includes('exists.json')) {
          return Promise.resolve(JSON.stringify(existsModule));
        }
        return Promise.reject(new Error('File not found'));
      });

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as {
        schema?: any;
        error?: string;
        fallbackSchema?: any;
        warnings?: string[];
      };

      expect(result.schema).toBeDefined();
      expect(result.schema.properties.title).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Failed to load module: missing');
    });
  });

  describe('Schema Internal References', () => {
    it('should resolve internal $ref to common definitions', async () => {
      const mainSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Main Schema',
        type: 'object',
        allOf: [{ $ref: './modules/contact.json' }],
      };

      const contactModule = {
        type: 'object',
        properties: {
          email: { $ref: './common.json#/definitions/email' },
          phone: { type: 'string' },
        },
      };

      const commonDefinitions = {
        definitions: {
          email: {
            type: 'string',
            format: 'email',
            pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
          },
        },
      };

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('website.schema.json')) {
          return Promise.resolve(JSON.stringify(mainSchema));
        }
        if (filePath.includes('contact.json')) {
          return Promise.resolve(JSON.stringify(contactModule));
        }
        if (filePath.includes('common.json')) {
          return Promise.resolve(JSON.stringify(commonDefinitions));
        }
        return Promise.reject(new Error('File not found'));
      });

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      expect(result.schema).toBeDefined();
      expect(result.schema.properties.email).toBeDefined();
      expect(result.schema.properties.email.format).toBe('email');
      expect(result.schema.properties.email.pattern).toBeDefined();
    });

    it('should handle circular references gracefully', async () => {
      const schemaA = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Schema A',
        type: 'object',
        allOf: [{ $ref: './modules/circular.json' }],
      };

      const circularModule = {
        type: 'object',
        properties: {
          self: { $ref: './circular.json' },
          name: { type: 'string' },
        },
      };

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if (filePath.includes('website.schema.json')) {
          return Promise.resolve(JSON.stringify(schemaA));
        }
        if (filePath.includes('circular.json')) {
          return Promise.resolve(JSON.stringify(circularModule));
        }
        return Promise.reject(new Error('File not found'));
      });

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      // Should not throw or enter infinite loop
      expect(result.schema).toBeDefined();
      expect(result.schema.properties.name).toBeDefined();
    });
  });

  describe('Get Schema Module', () => {
    it('should load individual schema module', async () => {
      const testModule = {
        type: 'object',
        properties: {
          test: { type: 'string' },
        },
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(testModule));

      const handler = mockHandlers['get-schema-module'];
      const result = (await handler({}, 'test-website', 'test-module')) as any;

      expect(result).toBeDefined();
      expect(result.properties.test).toBeDefined();
    });

    it('should handle missing module with appropriate error', async () => {
      const error = new Error('ENOENT');
      (error as any).code = 'ENOENT';
      (fs.readFile as jest.Mock).mockRejectedValue(error);

      const handler = mockHandlers['get-schema-module'];

      await expect(handler({}, 'test-website', 'missing-module')).rejects.toThrow('Module not found: missing-module');
    });

    it('should handle invalid JSON in module', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('invalid json {');

      const handler = mockHandlers['get-schema-module'];

      await expect(handler({}, 'test-website', 'invalid-module')).rejects.toThrow('Failed to parse module');
    });
  });

  describe('Fallback Schema', () => {
    it('should provide complete fallback schema with all basic fields', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const handler = mockHandlers['get-website-schema'];
      const result = (await handler({}, 'test-website')) as { schema?: any; error?: string; fallbackSchema?: any };

      const fallback = result.fallbackSchema;
      expect(fallback).toBeDefined();
      expect(fallback.type).toBe('object');
      expect(fallback.required).toContain('title');
      expect(fallback.required).toContain('language');
      expect(fallback.properties.title).toBeDefined();
      expect(fallback.properties.language).toBeDefined();
      expect(fallback.properties.description).toBeDefined();
      expect(fallback.properties.url).toBeDefined();
      expect(fallback.properties.author).toBeDefined();
    });
  });
});
