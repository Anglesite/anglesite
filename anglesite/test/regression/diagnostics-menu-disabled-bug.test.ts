/**
 * @file Regression test for diagnostics menu disabled bug
 * @description Tests that the DiagnosticsWindowManager service is properly registered
 * and the menu item is enabled when services are initialized.
 *
 * Bug: "Website Diagnostics..." menu item is disabled due to DiagnosticsWindowManager
 * service not being registered in the DI container during app initialization.
 */

// Mock getGlobalContext before any imports that might use it
let mockGlobalContext: any;
jest.mock('../../src/main/core/service-registry', () => ({
  getGlobalContext: () => mockGlobalContext,
}));

import { DIContainer, ServiceKeys } from '../../src/main/core/container';
import { DiagnosticsWindowManager } from '../../src/main/ui/diagnostics-window-manager';
import { checkDiagnosticsServiceAvailability } from '../../src/main/ui/menu/diagnostics-menu-handlers';
import {
  registerNotificationServices,
  initializeNotificationServices,
} from '../../src/main/services/notification-service-registrar';
import { IStore } from '../../src/main/core/interfaces';

// Helper function to create a mock store
function createMockStore(): IStore {
  const store = new Map<string, any>();
  const defaultSettings = {
    autoDnsEnabled: false,
    httpsMode: false,
    firstLaunchCompleted: true,
    theme: 'system' as const,
    recentWebsites: [],
    windowStates: [],
  };

  return {
    get: jest.fn((key: string) => store.get(key) ?? defaultSettings[key as keyof typeof defaultSettings]),
    set: jest.fn((key: string, value: any) => {
      store.set(key, value);
    }),
    getAll: jest.fn(() => defaultSettings as any),
    setAll: jest.fn(),
    saveWindowStates: jest.fn(),
    getWindowStates: jest.fn(() => []),
    clearWindowStates: jest.fn(),
    addRecentWebsite: jest.fn(),
    getRecentWebsites: jest.fn(() => []),
    clearRecentWebsites: jest.fn(),
    removeRecentWebsite: jest.fn(),
    forceSave: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  } as IStore;
}

// Mock electron modules
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/path'),
    getVersion: jest.fn().mockReturnValue('1.0.0'),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    webContents: {
      on: jest.fn(),
      send: jest.fn(),
    },
    show: jest.fn(),
    focus: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
    isVisible: jest.fn().mockReturnValue(true),
  })),
  Notification: {
    isSupported: jest.fn().mockReturnValue(true),
  },
}));

describe('Regression: Diagnostics Menu Disabled Bug', () => {
  let container: DIContainer;

  beforeEach(() => {
    // Create a fresh container for each test
    container = new DIContainer({ name: 'test' });

    // Register required dependencies
    const mockStore = createMockStore();
    container.registerInstance(ServiceKeys.STORE, mockStore);

    // Register mock error reporting service
    const mockErrorReporting = {
      initialize: jest.fn().mockResolvedValue(undefined),
      report: jest.fn().mockResolvedValue(undefined),
      getRecentErrors: jest.fn().mockReturnValue([]),
      clearErrors: jest.fn().mockResolvedValue(undefined),
      getErrorStatistics: jest.fn().mockReturnValue({
        total: 0,
        bySeverity: {},
        byCategory: {},
      }),
      subscribeToErrors: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    };
    container.registerInstance(ServiceKeys.ERROR_REPORTING, mockErrorReporting);

    // Mock the global context to return our test container
    mockGlobalContext = {
      getService: jest.fn((key: string) => {
        try {
          return container.resolve(key);
        } catch {
          return null;
        }
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('Bug Reproduction', () => {
    it('should fail when notification services are NOT registered (reproduces the bug)', () => {
      // This reproduces the current bug state where services are not registered

      // Attempt to resolve DiagnosticsWindowManager - should fail
      expect(() => {
        container.resolve('DiagnosticsWindowManager');
      }).toThrow("Service 'DiagnosticsWindowManager' is not registered");

      // Check menu availability - should return false
      const isAvailable = checkDiagnosticsServiceAvailability();
      expect(isAvailable).toBe(false);
    });

    it('should have DiagnosticsWindowManager unavailable in menu when not registered', () => {
      // Mock modules need to be required after mocking
      const { checkDiagnosticsServiceAvailability } = require('../../src/main/ui/menu/diagnostics-menu-handlers');

      // Without registration, the service should not be available
      const isAvailable = checkDiagnosticsServiceAvailability();
      expect(isAvailable).toBe(false);
    });
  });

  describe('Expected Behavior (After Fix)', () => {
    it('should succeed when notification services ARE registered', async () => {
      // Register notification services (this is what the fix will do)
      registerNotificationServices(container);

      // Attempt to resolve DiagnosticsWindowManager - should succeed
      const diagnosticsWindowManager = container.resolve('DiagnosticsWindowManager');
      expect(diagnosticsWindowManager).toBeDefined();
      expect(diagnosticsWindowManager).toBeInstanceOf(DiagnosticsWindowManager);

      // Initialize services
      await initializeNotificationServices(container);

      // Check menu availability - should return true
      const { checkDiagnosticsServiceAvailability } = require('../../src/main/ui/menu/diagnostics-menu-handlers');
      const isAvailable = checkDiagnosticsServiceAvailability();
      expect(isAvailable).toBe(true);
    });

    it('should have all notification services available after registration', () => {
      // Register all notification services
      registerNotificationServices(container);

      // Verify all services are registered
      expect(() => container.resolve('ErrorDiagnosticsService')).not.toThrow();
      expect(() => container.resolve('DiagnosticsWindowManager')).not.toThrow();
      expect(() => container.resolve(ServiceKeys.SYSTEM_NOTIFICATION)).not.toThrow();

      // Verify services are of correct types
      const diagnosticsWindowManager = container.resolve('DiagnosticsWindowManager');
      expect(diagnosticsWindowManager).toBeInstanceOf(DiagnosticsWindowManager);
    });

    it('should enable diagnostics menu item when services are registered', () => {
      // Register services
      registerNotificationServices(container);

      // Mock the menu check
      const { checkDiagnosticsServiceAvailability } = require('../../src/main/ui/menu/diagnostics-menu-handlers');

      // Menu item should be enabled
      const isEnabled = checkDiagnosticsServiceAvailability();
      expect(isEnabled).toBe(true);
    });
  });

  describe('Service Dependencies', () => {
    it('should have correct service dependencies registered', () => {
      // Register services
      registerNotificationServices(container);

      // Verify SystemNotificationService can access its dependencies
      const systemNotificationService = container.resolve(ServiceKeys.SYSTEM_NOTIFICATION);
      expect(systemNotificationService).toBeDefined();

      // Verify ErrorDiagnosticsService has its dependencies
      const errorDiagnosticsService = container.resolve('ErrorDiagnosticsService');
      expect(errorDiagnosticsService).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing store service gracefully', () => {
      const emptyContainer = new DIContainer({ name: 'empty' });

      // Should throw when trying to register without dependencies
      expect(() => {
        registerNotificationServices(emptyContainer);
        emptyContainer.resolve('DiagnosticsWindowManager');
      }).toThrow();
    });

    it('should handle missing error reporting service gracefully', () => {
      const partialContainer = new DIContainer({ name: 'partial' });
      partialContainer.registerInstance(ServiceKeys.STORE, createMockStore());

      // Should throw when trying to resolve services with missing dependencies
      expect(() => {
        registerNotificationServices(partialContainer);
        partialContainer.resolve('ErrorDiagnosticsService');
      }).toThrow();
    });
  });
});
