/**
 * Test utilities and helpers for maintainability
 */

import type { AnglesiteWebsiteConfiguration } from '../../types/website.js';
import type { EleventyCollectionItem } from '@11ty/eleventy';

/**
 * Creates a minimal website configuration for testing
 */
export function createMockWebsiteConfig(
  overrides?: Partial<AnglesiteWebsiteConfiguration>
): AnglesiteWebsiteConfiguration {
  return {
    title: 'Test Site',
    url: 'https://example.com',
    language: 'en',
    ...overrides,
  };
}

/**
 * Creates a mock Eleventy collection item for testing
 */
export function createMockCollectionItem(overrides?: Partial<EleventyCollectionItem>): EleventyCollectionItem {
  return {
    url: '/test/',
    date: new Date('2024-01-01'),
    inputPath: './src/test.md',
    outputPath: './dist/test/index.html',
    data: {},
    templateContent: '<p>Test content</p>',
    ...overrides,
  } as EleventyCollectionItem;
}

/**
 * Creates a mock Eleventy config for testing
 */
export function createMockEleventyConfig() {
  return {
    on: jest.fn(),
    addCollection: jest.fn(),
    addShortcode: jest.fn(),
    addAsyncShortcode: jest.fn(),
    addFilter: jest.fn(),
    addTransform: jest.fn(),
    addPlugin: jest.fn(),
    setDataFileBaseName: jest.fn(),
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_layouts',
      data: '_data',
    },
  };
}

/**
 * Creates a mock file system interface for testing
 */
export function createMockFileSystem() {
  return {
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('{}'),
    mkdir: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mock console methods for testing
 */
export function mockConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const mockLog = jest.spyOn(console, 'log').mockImplementation();
  const mockError = jest.spyOn(console, 'error').mockImplementation();
  const mockWarn = jest.spyOn(console, 'warn').mockImplementation();

  return {
    mockLog,
    mockError,
    mockWarn,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      mockLog.mockRestore();
      mockError.mockRestore();
      mockWarn.mockRestore();
    },
  };
}

/**
 * Extracts event handler from mock Eleventy config
 */
export function extractEventHandler(mockConfig: ReturnType<typeof createMockEleventyConfig>, eventName: string) {
  return (mockConfig.on as jest.Mock).mock.calls.find((call) => call[0] === eventName)?.[1];
}

/**
 * Extracts collection handler from mock Eleventy config
 */
export function extractCollectionHandler(
  mockConfig: ReturnType<typeof createMockEleventyConfig>,
  collectionName: string
) {
  return (mockConfig.addCollection as jest.Mock).mock.calls.find((call) => call[0] === collectionName)?.[1];
}

/**
 * Asserts that a string is valid XML
 */
export function assertValidXml(xmlString: string): void {
  expect(xmlString).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  expect(xmlString.trim()).not.toBe('');

  // Basic XML structure validation
  const openTags = (xmlString.match(/<[^/!?][^>]*>/g) || []).length;
  const closeTags = (xmlString.match(/<\/[^>]+>/g) || []).length;
  const selfClosingTags = (xmlString.match(/<[^>]*\/>/g) || []).length;

  // For self-closing tags, each counts as both open and close
  expect(openTags - selfClosingTags).toBe(closeTags);
}

/**
 * Asserts that a string is valid JSON
 */
export function assertValidJson(jsonString: string): void {
  expect(() => JSON.parse(jsonString)).not.toThrow();

  const parsed = JSON.parse(jsonString);
  expect(typeof parsed).toBe('object');
  expect(parsed).not.toBeNull();
}

/**
 * Common test patterns for plugin testing
 */
export const testPatterns = {
  /**
   * Standard test for plugin registration
   */
  pluginRegistration: (pluginFn: (config: any) => void) => {
    const mockConfig = createMockEleventyConfig();

    expect(() => pluginFn(mockConfig)).not.toThrow();
    expect(mockConfig.on).toHaveBeenCalled();
  },

  /**
   * Standard test for empty results handling
   */
  emptyResults: async (eventHandler: (event: any) => Promise<void>) => {
    const mockEvent = {
      dir: { input: '/input', output: '/output' },
      results: [],
    };

    await expect(eventHandler(mockEvent)).resolves.not.toThrow();
  },

  /**
   * Standard test for missing configuration handling
   */
  missingConfig: async (eventHandler: (event: any) => Promise<void>) => {
    const mockEvent = {
      dir: { input: '/input', output: '/output' },
      results: [{}], // No website data
    };

    await expect(eventHandler(mockEvent)).resolves.not.toThrow();
  },
};
