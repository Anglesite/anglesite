/**
 * @file Custom domain-specific assertions for improved test readability.
 * @description Provides custom Jest matchers for common test scenarios in the application.
 */

import type { MockElectronAPI } from './mock-factory';

// Type for Eleventy collection items
interface EleventyCollectionItem {
  url: string;
  date: Date;
  inputPath: string;
  outputPath: string;
  data: Record<string, unknown>;
  templateContent: string;
}

// Type for website config validation
interface WebsiteConfig {
  title: string;
  url: string;
  language: string;
}

// Type for RSL structure validation
interface RSLStructure {
  enabled: boolean;
  defaultLicense: {
    permits: unknown[];
    payment: Record<string, unknown>;
  };
}

// Type for schema structure validation
interface SchemaStructure {
  type: string;
  properties: Record<string, unknown>;
  title: string;
}

// Type for file structure validation
interface FileStructureItem {
  name: string;
  filePath: string;
  isDirectory: boolean;
  relativePath: string;
}

// Type for Electron display validation
interface ElectronDisplay {
  id: number;
  bounds: Record<string, unknown>;
  workArea: Record<string, unknown>;
  scaleFactor: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeValidWebsiteConfig(): R;
      toBeValidCollectionItem(): R;
      toBeValidXML(): R;
      toBeValidJSON(): R;
      toBeValidFilePath(): R;
      toBeValidWebsiteName(): R;
      toHaveCalledIPC(channel: string, ...args: unknown[]): R;
      toHaveCalledIPCTimes(channel: string, times: number): R;
      toHaveValidRSLStructure(): R;
      toHaveValidSchemaStructure(): R;
      toBeValidURL(): R;
      toHaveValidFileStructure(): R;
      toBeValidElectronDisplay(): R;
      toHaveValidConsoleOutput(level: 'log' | 'error' | 'warn' | 'debug'): R;
    }
  }
}

/**
 * Custom matcher for validating website configurations.
 */
function toBeValidWebsiteConfig(received: unknown) {
  const config = received as WebsiteConfig;
  const pass =
    typeof received === 'object' &&
    received !== null &&
    typeof config.title === 'string' &&
    typeof config.url === 'string' &&
    typeof config.language === 'string' &&
    config.title.length > 0 &&
    config.url.startsWith('http') &&
    config.language.length >= 2;

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${received} not to be a valid website configuration`
        : `Expected ${received} to be a valid website configuration with title (string), url (http/https), and language (2+ chars)`,
  };
}

/**
 * Custom matcher for validating Eleventy collection items.
 */
function toBeValidCollectionItem(received: unknown) {
  const item = received as EleventyCollectionItem;
  const pass =
    typeof item === 'object' &&
    item !== null &&
    typeof item.url === 'string' &&
    item.date instanceof Date &&
    typeof item.inputPath === 'string' &&
    typeof item.outputPath === 'string' &&
    typeof item.data === 'object' &&
    typeof item.templateContent === 'string';

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${received} not to be a valid collection item`
        : `Expected ${received} to be a valid collection item with url, date, inputPath, outputPath, data, and templateContent`,
  };
}

/**
 * Custom matcher for validating XML content.
 */
function toBeValidXML(received: unknown) {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () => `Expected XML to be a string, but received ${typeof received}`,
    };
  }

  const xmlString = received as string;
  const hasXMLDeclaration = xmlString.includes('<?xml version=');
  const hasContent = xmlString.trim().length > 0;

  // Basic XML structure validation
  const openTags = (xmlString.match(/<[^/!?][^>]*>/g) || []).length;
  const closeTags = (xmlString.match(/<\/[^>]+>/g) || []).length;
  const selfClosingTags = (xmlString.match(/<[^>]*\/>/g) || []).length;

  const isBalanced = openTags - selfClosingTags === closeTags;

  const pass = hasXMLDeclaration && hasContent && isBalanced;

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${received} not to be valid XML`
        : `Expected valid XML with declaration, content, and balanced tags. Issues: ${!hasXMLDeclaration ? 'missing declaration, ' : ''}${!hasContent ? 'empty content, ' : ''}${!isBalanced ? 'unbalanced tags' : ''}`,
  };
}

/**
 * Custom matcher for validating JSON content.
 */
function toBeValidJSON(received: unknown) {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () => `Expected JSON to be a string, but received ${typeof received}`,
    };
  }

  try {
    const parsed = JSON.parse(received as string);
    const pass = typeof parsed === 'object' && parsed !== null;

    return {
      pass,
      message: () =>
        pass ? `Expected ${received} not to be valid JSON` : `Expected valid JSON object, but got ${typeof parsed}`,
    };
  } catch (error) {
    return {
      pass: false,
      message: () => `Expected valid JSON, but parsing failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Custom matcher for validating file paths.
 */
function toBeValidFilePath(received: unknown) {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () => `Expected file path to be a string, but received ${typeof received}`,
    };
  }

  const path = received as string;
  const hasInvalidChars = /[<>:"|?*]/.test(path);
  const isEmpty = path.trim().length === 0;
  const isValid = !hasInvalidChars && !isEmpty;

  return {
    pass: isValid,
    message: () =>
      isValid
        ? `Expected ${received} not to be a valid file path`
        : `Expected valid file path, but got invalid characters or empty string in: ${received}`,
  };
}

/**
 * Custom matcher for validating website names.
 */
function toBeValidWebsiteName(received: unknown) {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () => `Expected website name to be a string, but received ${typeof received}`,
    };
  }

  const name = received as string;
  const isEmpty = name.trim().length === 0;
  const hasLeadingSpace = name.startsWith(' ');
  const hasTrailingSpace = name.endsWith(' ');
  const hasInvalidChars = /[<>:"|?*/\\]/.test(name);
  const hasPathTraversal = name.includes('..');
  const isReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name);

  const isValid =
    !isEmpty && !hasLeadingSpace && !hasTrailingSpace && !hasInvalidChars && !hasPathTraversal && !isReservedName;

  return {
    pass: isValid,
    message: () =>
      isValid
        ? `Expected ${received} not to be a valid website name`
        : `Expected valid website name, but got issues: ${isEmpty ? 'empty, ' : ''}${hasLeadingSpace ? 'leading space, ' : ''}${hasTrailingSpace ? 'trailing space, ' : ''}${hasInvalidChars ? 'invalid characters, ' : ''}${hasPathTraversal ? 'path traversal, ' : ''}${isReservedName ? 'reserved name' : ''}`,
  };
}

/**
 * Custom matcher for validating IPC calls.
 */
function toHaveCalledIPC(mockAPI: MockElectronAPI, channel: string, ...expectedArgs: unknown[]) {
  const calls = (mockAPI.invoke as jest.Mock).mock.calls;
  const matchingCall = calls.find(
    (call: unknown[]) =>
      call[0] === channel &&
      (expectedArgs.length === 0 ||
        call.slice(1).every((arg, i) => i >= expectedArgs.length || arg === expectedArgs[i]))
  );

  const pass = !!matchingCall;

  return {
    pass,
    message: () =>
      pass
        ? `Expected not to have called IPC channel ${channel} with args ${JSON.stringify(expectedArgs)}`
        : `Expected to have called IPC channel ${channel} with args ${JSON.stringify(expectedArgs)}, but found calls: ${JSON.stringify(calls)}`,
  };
}

/**
 * Custom matcher for validating IPC call count.
 */
function toHaveCalledIPCTimes(mockAPI: MockElectronAPI, channel: string, expectedTimes: number) {
  const calls = (mockAPI.invoke as jest.Mock).mock.calls;
  const matchingCalls = calls.filter((call: unknown[]) => call[0] === channel);
  const actualTimes = matchingCalls.length;

  const pass = actualTimes === expectedTimes;

  return {
    pass,
    message: () =>
      pass
        ? `Expected not to have called IPC channel ${channel} exactly ${expectedTimes} times`
        : `Expected to have called IPC channel ${channel} ${expectedTimes} times, but was called ${actualTimes} times`,
  };
}

/**
 * Custom matcher for validating RSL structure.
 */
function toHaveValidRSLStructure(received: unknown) {
  const rsl = received as RSLStructure;
  const hasEnabled = typeof rsl?.enabled === 'boolean';
  const hasDefaultLicense = typeof rsl?.defaultLicense === 'object';
  const hasPermits = Array.isArray(rsl?.defaultLicense?.permits);
  const hasPayment = typeof rsl?.defaultLicense?.payment === 'object';

  const pass = hasEnabled && hasDefaultLicense && hasPermits && hasPayment;

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${received} not to have valid RSL structure`
        : `Expected valid RSL structure with enabled (boolean), defaultLicense (object), permits (array), and payment (object)`,
  };
}

/**
 * Custom matcher for validating JSON schema structure.
 */
function toHaveValidSchemaStructure(received: unknown) {
  const schema = received as SchemaStructure;
  const hasType = typeof schema?.type === 'string';
  const hasProperties = typeof schema?.properties === 'object';
  const hasTitle = typeof schema?.title === 'string';

  const pass = hasType && hasProperties && hasTitle;

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${received} not to have valid schema structure`
        : `Expected valid schema structure with type (string), properties (object), and title (string)`,
  };
}

/**
 * Custom matcher for validating URLs.
 */
function toBeValidURL(received: unknown) {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () => `Expected URL to be a string, but received ${typeof received}`,
    };
  }

  try {
    new URL(received as string);
    return {
      pass: true,
      message: () => `Expected ${received} not to be a valid URL`,
    };
  } catch {
    return {
      pass: false,
      message: () => `Expected ${received} to be a valid URL`,
    };
  }
}

/**
 * Custom matcher for validating file structure arrays.
 */
function toHaveValidFileStructure(received: unknown) {
  if (!Array.isArray(received)) {
    return {
      pass: false,
      message: () => `Expected file structure to be an array, but received ${typeof received}`,
    };
  }

  const files = received as FileStructureItem[];
  const allValid = files.every(
    (file) =>
      typeof file === 'object' &&
      typeof file.name === 'string' &&
      typeof file.filePath === 'string' &&
      typeof file.isDirectory === 'boolean' &&
      typeof file.relativePath === 'string'
  );

  return {
    pass: allValid,
    message: () =>
      allValid
        ? `Expected ${received} not to have valid file structure`
        : `Expected valid file structure with objects containing name, filePath, isDirectory, and relativePath`,
  };
}

/**
 * Custom matcher for validating Electron display objects.
 */
function toBeValidElectronDisplay(received: unknown) {
  const display = received as ElectronDisplay;
  const hasId = typeof display?.id === 'number';
  const hasBounds = typeof display?.bounds === 'object';
  const hasWorkArea = typeof display?.workArea === 'object';
  const hasScaleFactor = typeof display?.scaleFactor === 'number';

  const pass = hasId && hasBounds && hasWorkArea && hasScaleFactor;

  return {
    pass,
    message: () =>
      pass
        ? `Expected ${received} not to be a valid Electron display`
        : `Expected valid Electron display with id (number), bounds (object), workArea (object), and scaleFactor (number)`,
  };
}

/**
 * Custom matcher for validating console output.
 */
function toHaveValidConsoleOutput(consoleMock: jest.SpyInstance, level: 'log' | 'error' | 'warn' | 'debug') {
  const wasCalled = consoleMock.mock.calls.length > 0;
  const hasCorrectLevel = consoleMock.mock.calls.some(
    (call: unknown[]) => call.length > 0 && typeof call[0] === 'string'
  );

  const pass = wasCalled && hasCorrectLevel;

  return {
    pass,
    message: () =>
      pass
        ? `Expected console.${level} not to have been called with valid output`
        : `Expected console.${level} to have been called with valid string output`,
  };
}

/**
 * Register all custom matchers with Jest.
 */
export function registerCustomMatchers() {
  // Check if expect is available before trying to extend it
  if (typeof expect !== 'undefined' && expect.extend) {
    expect.extend({
      toBeValidWebsiteConfig,
      toBeValidCollectionItem,
      toBeValidXML,
      toBeValidJSON,
      toBeValidFilePath,
      toBeValidWebsiteName,
      toHaveCalledIPC,
      toHaveCalledIPCTimes,
      toHaveValidRSLStructure,
      toHaveValidSchemaStructure,
      toBeValidURL,
      toHaveValidFileStructure,
      toBeValidElectronDisplay,
      toHaveValidConsoleOutput,
    });
  } else {
    console.warn('Jest expect global not available - custom matchers not registered');
  }
}

/**
 * Convenience functions for common assertion patterns.
 * Created as a factory to avoid accessing expect at module load time.
 */
export function createAssertionHelpers() {
  return {
    /**
     * Assert that an object contains all required website config fields.
     */
    expectCompleteWebsiteConfig(config: unknown) {
      expect(config).toBeValidWebsiteConfig();
      expect(config).toHaveProperty('title');
      expect(config).toHaveProperty('url');
      expect(config).toHaveProperty('language');
    },

    /**
     * Assert that an array contains valid collection items.
     */
    expectValidCollectionItems(items: unknown[]) {
      expect(Array.isArray(items)).toBe(true);
      items.forEach((item) => {
        expect(item).toBeValidCollectionItem();
      });
    },

    /**
     * Assert that IPC was called with website operations.
     */
    expectWebsiteOperations(mockAPI: MockElectronAPI, websiteName: string) {
      expect(mockAPI).toHaveCalledIPC('get-current-website-name');
      expect(mockAPI).toHaveCalledIPC('get-website-files', websiteName);
    },

    /**
     * Assert that error handling works correctly.
     */
    expectErrorHandling(errorObject: unknown, expectedMessage?: string) {
      expect(errorObject).toBeInstanceOf(Error);
      if (expectedMessage) {
        expect((errorObject as Error).message).toContain(expectedMessage);
      }
    },

    /**
     * Assert that console logging works correctly.
     */
    expectConsoleLogging(consoleMock: jest.SpyInstance, level: 'log' | 'error' | 'warn' | 'debug') {
      expect(consoleMock).toHaveValidConsoleOutput(level);
    },
  };
}

/**
 * Pre-created assertion helpers for convenience.
 * Note: Only use these after Jest is fully initialized.
 */
export function getAssertionHelpers() {
  return createAssertionHelpers();
}
