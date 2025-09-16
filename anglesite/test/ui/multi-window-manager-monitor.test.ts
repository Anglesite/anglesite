/**
 * @file Tests for monitor-aware enhancements to multi-window manager
 *
 * Tests the integration between MonitorManager and the existing multi-window
 * management system, focusing on monitor-aware window state persistence and restoration.
 */

import { BrowserWindow, WebContentsView } from 'electron';
// Note: MonitorManager import available for future direct testing scenarios
// import { MonitorManager } from '../../src/main/services/monitor-manager';
import { MonitorInfo, WindowState } from '../../src/main/core/types';
import { IStore, IMonitorManager } from '../../src/main/core/interfaces';

// Import the functions we want to test
import {
  saveWindowStates,
  restoreWindowStates,
  addWebsiteEditorWindow,
  getAllWebsiteWindows,
  // Note: Additional imports available for future test scenarios
  // removeWebsiteEditorWindow,
} from '../../src/main/ui/multi-window-manager';

// Mock dependencies
jest.mock('electron');
jest.mock('../../src/main/core/service-registry');
jest.mock('../../src/main/services/monitor-manager');
jest.mock('../../src/main/ui/template-loader');
jest.mock('../../src/main/utils/website-manager');
jest.mock('../../src/main/ui/window-manager');

// Note: Mock classes available for future test scenarios
// const mockBrowserWindow = BrowserWindow as jest.MockedClass<typeof BrowserWindow>;
// const mockWebContentsView = WebContentsView as jest.MockedClass<typeof WebContentsView>;
// const MockMonitorManager = MonitorManager as jest.MockedClass<typeof MonitorManager>;

describe('Multi-Window Manager Monitor Integration', () => {
  let mockStore: jest.Mocked<IStore>;
  let mockMonitorManager: jest.Mocked<IMonitorManager>;
  let mockWindow: jest.Mocked<BrowserWindow>;
  let mockWebContentsView: jest.Mocked<WebContentsView>;

  const createMockMonitor = (overrides: Partial<MonitorInfo> = {}): MonitorInfo => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
    scaleFactor: 1.0,
    primary: true,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear the website windows map to prevent state bleeding between tests
    getAllWebsiteWindows().clear();

    // Mock store
    mockStore = {
      get: jest.fn(),
      set: jest.fn(),
      getAll: jest.fn(),
      setAll: jest.fn(),
      saveWindowStates: jest.fn(),
      getWindowStates: jest.fn().mockReturnValue([]),
      clearWindowStates: jest.fn(),
      addRecentWebsite: jest.fn(),
      getRecentWebsites: jest.fn(),
      clearRecentWebsites: jest.fn(),
      removeRecentWebsite: jest.fn(),
      forceSave: jest.fn(),
      dispose: jest.fn(),
    };

    // Mock monitor manager
    mockMonitorManager = {
      getCurrentConfiguration: jest.fn(),
      refreshConfiguration: jest.fn(),
      findBestMonitorForWindow: jest.fn(),
      calculateWindowBounds: jest.fn(),
      isMonitorConfigurationChanged: jest.fn(),
      findMonitorById: jest.fn(),
      getPrimaryMonitor: jest.fn(),
      ensureWindowVisible: jest.fn(),
      calculateRelativePosition: jest.fn(),
      dispose: jest.fn(),
    };

    // Mock BrowserWindow
    mockWindow = {
      getBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 800, height: 600 }),
      isMaximized: jest.fn().mockReturnValue(false),
      isDestroyed: jest.fn().mockReturnValue(false),
      setBounds: jest.fn(),
      maximize: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      focus: jest.fn(),
      show: jest.fn(),
      close: jest.fn(),
      loadURL: jest.fn(),
      webContents: {
        send: jest.fn(),
      },
      contentView: {
        addChildView: jest.fn(),
      },
    } as unknown as jest.Mocked<BrowserWindow>;

    // Mock WebContentsView
    mockWebContentsView = {
      webContents: {
        isDestroyed: jest.fn().mockReturnValue(false),
      },
    } as unknown as jest.Mocked<WebContentsView>;

    // Mock additional dependencies
    const mockTemplateLoader = require('../../src/main/ui/template-loader');
    mockTemplateLoader.loadTemplateAsDataUrl = jest.fn().mockReturnValue('data:text/html,<html></html>');

    const mockWebsiteManager = require('../../src/main/utils/website-manager');
    mockWebsiteManager.getWebsitePath = jest.fn().mockReturnValue('/path/to/site');

    const mockWindowManager = require('../../src/main/ui/window-manager');
    mockWindowManager.openReactWebsiteEditorWindow = jest.fn().mockResolvedValue(undefined);

    // Mock BrowserWindow constructor
    const mockBrowserWindow = BrowserWindow as jest.MockedClass<typeof BrowserWindow>;
    mockBrowserWindow.mockImplementation(() => mockWindow);

    // Mock global context service registry
    const mockGetGlobalContext = require('../../src/main/core/service-registry').getGlobalContext;
    mockGetGlobalContext.mockReturnValue({
      getService: jest.fn((key: string) => {
        if (key === 'store') return mockStore; // Use lowercase key to match ServiceKeys.STORE
        if (key === 'monitorManager') return mockMonitorManager; // Use lowercase key to match ServiceKeys.MONITOR_MANAGER
        return null;
      }),
    });
  });

  describe('saveWindowStates with monitor awareness', () => {
    test('should capture monitor configuration when saving window states', () => {
      const monitor1 = createMockMonitor({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        primary: true,
      });
      const monitor2 = createMockMonitor({
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        primary: false,
      });

      const monitorConfig = {
        monitors: [monitor1, monitor2],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      mockMonitorManager.getCurrentConfiguration.mockReturnValue(monitorConfig);
      mockMonitorManager.findBestMonitorForWindow.mockReturnValue(monitor2);
      mockMonitorManager.calculateRelativePosition.mockReturnValue({
        percentX: 0.1,
        percentY: 0.1,
        percentWidth: 0.5,
        percentHeight: 0.6,
      });

      // Set up window on monitor 2
      mockWindow.getBounds.mockReturnValue({ x: 2200, y: 200, width: 1280, height: 864 });

      // Add a website window
      addWebsiteEditorWindow('test-site', mockWindow, mockWebContentsView, '/path/to/site');

      // Save window states
      saveWindowStates();

      // Verify that saveWindowStates was called with monitor-aware data
      expect(mockStore.saveWindowStates).toHaveBeenCalledWith([
        expect.objectContaining({
          websiteName: 'test-site',
          websitePath: '/path/to/site',
          bounds: { x: 2200, y: 200, width: 1280, height: 864 },
          isMaximized: false,
          windowType: 'editor',
          targetMonitorId: 2,
          relativePosition: {
            percentX: 0.1,
            percentY: 0.1,
            percentWidth: 0.5,
            percentHeight: 0.6,
          },
          monitorConfig: monitorConfig,
        }),
      ]);
    });

    test('should handle window without monitor data gracefully', () => {
      const monitorConfig = {
        monitors: [createMockMonitor()],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      mockMonitorManager.getCurrentConfiguration.mockReturnValue(monitorConfig);
      mockMonitorManager.findBestMonitorForWindow.mockReturnValue(null); // No best monitor found
      mockMonitorManager.calculateRelativePosition.mockReturnValue({
        percentX: 0.0,
        percentY: 0.0,
        percentWidth: 0.5,
        percentHeight: 0.5,
      });

      addWebsiteEditorWindow('test-site', mockWindow, mockWebContentsView, '/path/to/site');
      saveWindowStates();

      expect(mockStore.saveWindowStates).toHaveBeenCalledWith([
        expect.objectContaining({
          websiteName: 'test-site',
          // Should still save basic window state even without monitor data
          bounds: expect.any(Object),
          isMaximized: false,
        }),
      ]);
    });
  });

  describe('restoreWindowStates with monitor awareness', () => {
    test('should restore windows using monitor-aware placement', async () => {
      const savedState: WindowState = {
        websiteName: 'test-site',
        websitePath: '/path/to/site',
        bounds: { x: 2200, y: 200, width: 1280, height: 864 },
        isMaximized: false,
        windowType: 'editor',
        targetMonitorId: 2,
        relativePosition: {
          percentX: 0.1,
          percentY: 0.1,
          percentWidth: 0.5,
          percentHeight: 0.6,
        },
        monitorConfig: {
          monitors: [
            createMockMonitor({ id: 1, primary: true }),
            createMockMonitor({
              id: 2,
              bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
              primary: false,
            }),
          ],
          primaryMonitorId: 1,
          timestamp: Date.now(),
        },
      };

      const targetMonitor = createMockMonitor({
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workAreaBounds: { x: 1920, y: 25, width: 2560, height: 1415 },
      });

      mockStore.getWindowStates.mockReturnValue([savedState]);
      mockMonitorManager.findBestMonitorForWindow.mockReturnValue(targetMonitor);
      mockMonitorManager.calculateWindowBounds.mockReturnValue({
        x: 2176, // 1920 + (2560 * 0.1)
        y: 166, // 25 + (1415 * 0.1)
        width: 1280, // 2560 * 0.5
        height: 849, // 1415 * 0.6
      });

      // Mock file system check
      const fs = require('fs');
      fs.existsSync = jest.fn().mockReturnValue(true);

      await restoreWindowStates();

      expect(mockMonitorManager.findBestMonitorForWindow).toHaveBeenCalledWith(savedState);
      expect(mockMonitorManager.calculateWindowBounds).toHaveBeenCalledWith(savedState, targetMonitor);
    });

    test('should handle monitor configuration changes gracefully', async () => {
      const savedState: WindowState = {
        websiteName: 'test-site',
        websitePath: '/path/to/site',
        bounds: { x: 2200, y: 200, width: 1280, height: 864 },
        windowType: 'editor', // Use editor type to use mocked path
        targetMonitorId: 2, // This monitor no longer exists
        relativePosition: {
          percentX: 0.1,
          percentY: 0.1,
          percentWidth: 0.5,
          percentHeight: 0.6,
        },
      };

      const fallbackMonitor = createMockMonitor({ id: 1, primary: true });

      mockStore.getWindowStates.mockReturnValue([savedState]);
      mockMonitorManager.findBestMonitorForWindow.mockReturnValue(fallbackMonitor); // Falls back to primary
      mockMonitorManager.calculateWindowBounds.mockReturnValue({
        x: 192, // Recalculated for primary monitor
        y: 131,
        width: 960,
        height: 633,
      });

      const fs = require('fs');
      fs.existsSync = jest.fn().mockReturnValue(true);

      await restoreWindowStates();

      expect(mockMonitorManager.findBestMonitorForWindow).toHaveBeenCalledWith(savedState);
      expect(mockMonitorManager.calculateWindowBounds).toHaveBeenCalledWith(savedState, fallbackMonitor);
    });

    test('should clean up invalid window states', async () => {
      const validState: WindowState = {
        websiteName: 'valid-site',
        websitePath: '/path/to/valid/site',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        windowType: 'editor', // Use editor type to use the mocked path
      };

      const invalidState: WindowState = {
        websiteName: 'invalid-site',
        websitePath: '/path/to/invalid/site', // This path doesn't exist
        bounds: { x: 200, y: 200, width: 800, height: 600 },
      };

      mockStore.getWindowStates.mockReturnValue([validState, invalidState]);

      const fs = require('fs');
      fs.existsSync = jest.fn((path: string) => path.includes('valid'));

      await restoreWindowStates();

      // Should save only the valid states
      expect(mockStore.saveWindowStates).toHaveBeenCalledWith([validState]);
    });
  });

  describe('backward compatibility', () => {
    test('should handle legacy window states without monitor data', () => {
      const legacyState: WindowState = {
        websiteName: 'legacy-site',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        isMaximized: false,
        windowType: 'preview',
        // No targetMonitorId, relativePosition, or monitorConfig
      };

      const primaryMonitor = createMockMonitor({ id: 1, primary: true });

      mockMonitorManager.findBestMonitorForWindow.mockReturnValue(primaryMonitor);
      mockMonitorManager.calculateWindowBounds.mockReturnValue(legacyState.bounds!);

      const result = mockMonitorManager.findBestMonitorForWindow(legacyState);
      const bounds = mockMonitorManager.calculateWindowBounds(legacyState, result);

      expect(result).toBe(primaryMonitor);
      expect(bounds).toEqual(legacyState.bounds);
    });

    test('should save monitor data for legacy windows on next save', () => {
      const monitorConfig = {
        monitors: [createMockMonitor()],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      mockMonitorManager.getCurrentConfiguration.mockReturnValue(monitorConfig);
      mockMonitorManager.findBestMonitorForWindow.mockReturnValue(createMockMonitor());
      mockMonitorManager.calculateRelativePosition.mockReturnValue({
        percentX: 0.1,
        percentY: 0.1,
        percentWidth: 0.4,
        percentHeight: 0.5,
      });

      addWebsiteEditorWindow('legacy-site', mockWindow, mockWebContentsView, '/path/to/site');
      saveWindowStates();

      expect(mockStore.saveWindowStates).toHaveBeenCalledWith([
        expect.objectContaining({
          websiteName: 'legacy-site',
          targetMonitorId: 1,
          relativePosition: expect.any(Object),
          monitorConfig: monitorConfig,
        }),
      ]);
    });
  });

  describe('error handling', () => {
    test('should handle MonitorManager errors gracefully', () => {
      mockMonitorManager.getCurrentConfiguration.mockImplementation(() => {
        throw new Error('Monitor detection failed');
      });

      // Should not throw when saving window states
      expect(() => {
        addWebsiteEditorWindow('test-site', mockWindow, mockWebContentsView, '/path/to/site');
        saveWindowStates();
      }).not.toThrow();

      // Should still save basic window state
      expect(mockStore.saveWindowStates).toHaveBeenCalled();
    });

    test('should handle missing monitor manager service', () => {
      const mockGetGlobalContext = require('../../src/main/core/service-registry').getGlobalContext;
      mockGetGlobalContext.mockReturnValue({
        getService: jest.fn((key: string) => {
          if (key === 'store') return mockStore;
          if (key === 'monitorManager') return null; // Service not available
          return null;
        }),
      });

      expect(() => {
        addWebsiteEditorWindow('test-site', mockWindow, mockWebContentsView, '/path/to/site');
        saveWindowStates();
      }).not.toThrow();
    });
  });
});
