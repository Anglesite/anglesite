/**
 * @file Theme Testing Utilities
 *
 * Centralized utilities for theme-related testing to ensure consistency
 * and maintainability across all theme tests.
 */

import type { MockStore, MockNativeTheme, PartialMockWindow } from './test-types';

/**
 * Enhanced mock for nativeTheme that supports property assignment.
 */
export function createMockNativeTheme(): MockNativeTheme & { themeSource: string } {
  let currentThemeSource = 'system';

  const mock = {
    shouldUseDarkColors: false,
    get themeSource() {
      return currentThemeSource;
    },
    set themeSource(value: string) {
      currentThemeSource = value;
    },
    on: jest.fn(),
  };

  return mock as MockNativeTheme & { themeSource: string };
}

/**
 * Enhanced mock for IPC that tracks handlers for later access.
 */
export function createMockIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const mock = {
    handle: jest.fn(),
    on: jest.fn(),
    // Helper to get handlers
    getHandler: (channel: string) => handlers.get(channel),
    // Helper to check if handler exists
    hasHandler: (channel: string) => handlers.has(channel),
    // Helper to clear handlers (for test cleanup)
    clearHandlers: () => handlers.clear(),
  };

  // Set up the implementation for the handle mock
  mock.handle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  });

  return mock;
}

/**
 * Create a mock window with all necessary theme-related methods.
 */
export function createMockWindow(
  overrides: Partial<PartialMockWindow> = {}
): PartialMockWindow & { webContents: NonNullable<PartialMockWindow['webContents']> } {
  const baseWindow = {
    isDestroyed: () => false,
    webContents: {
      send: jest.fn(),
      isLoading: jest.fn(() => false),
      executeJavaScript: jest.fn(() => Promise.resolve()),
      once: jest.fn(),
    },
  };

  const merged = { ...baseWindow, ...overrides };
  // Ensure webContents is not null
  if (!merged.webContents) {
    merged.webContents = baseWindow.webContents;
  }

  return merged as PartialMockWindow & { webContents: NonNullable<PartialMockWindow['webContents']> };
}

/**
 * Create a mock store with theme-related methods.
 */
export function createMockStore(defaultTheme: string = 'system'): MockStore {
  return {
    get: jest.fn(() => defaultTheme),
    set: jest.fn(),
  };
}

/**
 * Create a mock BrowserWindow module.
 */
export function createMockBrowserWindow(windows: PartialMockWindow[] = []) {
  return {
    getAllWindows: jest.fn(() => windows),
    fromWebContents: jest.fn(),
  };
}

/**
 * Theme test scenario helpers.
 */
export class ThemeTestScenarios {
  /**
   * Set up a basic theme test scenario.
   */
  static setupBasicTheme(
    mockNativeTheme: ReturnType<typeof createMockNativeTheme>,
    mockStore: MockStore,
    theme: 'light' | 'dark' | 'system' = 'system'
  ) {
    mockStore.get.mockReturnValue(theme);
    mockNativeTheme.shouldUseDarkColors = theme === 'dark' || (theme === 'system' && false);
    mockNativeTheme.themeSource = theme;
  }

  /**
   * Create a mock window with all necessary theme-related methods.
   */
  static createMockWindow(
    overrides: Partial<PartialMockWindow> = {}
  ): PartialMockWindow & { webContents: NonNullable<PartialMockWindow['webContents']> } {
    return createMockWindow(overrides);
  }

  /**
   * Set up a window theme scenario.
   */
  static setupWindowScenario(mockBrowserWindow: ReturnType<typeof createMockBrowserWindow>, windowCount: number = 2) {
    const windows = Array.from({ length: windowCount }, () =>
      ThemeTestScenarios.createMockWindow({
        webContents: {
          send: jest.fn(),
          isLoading: jest.fn(() => false),
          executeJavaScript: jest.fn(() => Promise.resolve()),
          once: jest.fn(),
        },
      })
    );

    mockBrowserWindow.getAllWindows.mockReturnValue(windows);
    return windows;
  }

  /**
   * Verify theme was applied to windows.
   */
  static expectThemeAppliedToWindows(windows: PartialMockWindow[], theme: 'light' | 'dark', userPreference: string) {
    windows.forEach((window) => {
      expect(window.webContents?.send).toHaveBeenCalledWith(
        'theme-updated',
        expect.objectContaining({
          userPreference,
          resolvedTheme: theme,
        })
      );
    });
  }

  /**
   * Verify IPC handlers are registered.
   */
  static expectIpcHandlersRegistered(mockIpcMain: ReturnType<typeof createMockIpcMain>) {
    // Instead of checking if handle was called, check if handlers exist
    expect(mockIpcMain.hasHandler('get-current-theme')).toBe(true);
    expect(mockIpcMain.hasHandler('set-theme')).toBe(true);
  }

  /**
   * Test IPC handler functionality.
   */
  static testIpcHandlers(mockIpcMain: ReturnType<typeof createMockIpcMain>, expectedTheme: string) {
    const getThemeHandler = mockIpcMain.getHandler('get-current-theme');
    const setThemeHandler = mockIpcMain.getHandler('set-theme');

    expect(getThemeHandler).toBeDefined();
    expect(setThemeHandler).toBeDefined();

    if (getThemeHandler) {
      const result = getThemeHandler();
      expect(result).toHaveProperty('userPreference');
      expect(result).toHaveProperty('resolvedTheme');
      expect(result).toHaveProperty('systemTheme');
    }

    if (setThemeHandler) {
      const result = setThemeHandler(null, expectedTheme);
      expect(result).toHaveProperty('userPreference', expectedTheme);
    }
  }
}

/**
 * Mock factory for complete theme testing setup.
 */
export function createThemeTestSetup() {
  const mockNativeTheme = createMockNativeTheme();
  const mockStore = createMockStore();
  const mockIpcMain = createMockIpcMain();
  const mockBrowserWindow = createMockBrowserWindow();

  // Service registry mock
  const mockServiceRegistry = {
    getGlobalContext: () => ({
      getService: (key: string) => {
        if (key === 'store') {
          return mockStore;
        }
        throw new Error(`Unknown service: ${key}`);
      },
    }),
  };

  return {
    mocks: {
      nativeTheme: mockNativeTheme,
      store: mockStore,
      ipcMain: mockIpcMain,
      browserWindow: mockBrowserWindow,
      serviceRegistry: mockServiceRegistry,
    },
    // Reset all mocks
    reset: () => {
      // Only clear specific mocks that need to be reset between tests
      // Don't clear ipcMain.handle calls since we need them for tests
      mockStore.get.mockClear();
      mockStore.set.mockClear();
      mockBrowserWindow.getAllWindows.mockClear();

      // Reset theme state but preserve handlers
      ThemeTestScenarios.setupBasicTheme(mockNativeTheme, mockStore);
      mockBrowserWindow.getAllWindows.mockReturnValue([]);
    },
    scenarios: {
      ...ThemeTestScenarios,
      createMockWindow: ThemeTestScenarios.createMockWindow,
      expectIpcHandlersRegistered: ThemeTestScenarios.expectIpcHandlersRegistered,
    },
  };
}

/**
 * Jest setup helper for theme tests.
 */
export function setupThemeTestMocks() {
  const setup = createThemeTestSetup();

  // Set up Jest mocks
  jest.mock('electron', () => ({
    BrowserWindow: setup.mocks.browserWindow,
    nativeTheme: setup.mocks.nativeTheme,
    ipcMain: setup.mocks.ipcMain,
  }));

  jest.mock('../../src/main/core/service-registry', () => setup.mocks.serviceRegistry);

  return setup;
}
