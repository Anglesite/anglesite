/**
 * @file Centralized mock factory for common test dependencies.
 * @description Provides reusable mocks to reduce duplication across test files.
 */

import type { Display } from 'electron';

export interface MockElectronAPI {
  send: jest.Mock;
  invoke: jest.Mock;
  on: jest.Mock;
  once: jest.Mock;
  removeAllListeners: jest.Mock;
  off: jest.Mock;
  getCurrentTheme: jest.Mock;
  setTheme: jest.Mock;
  onThemeUpdated: jest.Mock;
  openExternal: jest.Mock;
  getAppInfo: jest.Mock;
  clipboard: {
    writeText: jest.Mock;
    readText: jest.Mock;
  };
  diagnostics: {
    getErrors: jest.Mock;
    getStatistics: jest.Mock;
    getNotifications: jest.Mock;
    dismissNotification: jest.Mock;
    clearErrors: jest.Mock;
    exportErrors: jest.Mock;
    showWindow: jest.Mock;
    closeWindow: jest.Mock;
    toggleWindow: jest.Mock;
    getWindowState: jest.Mock;
    getPreferences: jest.Mock;
    setPreferences: jest.Mock;
    getServiceHealth: jest.Mock;
    subscribeToErrors: jest.Mock;
    onSubscriptionConfirmed: jest.Mock;
    onSubscriptionError: jest.Mock;
  };
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
 * Factory class for creating standardized test mocks.
 */
export class MockFactory {
  /**
   * Creates a mock ElectronAPI with standard IPC methods.
   */
  static createElectronAPI(customResponses?: Record<string, unknown>): MockElectronAPI {
    const mockAPI = {
      send: jest.fn(),
      invoke: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      off: jest.fn(),
      getCurrentTheme: jest.fn(),
      setTheme: jest.fn(),
      onThemeUpdated: jest.fn(),
      openExternal: jest.fn(),
      getAppInfo: jest.fn(),
      clipboard: {
        writeText: jest.fn(),
        readText: jest.fn(),
      },
      diagnostics: {
        getErrors: jest.fn(),
        getStatistics: jest.fn(),
        getNotifications: jest.fn(),
        dismissNotification: jest.fn(),
        clearErrors: jest.fn(),
        exportErrors: jest.fn(),
        showWindow: jest.fn(),
        closeWindow: jest.fn(),
        toggleWindow: jest.fn(),
        getWindowState: jest.fn(),
        getPreferences: jest.fn(),
        setPreferences: jest.fn(),
        getServiceHealth: jest.fn(),
        subscribeToErrors: jest.fn(),
        onSubscriptionConfirmed: jest.fn(),
        onSubscriptionError: jest.fn(),
      },
    };

    // Setup default responses for IPC invoke calls
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
        case 'get-current-theme':
          return Promise.resolve('system');
        case 'get-app-info':
          return Promise.resolve({ version: '1.0.0', name: 'Test App' });
        default:
          return Promise.resolve(null);
      }
    });

    // Setup default responses for theme API
    mockAPI.getCurrentTheme.mockImplementation(() => mockAPI.invoke('get-current-theme'));
    mockAPI.setTheme.mockImplementation((theme: string) => mockAPI.invoke('set-theme', theme));
    mockAPI.getAppInfo.mockImplementation(() => mockAPI.invoke('get-app-info'));

    // Setup default responses for clipboard API
    mockAPI.clipboard.readText.mockReturnValue('');

    // Setup default responses for diagnostics API
    mockAPI.diagnostics.getErrors.mockImplementation((filter?: unknown) =>
      mockAPI.invoke('diagnostics:get-errors', filter)
    );
    mockAPI.diagnostics.getStatistics.mockImplementation((filter?: unknown) =>
      mockAPI.invoke('diagnostics:get-statistics', filter)
    );
    mockAPI.diagnostics.getNotifications.mockImplementation(() => mockAPI.invoke('diagnostics:get-notifications'));
    mockAPI.diagnostics.dismissNotification.mockImplementation((id: string) =>
      mockAPI.invoke('diagnostics:dismiss-notification', id)
    );
    mockAPI.diagnostics.clearErrors.mockImplementation((errorIds?: string[]) =>
      mockAPI.invoke('diagnostics:clear-errors', errorIds)
    );
    mockAPI.diagnostics.exportErrors.mockImplementation((filter?: unknown) =>
      mockAPI.invoke('diagnostics:export-errors', filter)
    );
    mockAPI.diagnostics.showWindow.mockImplementation(() => mockAPI.invoke('diagnostics:show-window'));
    mockAPI.diagnostics.closeWindow.mockImplementation(() => mockAPI.invoke('diagnostics:close-window'));
    mockAPI.diagnostics.toggleWindow.mockImplementation(() => mockAPI.invoke('diagnostics:toggle-window'));
    mockAPI.diagnostics.getWindowState.mockImplementation(() => mockAPI.invoke('diagnostics:get-window-state'));
    mockAPI.diagnostics.getPreferences.mockImplementation(() => mockAPI.invoke('diagnostics:get-preferences'));
    mockAPI.diagnostics.setPreferences.mockImplementation((prefs: unknown) =>
      mockAPI.invoke('diagnostics:set-preferences', prefs)
    );
    mockAPI.diagnostics.getServiceHealth.mockImplementation(() => mockAPI.invoke('diagnostics:get-service-health'));
    mockAPI.diagnostics.subscribeToErrors.mockImplementation(() => jest.fn()); // Return unsubscribe function

    return mockAPI;
  }

  /**
   * Sets up the global window.electronAPI mock.
   */
  static setupWindowElectronAPI(mockAPI?: MockElectronAPI): MockElectronAPI {
    const api = mockAPI || MockFactory.createElectronAPI();

    // Check if property exists and is configurable
    const descriptor = Object.getOwnPropertyDescriptor(window, 'electronAPI');
    if (descriptor && !descriptor.configurable) {
      // If not configurable, just assign the value
      (window as any).electronAPI = api; // eslint-disable-line @typescript-eslint/no-explicit-any
    } else {
      // Otherwise, define the property
      Object.defineProperty(window, 'electronAPI', {
        value: api,
        writable: true,
        configurable: true,
      });
    }

    return api;
  }

  /**
   * Creates a mock Electron app object.
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
   * Creates a mock Electron screen object with realistic display data.
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
   * Creates a mock console object for testing console outputs.
   */
  static createMockConsole() {
    const mockConsole = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      debug: jest.spyOn(console, 'debug').mockImplementation(),
    };

    return {
      mocks: mockConsole,
      restore: () => {
        // Restore all mocked console methods
        mockConsole.log.mockRestore();
        mockConsole.error.mockRestore();
        mockConsole.warn.mockRestore();
        mockConsole.debug.mockRestore();
      },
    };
  }

  /**
   * Creates a mock file system interface.
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
   * Sets up comprehensive Electron module mocks.
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
   * Creates a temporary directory mock for integration tests.
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
   * Creates a mock EleventyConfig object for testing plugins.
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
   * Resets all mocks created by the factory.
   */
  static resetAllMocks() {
    jest.clearAllMocks();

    // Clear window.electronAPI if it exists
    if ('electronAPI' in window) {
      delete (window as unknown as Record<string, unknown>).electronAPI;
    }
  }
}

/**
 * Convenience function for quick ElectronAPI setup in tests.
 */
export function setupElectronAPI(customResponses?: Record<string, unknown>): MockElectronAPI {
  return MockFactory.setupWindowElectronAPI(MockFactory.createElectronAPI(customResponses));
}

/**
 * Common test setup function that initializes all standard mocks.
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

/**
 * Creates a mock AppContext value for React component testing.
 *
 * Provides a standardized way to mock the AppContext for testing React components
 * that depend on website state, file selection, and loading states. Supports
 * partial overrides for testing specific scenarios without having to recreate
 * the entire context structure.
 *
 * All setter functions are Jest mocks, allowing you to verify that components
 * correctly call context methods and test component behavior under different states.
 * @param overrides Partial state overrides for testing specific scenarios
 * @returns Mock AppContext value with default test data and Jest mock functions
 * @example
 * ```typescript
 * // Basic usage with default test values
 * const mockContext = createMockAppContextValue();
 * render(
 *   <AppProvider value={mockContext}>
 *     <MyComponent />
 *   </AppProvider>
 * );
 *
 * // Override specific state for testing scenarios
 * const loadingContext = createMockAppContextValue({
 *   websiteName: 'my-test-site',
 *   loading: true
 * });
 *
 * // Verify context methods are called
 * fireEvent.click(getByText('Select File'));
 * expect(mockContext.setSelectedFile).toHaveBeenCalledWith('index.md');
 * ```
 */
export function createMockAppContextValue(
  overrides?: Partial<{
    currentView: string;
    selectedFile: unknown;
    websiteName: string;
    websitePath: string;
    loading: boolean;
  }>
) {
  return {
    state: {
      currentView: 'website-config' as const,
      selectedFile: null,
      websiteName: 'test-website',
      websitePath: '/test/path',
      loading: false,
      ...overrides,
    },
    setCurrentView: jest.fn(),
    setSelectedFile: jest.fn(),
    setWebsiteName: jest.fn(),
    setWebsitePath: jest.fn(),
    setLoading: jest.fn(),
  };
}

/**
 * Creates a standardized website configuration object for testing.
 *
 * Generates a complete website configuration object that matches the expected
 * structure for Anglesite websites. Includes all commonly used fields with
 * sensible test defaults, while allowing specific fields to be overridden
 * for testing different scenarios.
 *
 * The returned configuration object is compatible with website schema validation
 * and can be used in tests for components that consume website configuration data.
 * @param overrides Object with properties to override default configuration values
 * @returns Complete website configuration object with test-friendly defaults
 * @example
 * ```typescript
 * // Basic configuration with defaults
 * const config = createMockWebsiteConfig();
 * expect(config.title).toBe('Test Website');
 * expect(config.language).toBe('en');
 *
 * // Override specific properties for testing
 * const customConfig = createMockWebsiteConfig({
 *   title: 'My Custom Site',
 *   url: 'https://example.com',
 *   author: { name: 'John Doe', email: 'john@example.com' }
 * });
 *
 * // Use in component tests that need website data
 * mockElectronAPI.invoke.mockResolvedValue(config);
 * render(<WebsiteConfigEditor />);
 * ```
 */
export function createMockWebsiteConfig(overrides?: Record<string, unknown>) {
  return {
    title: 'Test Website',
    language: 'en',
    description: 'A test website configuration',
    author: {
      name: 'Test Author',
      email: 'test@example.com',
    },
    ...overrides,
  };
}

/**
 * Creates a mock process.platform restoration guard for tests that modify platform.
 *
 * Provides a safe way to temporarily modify `process.platform` for cross-platform
 * testing while ensuring the original value is restored afterward. This prevents
 * test pollution where platform changes in one test affect other tests.
 *
 * The guard captures the original platform value when created and provides methods
 * to change the platform during testing and restore it when done. Always call
 * `restore()` in test cleanup to prevent side effects.
 * @returns Object with setPlatform and restore methods for platform testing
 * @example
 * ```typescript
 * describe('Cross-platform behavior', () => {
 *   let platformGuard: ReturnType<typeof createPlatformGuard>;
 *
 *   beforeEach(() => {
 *     platformGuard = createPlatformGuard();
 *   });
 *
 *   afterEach(() => {
 *     platformGuard.restore();
 *   });
 *
 *   test('behaves differently on Windows', () => {
 *     platformGuard.setPlatform('win32');
 *     expect(process.platform).toBe('win32');
 *
 *     // Test Windows-specific behavior
 *     const result = myPlatformSpecificFunction();
 *     expect(result).toMatch(/\\\\path\\\\separators/);
 *   });
 *
 *   test('behaves differently on macOS', () => {
 *     platformGuard.setPlatform('darwin');
 *     expect(process.platform).toBe('darwin');
 *
 *     // Test macOS-specific behavior
 *   });
 * });
 * ```
 */
export function createPlatformGuard() {
  const originalPlatform = process.platform;

  return {
    setPlatform: (platform: NodeJS.Platform) => {
      Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
      });
    },
    restore: () => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    },
  };
}
