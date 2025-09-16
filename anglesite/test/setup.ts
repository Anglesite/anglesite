/**
 * @file Jest setup file for renderer tests
 */

// Mock the global context system to prevent initialization errors during tests
jest.doMock('../src/main/core/service-registry', () => {
  const originalModule = jest.requireActual('../src/main/core/service-registry');

  // Create a mock store service
  const mockStore = {
    get: jest.fn().mockReturnValue('system'), // Default theme preference
    set: jest.fn(),
    getAll: jest.fn().mockReturnValue({}),
    delete: jest.fn(),
    clear: jest.fn(),
    has: jest.fn().mockReturnValue(false),
  };

  // Create a mock global context
  const mockGlobalContext = {
    getService: jest.fn((serviceName) => {
      if (serviceName === 'store') {
        return mockStore;
      }
      return {};
    }),
    isInitialized: true,
  };

  return {
    ...originalModule,
    getGlobalContext: jest.fn().mockReturnValue(mockGlobalContext),
    globalAppContext: mockGlobalContext,
  };
});

// Mock Electron Menu for UI tests - use jest.doMock to avoid interfering with other modules
jest.doMock('electron', () => ({
  Menu: {
    buildFromTemplate: jest.fn(),
    setApplicationMenu: jest.fn(),
  },
  dialog: {
    showErrorBox: jest.fn(),
    showMessageBox: jest.fn(),
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
  },
  BrowserWindow: jest.fn(),
  WebContentsView: jest.fn(),
  MenuItem: jest.fn(),
  app: {
    getName: jest.fn(() => 'Test App'),
    getVersion: jest.fn(() => '1.0.0'),
    quit: jest.fn(),
    setName: jest.fn(),
    getPath: jest.fn((path: string) => {
      const pathMap: Record<string, string> = {
        userData: '/mock/userData',
        appData: '/mock/appData',
        home: '/mock/home',
        temp: '/mock/temp',
      };
      return pathMap[path] || '/mock/path';
    }),
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    removeAllListeners: jest.fn(),
  },
}));

// Import jest-dom matchers
import '@testing-library/jest-dom';

// Import TypeScript declarations for custom matchers
import './types/jest-custom-matchers.d.ts';

// Import and register our new custom matchers
import { registerCustomMatchers } from './utils/custom-assertions';
registerCustomMatchers();

// Import custom matchers to make them available in all test files
import './matchers/custom-matchers';

// Import third-party mocks to ensure they're applied early
import './mocks/third-party';

// Global test setup using Jest hooks
beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();

  // Reset any global state
  if (typeof window !== 'undefined' && 'electronAPI' in window) {
    delete (window as any).electronAPI;
  }
});

// Global afterEach cleanup to prevent hanging tests
afterEach(() => {
  // Clear all timers
  jest.clearAllTimers();
  jest.useRealTimers();

  // Clear all mocks after each test
  jest.clearAllMocks();
});

// Global test timeout (can be overridden in individual tests)
jest.setTimeout(10000);

// Setup TextEncoder/TextDecoder for JSDOM
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Set environment variable for store service test fallback
process.env.ANGLESITE_TEST_DATA = '/tmp/anglesite-test';

// Mock electronAPI globally for all tests
const mockElectronAPI = {
  send: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
};

// Set up window.electronAPI for renderer tests
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Export for tests that need direct access
(global as unknown as { mockElectronAPI: typeof mockElectronAPI }).mockElectronAPI = mockElectronAPI;

// Suppress console.warn for deprecated functions during tests to reduce noise
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = jest.fn();
});

afterEach(() => {
  console.warn = originalWarn;
});
