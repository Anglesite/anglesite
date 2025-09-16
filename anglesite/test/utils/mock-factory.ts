/**
 * @file Centralized mock factory for common test dependencies
 * @description Provides reusable mocks to reduce duplication across test files
 */

import type { Display } from 'electron';

export interface MockElectronAPI {
  invoke: jest.Mock;
  send: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
}

export interface MockElectronApp {
  getPath: jest.Mock;
  getName: jest.Mock;
  isReady: jest.Mock;
  whenReady: jest.Mock;
}

export interface MockElectronScreen {
  on: jest.Mock;
  off: jest.Mock;
  removeListener: jest.Mock;
  getAllDisplays: jest.Mock;
  getPrimaryDisplay: jest.Mock;
}

/**
 * Factory class for creating standardized test mocks
 */
export class MockFactory {
  /**
   * Creates a mock ElectronAPI with standard IPC methods
   */
  static createElectronAPI(customResponses?: Record<string, unknown>): MockElectronAPI {
    const mockAPI = {
      invoke: jest.fn(),
      send: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    // Setup default responses for common IPC calls
    mockAPI.invoke.mockImplementation((channel: string, ..._args: unknown[]) => {
      // Handle custom responses first
      if (customResponses && channel in customResponses) {
        return Promise.resolve(customResponses[channel]);
      }

      // Default responses for common channels
      switch (channel) {
        case 'get-current-website-name':
          return Promise.resolve('test-website');
        case 'get-website-files':
          return Promise.resolve([
            { name: 'index.md', filePath: '/path/index.md', isDirectory: false, relativePath: 'index.md' },
            { name: '404.md', filePath: '/path/404.md', isDirectory: false, relativePath: '404.md' },
          ]);
        case 'get-website-schema':
          return Promise.resolve({
            schema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              title: 'Test Website Schema',
              type: 'object',
              required: ['title', 'language'],
              properties: {
                title: { type: 'string', title: 'Website Title' },
                language: { type: 'string', title: 'Language', default: 'en' },
                description: { type: 'string', title: 'Description' },
              },
            },
          });
        case 'get-file-content':
          return Promise.resolve('{"title": "Test Website", "language": "en"}');
        case 'save-file-content':
          return Promise.resolve(true);
        default:
          return Promise.resolve(null);
      }
    });

    return mockAPI;
  }

  /**
   * Sets up the global window.electronAPI mock
   */
  static setupWindowElectronAPI(mockAPI?: MockElectronAPI): MockElectronAPI {
    const api = mockAPI || MockFactory.createElectronAPI();

    Object.defineProperty(window, 'electronAPI', {
      value: api,
      writable: true,
      configurable: true,
    });

    return api;
  }

  /**
   * Creates a mock Electron app object
   */
  static createElectronApp(): MockElectronApp {
    return {
      getPath: jest.fn(() => '/test/userData'),
      getName: jest.fn(() => 'Test App'),
      isReady: jest.fn(() => true),
      whenReady: jest.fn(() => Promise.resolve()),
    };
  }

  /**
   * Creates a mock Electron screen object with realistic display data
   */
  static createElectronScreen(): MockElectronScreen {
    const mockDisplay: Display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      rotation: 0,
      touchSupport: 'unknown',
      monochrome: false,
      accelerometerSupport: 'unknown',
      colorSpace: 'srgb',
      colorDepth: 24,
      depthPerComponent: 8,
      size: { width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1080 },
      internal: false,
      detected: true,
      displayFrequency: 60,
      label: 'Test Display',
      maximumCursorSize: { width: 32, height: 32 },
      nativeOrigin: { x: 0, y: 0 },
    };

    return {
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn(),
      getAllDisplays: jest.fn(() => [mockDisplay]),
      getPrimaryDisplay: jest.fn(() => mockDisplay),
    };
  }

  /**
   * Creates a mock console object for testing console outputs
   */
  static createMockConsole() {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      debug: console.debug,
    };

    const mockConsole = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      debug: jest.spyOn(console, 'debug').mockImplementation(),
    };

    return {
      mocks: mockConsole,
      restore: () => {
        Object.assign(console, originalConsole);
        Object.values(mockConsole).forEach((mock) => mock.mockRestore());
      },
    };
  }

  /**
   * Creates a mock file system interface
   */
  static createFileSystemMock() {
    return {
      writeFileSync: jest.fn(),
      readFileSync: jest.fn(() => '{}'),
      existsSync: jest.fn(() => true),
      mkdirSync: jest.fn(),
      writeFile: jest.fn(() => Promise.resolve()),
      readFile: jest.fn(() => Promise.resolve('{}')),
      mkdir: jest.fn(() => Promise.resolve()),
      stat: jest.fn(() =>
        Promise.resolve({
          isFile: () => true,
          isDirectory: () => false,
          size: 1024,
          mtime: new Date(),
        })
      ),
    };
  }

  /**
   * Sets up comprehensive Electron module mocks
   */
  static setupElectronMocks() {
    jest.mock('electron', () => ({
      app: MockFactory.createElectronApp(),
      screen: MockFactory.createElectronScreen(),
      nativeTheme: {
        shouldUseDarkColors: false,
        themeSource: 'system',
        on: jest.fn(),
      },
      ipcMain: {
        handle: jest.fn(),
        on: jest.fn(),
      },
      BrowserWindow: {
        getAllWindows: jest.fn(() => []),
      },
    }));

    const app = MockFactory.createElectronApp();
    const screen = MockFactory.createElectronScreen();
    return { app, screen };
  }

  /**
   * Creates a temporary directory mock for integration tests
   */
  static createTempDirMock(basePath = '/tmp/test') {
    let counter = 0;

    return {
      create: () => `${basePath}-${++counter}`,
      cleanup: jest.fn(),
      exists: jest.fn(() => true),
    };
  }

  /**
   * Creates a mock EleventyConfig object for testing plugins
   */
  static createMockEleventyConfig() {
    const collections = new Map();
    const events = new Map();

    return {
      collections,
      events,
      addCollection: jest.fn((name: string, fn: (collection: unknown) => unknown[]) => {
        collections.set(name, fn);
      }),
      on: jest.fn((event: string, handler: (data: unknown) => void) => {
        events.set(event, handler);
      }),
      addPassthroughCopy: jest.fn(),
      addTransform: jest.fn(),
      addFilter: jest.fn(),
      addShortcode: jest.fn(),
      addPairedShortcode: jest.fn(),
      addGlobalData: jest.fn(),
      addLayoutAlias: jest.fn(),
      setDataDeepMerge: jest.fn(),
      setFrontMatterParsingOptions: jest.fn(),
      setLibrary: jest.fn(),
      setPugOptions: jest.fn(),
      setLiquidOptions: jest.fn(),
      setNunjucksEnvironmentOptions: jest.fn(),
      setTemplateFormats: jest.fn(),
      setDataFileBaseName: jest.fn(),
      setDataFileSuffixes: jest.fn(),
      setWatchJavaScriptDependencies: jest.fn(),
      setBrowserSyncConfig: jest.fn(),
      setChokidarConfig: jest.fn(),
      setServerOptions: jest.fn(),
      addPlugin: jest.fn(),
    };
  }

  /**
   * Resets all mocks created by the factory
   */
  static resetAllMocks() {
    jest.clearAllMocks();

    // Clear window.electronAPI if it exists
    if ('electronAPI' in window) {
      delete (window as any).electronAPI;
    }
  }
}

/**
 * Convenience function for quick ElectronAPI setup in tests
 */
export function setupElectronAPI(customResponses?: Record<string, unknown>): MockElectronAPI {
  return MockFactory.setupWindowElectronAPI(MockFactory.createElectronAPI(customResponses));
}

/**
 * Common test setup function that initializes all standard mocks
 */
export function setupStandardMocks() {
  const electronAPI = MockFactory.setupWindowElectronAPI();
  const electronMocks = MockFactory.setupElectronMocks();
  const consoleMocks = MockFactory.createMockConsole();

  return {
    electronAPI,
    electronMocks,
    consoleMocks,
    cleanup: () => {
      MockFactory.resetAllMocks();
      consoleMocks.restore();
    },
  };
}
